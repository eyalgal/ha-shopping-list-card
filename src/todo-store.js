import { matchItem } from './item-model.js';

const stores = new WeakMap();
const UNDO_TIMEOUT = 10000;

export function getTodoStore(hass, entityId) {
  const connection = hass.connection;
  let entities = stores.get(connection);
  if (!entities) {
    entities = new Map();
    stores.set(connection, entities);
  }
  let store = entities.get(entityId);
  if (!store) {
    store = new TodoStore(hass, entityId, () => {
      if (entities.get(entityId) === store) entities.delete(entityId);
    });
    entities.set(entityId, store);
  }
  store.updateHass(hass);
  return store;
}

class TodoStore {
  constructor(hass, entityId, onDispose) {
    this.connection = hass.connection;
    this.entityId = entityId;
    this.hass = hass;
    this.items = null;
    this.status = 'loading';
    this.error = null;
    this.pending = new Set();
    this.listeners = new Set();
    this.closed = false;
    this._onDispose = onDispose;
    this._generation = 0;
    this._revision = 0;
    this._writeRevision = 0;
    this._confirmedWriteRevision = -1;
    this._subscription = null;
    this._request = null;
    this._retryTimer = null;
    this._retryDelay = 0;
    this._allItems = [];
    this._undo = null;
    this._undoBusy = false;
    this._undoTimer = null;
    this._undoExpired = false;
    this._operationSequence = 0;
    this._undoSequence = 0;
    this._availability = this._availabilityError();
    if (this._availability) {
      this.status = 'unavailable';
      this.error = this._availability;
    }
  }

  get snapshot() {
    return {
      items: this.items, status: this.status, error: this.error, pending: new Set(this.pending),
      undo: this._undo ? {
        id: this._undo.id, count: this._undo.records.length,
        keys: this._undo.records.map(record => record.key),
        summary: this._undo.records[0].item.summary, busy: this._undoBusy,
      } : null,
    };
  }

  get ready() {
    return !this.closed && !this._availability && this.items !== null && this.status === 'ready';
  }

  _availabilityError() {
    if (this.hass.connected === false) return 'Disconnected from Home Assistant.';
    const entity = this.hass.states?.[this.entityId];
    if (!entity) return `Entity not found: ${this.entityId}`;
    if (entity.state === 'unavailable' || entity.state === 'unknown') return 'The to-do list is unavailable.';
    return null;
  }

  updateHass(hass) {
    this.hass = hass;
    const availability = this._availabilityError();
    if (availability === this._availability) return;
    this._availability = availability;
    this._generation++;
    this._request = null;
    this._confirmedWriteRevision = -1;
    this._stopSubscription();
    this._clearRetry();
    this.status = availability ? 'unavailable' : 'loading';
    this.error = availability;
    if (!availability) this._startSubscription();
    this._notify();
  }

  subscribe(listener) {
    if (this.closed) throw new Error('The list subscription has closed.');
    this.listeners.add(listener);
    this._deliver(listener);
    this._startSubscription();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size) return;
      this._stopSubscription();
      this._clearRetry();
      if (!this.pending.size) this._dispose();
    };
  }

  _deliver(listener) {
    try { listener(this.snapshot); }
    catch (error) { console.error('Shopping List Card listener error', error); }
  }

  _notify() {
    for (const listener of this.listeners) this._deliver(listener);
  }

  _current(generation) {
    return !this.closed && !this._availability && this._generation === generation;
  }

  _startSubscription() {
    if (this.closed || this._availability || !this.listeners.size || this._subscription) return;
    const attempt = { generation: this._generation, unsubscribe: null, received: false };
    this._subscription = attempt;
    const current = () => this._current(attempt.generation) && this._subscription === attempt;
    const failed = () => {
      if (!current()) return;
      this._subscription = null;
      this.status = 'reconnecting';
      this.error = 'Live updates are unavailable. Reconnecting...';
      this._scheduleRetry();
      this._notify();
      void this._fetch().catch(() => {});
    };
    try {
      const pending = this.connection.subscribeMessage(message => {
        if (!current() || !Array.isArray(message?.items)) return;
        attempt.received = true;
        this._setItems(message.items);
        this._revision++;
        this.status = 'ready';
        this.error = null;
        this._clearRetry();
        this._notify();
      }, { type: 'todo/item/subscribe', entity_id: this.entityId });
      Promise.resolve(pending).then(unsubscribe => {
        if (current()) attempt.unsubscribe = unsubscribe;
        else this._unsubscribe(unsubscribe);
      }).catch(failed);
    } catch { failed(); }
  }

  _activeItems(items) {
    return items.filter(item => item?.status === 'needs_action' && typeof item.summary === 'string');
  }

  _setItems(items) {
    this._allItems = items.filter(item => typeof item?.summary === 'string');
    this.items = this._activeItems(this._allItems);
  }

  _unsubscribe(unsubscribe) {
    try { Promise.resolve(unsubscribe?.()).catch(() => {}); }
    catch {}
  }

  _stopSubscription() {
    const attempt = this._subscription;
    this._subscription = null;
    if (attempt?.unsubscribe) this._unsubscribe(attempt.unsubscribe);
  }

  _scheduleRetry() {
    if (this._retryTimer || this.closed || this._availability || !this.listeners.size) return;
    this._retryDelay = this._retryDelay ? Math.min(this._retryDelay * 2, 30000) : 2000;
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      this._startSubscription();
      void this._fetch().catch(() => {});
    }, this._retryDelay);
  }

  _clearRetry() {
    if (this._retryTimer) clearTimeout(this._retryTimer);
    this._retryTimer = null;
    this._retryDelay = 0;
  }

  async _fetch(minimumWriteRevision = 0) {
    if (!this._current(this._generation)) throw new Error(this.error || 'The to-do list is unavailable.');
    if (this._request) {
      if (this._request.writeRevision >= minimumWriteRevision) return this._request.promise;
      await this._request.promise.catch(() => {});
      if (this._confirmedWriteRevision >= minimumWriteRevision) return this.items;
      return this._fetch(minimumWriteRevision);
    }
    const request = {
      generation: this._generation, revision: this._revision,
      writeRevision: this._writeRevision, promise: null,
    };
    this._request = request;
    request.promise = (async () => {
      try {
        const result = await this.hass.callWS({ type: 'todo/item/list', entity_id: this.entityId });
        if (!this._current(request.generation)) return this.items;
        if (!Array.isArray(result?.items)) throw new Error('Home Assistant returned an invalid to-do list.');
        this._confirmedWriteRevision = Math.max(this._confirmedWriteRevision, request.writeRevision);
        if (request.revision === this._revision) {
          this._setItems(result.items);
          this._revision++;
          this.status = this._subscription?.received ? 'ready' : 'reconnecting';
          this.error = this.status === 'ready' ? null : 'Live updates are reconnecting...';
          if (this.status === 'ready') this._clearRetry();
          this._notify();
        }
        return this.items;
      } catch (error) {
        if (this._current(request.generation)) {
          this.status = 'error';
          this.error = 'Could not refresh the to-do list. Retrying...';
          this._scheduleRetry();
          this._notify();
        }
        throw error;
      } finally {
        if (this._request === request) this._request = null;
      }
    })();
    return request.promise;
  }

  refresh() {
    if (!this._subscription) {
      this._clearRetry();
      this._startSubscription();
    }
    return this._fetch();
  }

  _removalRecord(action) {
    if (action.service !== 'remove_item' && !action.undoRemoval) return null;
    const item = this.items.find(item => item.uid === action.data.item || item.summary === action.data.item);
    if (!item || !action.key) return null;
    return {
      key: action.key, item: { ...item },
      ...(action.service === 'update_item' ? { after: action.data.rename } : {}),
    };
  }

  _rememberRemoval(actions, records, outcomes, sequence) {
    const confirmed = records.filter((record, index) => record
      && outcomes[index].status === 'fulfilled' && actions[index].confirmed(this.items)
      && (record.after !== undefined || !this._allItems.some(item => record.item.uid
        ? item.uid === record.item.uid : item.summary === record.item.summary)));
    if (!confirmed.length || sequence < this._undoSequence) return;
    this._undoSequence = sequence;
    this._undo = { id: sequence, records: confirmed };
    this._scheduleUndoExpiry();
  }

  _scheduleUndoExpiry() {
    clearTimeout(this._undoTimer);
    this._undoTimer = setTimeout(() => {
      this._undoTimer = null;
      if (this._undoBusy) this._undoExpired = true;
      else this.dismissUndo();
    }, UNDO_TIMEOUT);
  }

  _clearUndo() {
    clearTimeout(this._undoTimer);
    this._undoTimer = null;
    this._undoExpired = false;
    this._undo = null;
  }

  dismissUndo() {
    if (this._undoBusy) return;
    this._clearUndo();
    this._notify();
  }

  _restoreAction(record) {
    const features = this.hass.states?.[this.entityId]?.attributes?.supported_features;
    const supports = feature => features === undefined || (features & feature) !== 0;
    const changed = () => new Error('The list changed since this removal. Undo will not overwrite an existing item.');
    if (record.after !== undefined) {
      const current = this._allItems.find(item => record.item.uid
        ? item.uid === record.item.uid : item.summary === record.after);
      if (!current || current.status !== 'needs_action' || current.summary !== record.after
        || current.description !== record.item.description || current.due !== record.item.due) throw changed();
      if (!supports(4)) throw new Error('This list no longer supports restoring item quantities.');
      return {
        key: record.key, record, service: 'update_item',
        data: { item: current.uid || current.summary, rename: record.item.summary },
        confirmed: items => items.some(item => (current.uid ? item.uid === current.uid : true)
          && item.summary === record.item.summary),
      };
    }
    if (matchItem(this.items, record.key, {}).present
      || (record.item.uid && this._allItems.some(item => item.uid === record.item.uid))) throw changed();
    if (!supports(1)) throw new Error('This list does not support restoring removed items.');
    const data = { item: record.item.summary };
    if (record.item.description != null) {
      if (!supports(64)) throw new Error('This list no longer supports restoring item descriptions.');
      data.description = record.item.description;
    }
    if (record.item.due != null) {
      const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(record.item.due);
      if (!supports(dateOnly ? 16 : 32)) throw new Error('This list no longer supports restoring item due dates.');
      data[dateOnly ? 'due_date' : 'due_datetime'] = record.item.due;
    }
    return {
      key: record.key, record, service: 'add_item', data,
      confirmed: items => items.some(item => item.summary === record.item.summary),
    };
  }

  async undoLastRemoval(expectedId = this._undo?.id) {
    if (!this.ready) throw new Error(this.error || 'Wait for the to-do list to reconnect.');
    if (!this._undo || this._undo.id !== expectedId || this._undoBusy || this.pending.size) return false;
    const batch = this._undo;
    const generation = this._generation;
    this._undoBusy = true;
    this._notify();
    let actions = [];
    try {
      if (this._request) await this._request.promise;
      await this._fetch();
      if (!this._current(generation)) throw new Error('The list connection changed. Refresh before trying Undo again.');
      actions = batch.records.map(record => this._restoreAction(record));
      return await this.execute(actions.map(action => action.key), () => actions, { isUndo: true });
    } finally {
      if (this._current(generation) && this._undo === batch) {
        const restored = new Set(actions.filter(action => action.confirmed(this.items)).map(action => action.record));
        batch.records = batch.records.filter(record => !restored.has(record));
        if (!batch.records.length || this._undoExpired) this._clearUndo();
      }
      this._undoBusy = false;
      this._notify();
      if (!this.listeners.size) this._dispose();
    }
  }

  async execute(keys, createActions, { isUndo = false } = {}) {
    if (!this.ready) throw new Error(this.error || 'Wait for the to-do list to reconnect.');
    if (this._undoBusy && !isUndo) return false;
    if (keys.some(key => this.pending.has(key))) return false;
    const actions = createActions(this.items).filter(Boolean);
    if (!actions.length) return false;
    const sequence = ++this._operationSequence;
    const removals = isUndo ? [] : actions.map(action => this._removalRecord(action));
    if (!isUndo && this._undo) {
      const records = this._undo.records.filter(record => !keys.includes(record.key));
      if (records.length) this._undo = { ...this._undo, records };
      else this._clearUndo();
    }
    const generation = this._generation;
    const hass = this.hass;
    const uniqueKeys = new Set(keys);
    for (const key of uniqueKeys) this.pending.add(key);
    this._notify();
    try {
      const outcomes = await Promise.allSettled(actions.map(action => Promise.resolve().then(() =>
        hass.callService('todo', action.service, { entity_id: this.entityId, ...action.data }))));
      if (!this._current(generation)) throw new Error('The list connection changed during the update.');
      const failures = outcomes.filter(outcome => outcome.status === 'rejected');
      const writeRevision = ++this._writeRevision;
      if (failures.length || !actions.every(action => action.confirmed(this.items))) {
        await this._fetch(writeRevision);
      }
      if (!this._current(generation)) throw new Error('The list connection changed during the update.');
      if (!isUndo) this._rememberRemoval(actions, removals, outcomes, sequence);
      if (failures.length) {
        const detail = failures[0].reason?.message || 'Home Assistant rejected the request.';
        throw new Error(`Could not update ${failures.length} item(s). ${detail}`);
      }
      if (!actions.every(action => action.confirmed(this.items))) {
        this.status = 'error';
        this.error = 'The update is not confirmed. Refresh the list before trying again.';
        throw new Error(this.error);
      }
      return true;
    } finally {
      for (const key of uniqueKeys) this.pending.delete(key);
      this._notify();
      if (!this.listeners.size) this._dispose();
    }
  }

  _dispose() {
    if (this.listeners.size || this.pending.size || this._undoBusy) return;
    this.closed = true;
    this._clearUndo();
    this._generation++;
    this._stopSubscription();
    this._clearRetry();
    this._onDispose();
  }
}