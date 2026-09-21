const stores = new WeakMap();

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
    this._availability = this._availabilityError();
    if (this._availability) {
      this.status = 'unavailable';
      this.error = this._availability;
    }
  }

  get snapshot() {
    return { items: this.items, status: this.status, error: this.error, pending: new Set(this.pending) };
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
        this.items = this._activeItems(message.items);
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
          this.items = this._activeItems(result.items);
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

  async execute(keys, createActions) {
    if (!this.ready) throw new Error(this.error || 'Wait for the to-do list to reconnect.');
    if (keys.some(key => this.pending.has(key))) return false;
    const actions = createActions(this.items).filter(Boolean);
    if (!actions.length) return false;
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
    if (this.listeners.size || this.pending.size) return;
    this.closed = true;
    this._generation++;
    this._stopSubscription();
    this._clearRetry();
    this._onDispose();
  }
}