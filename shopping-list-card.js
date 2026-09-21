function buildName(config, subtitle) {
  const base = subtitle ? `${config.title} - ${subtitle}` : config.title;
  return config.list_prefix ? `${config.list_prefix} - ${base}` : base;
}

function keepZero(config) {
  return !!config.enable_quantity && config.remove_zero === false;
}

function itemSummary(config, fullName, quantity) {
  if (!config.enable_quantity) return fullName;
  return keepZero(config) || quantity > 1 ? `${fullName} (${quantity})` : fullName;
}

function matchItem(items, fullName, config) {
  const escaped = fullName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escaped}(?: \\((\\d+)\\))?$`, 'i');
  for (const item of items || []) {
    if (typeof item.summary !== 'string') continue;
    const match = item.summary.match(pattern);
    if (!match) continue;
    const quantity = match[1] != null ? Number(match[1]) : 1;
    return {
      isOn: keepZero(config) ? quantity > 0 : true,
      present: true, qty: quantity, matched: item.summary, matchedUid: item.uid,
    };
  }
  return { isOn: false, present: false, qty: 0, matched: null, matchedUid: null };
}

function planItemAction(config, items, subtitle, action = 'toggle') {
  const fullName = buildName(config, subtitle);
  const state = matchItem(items, fullName, config);
  const key = fullName.toLowerCase();
  const target = state.matchedUid || state.matched;
  const findTarget = current => current.find(item => state.matchedUid
    ? item.uid === state.matchedUid : item.summary === state.matched);
  const remove = () => ({
    key, service: 'remove_item', data: { item: target },
    confirmed: current => !findTarget(current),
  });
  if (action === 'remove') return state.present ? remove() : null;

  let quantity;
  if (action === 'increment' || action === 'decrement') {
    if (!state.present) return null;
    const step = Math.max(1, parseInt(config.quantity_step, 10) || 1);
    const maximum = parseInt(config.quantity_max, 10);
    quantity = action === 'increment' ? state.qty + step
      : Math.max(keepZero(config) ? 0 : 1, state.qty - step);
    if (action === 'increment' && maximum > 0) quantity = Math.min(quantity, maximum);
    if (quantity === state.qty) return null;
  } else if (keepZero(config)) {
    quantity = state.qty > 0 ? 0 : 1;
  } else if (state.isOn) {
    return !config.enable_quantity || state.qty === 1 ? remove() : null;
  } else {
    quantity = 1;
  }

  const summary = itemSummary(config, fullName, quantity);
  if (!state.present) {
    return {
      key, service: 'add_item', data: { item: summary },
      confirmed: current => current.some(item => item.summary?.toLowerCase() === summary.toLowerCase()),
    };
  }
  return {
    key, service: 'update_item', data: { item: target, rename: summary },
    confirmed: current => state.matchedUid
      ? findTarget(current)?.summary === summary
      : current.some(item => item.summary === summary),
  };
}

function updateTypeNames(previous, text) {
  const names = text.split('\n').map(name => name.trim()).filter(Boolean);
  const entries = Array.isArray(previous) ? previous
    : typeof previous === 'string' ? previous.split(/[,\n]/) : [];
  const entryName = entry => String(typeof entry === 'string' ? entry : entry?.name || '').trim();
  const used = new Set();
  return names.map((name, index) => {
    let match = entries.findIndex((entry, entryIndex) => !used.has(entryIndex)
      && entryName(entry).toLowerCase() === name.toLowerCase());
    if (match === -1 && entries.length === names.length && !used.has(index)
      && !names.some(next => next.toLowerCase() === entryName(entries[index]).toLowerCase())) {
      match = index;
    }
    used.add(match);
    const original = entries[match];
    return original && typeof original === 'object' ? { ...original, name } : name;
  });
}

const stores = new WeakMap();

function getTodoStore(hass, entityId) {
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

const CARD_DEFAULTS = {
  DEFAULT_ON_ICON: 'mdi:check',
  DEFAULT_OFF_ICON: 'mdi:plus',
  DEFAULT_ON_COLOR: 'green',
  DEFAULT_OFF_COLOR: 'grey',
  COLOR_MAP: {
    red: '#F44336', pink: '#E91E63', purple: '#9C27B0',
    'deep-purple': '#673AB7', indigo: '#3F51B5',
    blue: '#2196F3', 'light-blue': '#03A9F4',
    cyan: '#00BCD4', teal: '#009688', green: '#4CAF50',
    lime: '#CDDC39', yellow: '#FFEB3B', amber: '#FFC107',
    orange: '#FF9800', brown: '#795548', grey: '#9E9E9E',
    'blue-grey': '#607D8B',
  },
};

const CARD_STYLES = `
      ha-card { box-sizing: border-box; border-radius: var(--ha-card-border-radius,12px); box-shadow: var(--ha-card-box-shadow); overflow:hidden; background: var(--ha-card-background, var(--card-background-color)); }
      .card-content { padding:0 !important; margin: -1px 0; }
      .card-container { display:flex; align-items:center; padding:10px 12px; gap:10px; cursor:pointer; transition:background-color .2s; box-sizing: border-box; outline: none; }
      .card-container:hover { background: var(--secondary-background-color) }
      .card-container:focus-visible { box-shadow: 0 0 0 2px var(--primary-color); }
      .card-container.is-updating { opacity: .6; cursor: wait; }
      .card-container.is-unavailable { opacity: .6; cursor: not-allowed; }
      .list-status:empty { display: none; }
      .list-status { padding: 8px; overflow-wrap: anywhere; }
      .refresh-list { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; padding: 0; margin-inline-start: 4px; border: 0; border-radius: 4px; background: transparent; color: inherit; cursor: pointer; vertical-align: middle; }
      .refresh-list:focus-visible { outline: 2px solid var(--primary-color); }
      .quantity-btn { cursor: pointer; }
      .quantity-btn:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 1px; }

      /* Icon-only mode */
      .card-container.vertical-layout.no-name { justify-content: center; height: 56px; }
      .card-container.vertical-layout.no-name .vertical-top-block { top: 50%; transform: translateY(-50%); }
      .card-container.vertical-layout.no-name .icon-wrapper.vertical-icon { width: 36px; height: 36px; }
      .card-container.vertical-layout.no-name .icon-wrapper.vertical-icon ha-icon { --mdc-icon-size: 22px; }
      .card-container.vertical-layout.no-name .image-wrapper.vertical-image { max-height: 36px; }
      .card-container.vertical-layout.no-name .image-wrapper.vertical-image img { max-height: 36px; }
      .card-container.vertical-layout.no-name .image-wrapper.vertical-image.image-error { width: 36px; height: 36px; }
      /* Horizontal no-name: keep icon at left, quantity at right */
      .card-container:not(.vertical-layout).no-name .quantity-controls { margin-left: auto; }

      /* Vertical Layout */
      .card-container.vertical-layout { display: block; height: 120px; position: relative; }
      .vertical-top-block { position: absolute; top: 18px; left: 16px; right: 16px; display: flex; justify-content: center; }
      .vertical-layout .info-container { position: absolute; bottom: 12px; left: 16px; right: 16px; height: 40px; display: flex; flex-direction: column; justify-content: center; }

      .vertical-icon-container { display: flex; align-items: center; justify-content: center; gap: 8px; }

      .icon-wrapper { display:flex; align-items:center; justify-content:center; width:36px; height:36px; border-radius:50%; flex-shrink:0; position: relative; }
      .image-wrapper { position:relative; width:36px; height:36px; flex-shrink:0 }
      .image-wrapper img { width:100%; height:100%; object-fit:cover; border-radius:50% }
      .image-wrapper .icon-wrapper { position:absolute; top:0; left:0; width:100%; height:100%; display:none; }
      .image-wrapper.image-error .icon-wrapper { display:flex; }

      .icon-wrapper.vertical-icon { width: 48px; height: 48px; }
      .icon-wrapper.vertical-icon ha-icon { --mdc-icon-size: 28px; }

      .image-wrapper.vertical-image { width: auto; height: auto; max-height: 48px; position: relative; }
      .image-wrapper.vertical-image img { object-fit: contain; border-radius: 4px; width: auto; height: auto; max-width: 100%; max-height: 48px; }
      .image-wrapper.vertical-image.image-error { width: 48px; height: 48px; }
      .image-wrapper.vertical-image.image-error .icon-wrapper { position: static; }

      .info-container { flex-grow:1; overflow:hidden; min-width:0; }
      .primary { font-size:14px; font-weight:500; line-height:20px; color:var(--primary-text-color); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .secondary { font-size:12px; font-weight:400; line-height:16px; color:var(--secondary-text-color); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .vertical-layout .primary, .vertical-layout .secondary { text-align: center; }

      /* Quantity Controls */
      .quantity-controls { display:flex; align-items:center; gap:4px; flex-shrink:0 }
      .quantity { font-size:14px; font-weight:500; min-width:20px; text-align:center }
      .quantity-btn { width:24px; height:24px; background:rgba(128,128,128,0.2); border-radius:5px; display:flex; align-items:center; justify-content:center; transition: background-color 0.2s; }
      .quantity-btn:hover { background:rgba(128,128,128,0.4); }
      .quantity-btn ha-icon { --mdc-icon-size: 20px; }
      .quantity-badge { position: absolute; top: -4px; right: -4px; background-color: var(--primary-color); color: white; border-radius: 50%; width: 18px; height: 18px; font-size: 11px; display: flex; align-items: center; justify-content: center; font-weight: 500; border: 2px solid var(--card-background-color); }
      .quantity-btn-placeholder { width: 24px; height: 24px; flex-shrink: 0; }

      /* Types (variants) mode */
      .card-container.types-mode { display: block; padding: 0; cursor: default; }
      .card-container.types-mode:hover { background: transparent; }
      /* Types cards grow with their content; never inherit the fixed 120px
         height from the normal vertical-layout tile. */
      .card-container.types-mode.vertical-layout { height: auto; }
      .types-header { display: flex; align-items: center; gap: 10px; padding: 10px 12px; cursor: pointer; transition: background-color .2s; }
      .types-header:hover { background: var(--secondary-background-color); }
      .types-header:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--primary-color) inset; }
      .types-header.is-updating { opacity: .6; pointer-events: none; }
      .types-chevron { flex-shrink: 0; color: var(--secondary-text-color); transition: transform .25s ease, background-color .2s; cursor: pointer; border-radius: 50%; padding: 2px; }
      .types-chevron:hover { background: var(--divider-color); }
      .types-chevron:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--primary-color); }
      .card-container.types-mode.expanded .types-chevron { transform: rotate(180deg); }
      .types-list { max-height: 0; overflow: hidden; transition: max-height .3s ease; }
      .card-container.types-mode.expanded .types-list { max-height: 2000px; }

      /* Vertical types header: reuse the normal vertical-tile shape. The header
         is a fixed-height (120px) relative block with the icon absolutely
         positioned top-center, the name / subtitle bottom-center, and the
         chevron in the bottom-right corner. The variant list expands below,
         exactly like the horizontal layout. */
      .types-header.vertical-header { display: block; height: 120px; position: relative; padding: 0 8px; cursor: default; }
      .types-header.vertical-header:hover { background: transparent; }
      .types-header.vertical-header .vertical-top-block { position: absolute; top: 18px; left: 16px; right: 16px; display: flex; justify-content: center; }
      .types-header.vertical-header .info-container { position: absolute; bottom: 12px; left: 16px; right: 16px; height: 40px; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; }
      .types-header.vertical-header .primary,
      .types-header.vertical-header .secondary { text-align: center; width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      /* Keep the subtitle clear of the bottom-right chevron: symmetric padding
         keeps it centered while ellipsizing before it reaches the button. */
      .types-header.vertical-header .secondary { padding: 0 28px; box-sizing: border-box; }
      .types-header.vertical-header .types-chevron { position: absolute; bottom: 8px; right: 10px; --mdc-icon-size: 22px; opacity: .85; }
      .type-row { display: flex; align-items: center; gap: 10px; min-height: 44px; box-sizing: border-box; padding: 7px 12px 7px 14px; cursor: pointer; border-top: 1px solid var(--divider-color); transition: background-color .2s; outline: none; }
      .type-row:hover { background: var(--secondary-background-color); }
      .type-row:focus-visible { box-shadow: 0 0 0 2px var(--primary-color) inset; }
      .type-row.is-updating { opacity: .6; pointer-events: none; }
      .type-thumb { width: 28px; height: 28px; flex-shrink: 0; }
      .type-thumb img { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; }
      .type-name { flex: 1; min-width: 0; font-size: 14px; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .type-qty { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
      .type-indicator { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
      .type-indicator ha-icon { --mdc-icon-size: 20px; }
      .type-indicator.type-add ha-icon { color: var(--secondary-text-color); opacity: .45; }
`;

class ShoppingListCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._rendered = false;
    this._hasInitialized = false;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._rendered) { this._render(); return; }
    this.shadowRoot.querySelectorAll(
      'ha-entity-picker, ha-icon-picker, ha-picture-upload'
    ).forEach(el => { el.hass = hass; });
  }

  setConfig(config) {
    this._config = { ...config };
    if (this._rendered) this._updateFormValues();
  }

  _render() {
    if (!this.shadowRoot || !this._hass) return;

    const todoEntities = Object.keys(this._hass.states).filter(id => id.startsWith('todo.'));
    const hasTodoEntities = todoEntities.length > 0;

    // HA 2026.x removed `ha-textfield` (replaced by web-awesome based
    // `ha-input`). Prefer the legacy element when it is still registered for
    // backward compatibility, otherwise fall back to `ha-input`. Both expose a
    // `.value` property and emit native input/change events, and both ignore
    // each other's helper attribute (`helper` vs `hint`), so we set both.
    const TF = (!customElements.get('ha-textfield') && customElements.get('ha-input'))
      ? 'ha-input' : 'ha-textfield';

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        .card-config { display: flex; flex-direction: column; gap: 12px; }
        ha-expansion-panel {
          --expansion-panel-summary-padding: 0 16px;
          --expansion-panel-content-padding: 0;
          border: 1px solid var(--divider-color);
          border-radius: 8px;
          background: var(--card-background-color);
          overflow: hidden;
        }
        .panel-body {
          padding: 0 16px 16px 16px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .row { display: flex; gap: 12px; }
        .row > * { flex: 1; min-width: 0; }
        ha-textfield,
        ha-input,
        ha-entity-picker,
        ha-icon-picker,
        ha-select,
        ha-picture-upload { width: 100%; display: block; }
        .toggle-row {
          display: flex; align-items: center; gap: 16px;
          padding: 4px 0;
          cursor: pointer;
          user-select: none;
        }
        .toggle-row ha-switch { flex-shrink: 0; }
        .toggle-text { display: flex; flex-direction: column; flex: 1; min-width: 0; }
        .toggle-title {
          font-size: 14px; font-weight: 500;
          color: var(--primary-text-color);
        }
        .toggle-desc {
          font-size: 12px; line-height: 1.4;
          color: var(--secondary-text-color); margin-top: 2px;
        }
        .color-group { display: flex; flex-direction: column; gap: 8px; }
        .color-group-label {
          font-size: 13px; font-weight: 500;
          color: var(--secondary-text-color);
          text-transform: uppercase; letter-spacing: 0.04em;
          margin-bottom: -4px;
        }
        .color-row {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 8px; align-items: center;
        }
        .swatch {
          width: 40px; height: 40px; padding: 0;
          border: 1px solid var(--divider-color);
          border-radius: 6px; cursor: pointer; background: none;
          flex-shrink: 0;
        }
        .hint {
          font-size: 12px; line-height: 1.4;
          color: var(--secondary-text-color);
        }
        .hint code {
          background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.08);
          padding: 1px 4px; border-radius: 3px;
          font-size: 11px;
        }
        .info-box {
          background: var(--warning-color);
          color: var(--primary-background-color);
          padding: 10px 14px; border-radius: 8px;
          font-size: 13px; line-height: 1.5;
        }
        .info-box a { color: inherit; text-decoration: underline; }
        .image-fallback {
          display: flex; flex-direction: column; gap: 6px;
        }
        .types-field { display: flex; flex-direction: column; gap: 6px; }
        .types-label {
          font-size: 13px; font-weight: 500;
          color: var(--secondary-text-color);
        }
        .types-field textarea {
          width: 100%; box-sizing: border-box; resize: vertical; min-height: 64px;
          font-family: inherit; font-size: 14px; line-height: 1.5;
          color: var(--primary-text-color);
          background: var(--mdc-text-field-fill-color, rgba(127,127,127,0.08));
          border: none;
          border-bottom: 1px solid var(--mdc-text-field-idle-line-color, rgba(127,127,127,0.42));
          border-radius: 4px 4px 0 0; padding: 8px 12px;
        }
        .types-field textarea:focus {
          outline: none;
          border-bottom: 2px solid var(--primary-color);
        }
      </style>

      <div class="card-config">
        ${!hasTodoEntities ? `
          <div class="info-box">
            <strong>No to-do lists found.</strong>
            You need a to-do entity before this card will work.
            <a href="https://www.home-assistant.io/integrations/todo/" target="_blank" rel="noopener">Learn more</a>
          </div>
        ` : ''}

        <ha-expansion-panel outlined expanded header="Content" data-panel="content">
          <div class="panel-body">
            <ha-entity-picker id="todo_list" label="To-do list entity" required></ha-entity-picker>
            <div class="row">
              <${TF} id="title" label="Title" required></${TF}>
              <${TF} id="subtitle" label="Subtitle"></${TF}>
            </div>
            <div class="types-field">
              <span class="types-label">Types (optional)</span>
              <textarea id="types" rows="3" placeholder="Pink Lady&#10;Granny Smith&#10;Gala"></textarea>
              <div class="hint">One per line. The chevron expands the variants; the header toggles the title and its optional subtitle. Existing per-variant images and icons are preserved.</div>
            </div>
            <ha-select id="types_sort" label="Sort types" naturalMenuWidth fixedMenuPosition>
              <mwc-list-item value="none">As listed</mwc-list-item>
              <mwc-list-item value="asc">Alphabetical (A-Z)</mwc-list-item>
              <mwc-list-item value="desc">Alphabetical (Z-A)</mwc-list-item>
            </ha-select>
            <ha-picture-upload id="image_upload"></ha-picture-upload>
            <div class="image-fallback">
              <${TF} id="image" label="Image URL (optional)" placeholder="/local/... or https://..."></${TF}>
              <${TF} id="image_base" label="Image base path (optional)" placeholder="/local/images/shopping-list/"></${TF}>
              <div class="hint">Upload an image above or paste a URL. Or set a base path and the card will try <code>title.png</code> in several variants (dash, underscore, space, joined) from the title.</div>
            </div>
            <${TF} id="list_prefix" label="List prefix (optional)" placeholder="e.g. Dairy" helper="Stored in the list as 'Prefix - Title' for category sorting; display is unchanged." hint="Stored in the list as 'Prefix - Title' for category sorting; display is unchanged."></${TF}>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined header="Layout &amp; Display" data-panel="layout">
          <div class="panel-body">
            <ha-select id="layout" label="Layout" naturalMenuWidth fixedMenuPosition>
              <mwc-list-item value="horizontal">Horizontal</mwc-list-item>
              <mwc-list-item value="vertical">Vertical</mwc-list-item>
            </ha-select>
            <label class="toggle-row">
              <ha-switch id="show_name"></ha-switch>
              <div class="toggle-text">
                <span class="toggle-title">Show title and subtitle</span>
                <span class="toggle-desc">Turn off for an icon-only card.</span>
              </div>
            </label>
            <label class="toggle-row">
              <ha-switch id="colorize_background"></ha-switch>
              <div class="toggle-text">
                <span class="toggle-title">Tint background when on</span>
                <span class="toggle-desc">Subtle wash of the on-color across the card.</span>
              </div>
            </label>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined header="Icons &amp; Colors" data-panel="icons">
          <div class="panel-body">
            <div class="color-group">
              <span class="color-group-label">Off state</span>
              <ha-icon-picker id="off_icon" label="Off icon"></ha-icon-picker>
              <div class="color-row">
                <${TF} id="off_color" label="Off color"></${TF}>
                <input type="color" class="swatch" id="off_color_picker" title="Pick off color" />
              </div>
            </div>
            <div class="color-group">
              <span class="color-group-label">On state</span>
              <ha-icon-picker id="on_icon" label="On icon"></ha-icon-picker>
              <div class="color-row">
                <${TF} id="on_color" label="On color"></${TF}>
                <input type="color" class="swatch" id="on_color_picker" title="Pick on color" />
              </div>
            </div>
            <div class="hint">
              Use an HA color name (<code>red</code>, <code>blue</code>, <code>green</code>...) to follow the theme, or a <code>#hex</code> value.
            </div>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined header="Behavior" data-panel="behavior">
          <div class="panel-body">
            <label class="toggle-row">
              <ha-switch id="enable_quantity"></ha-switch>
              <div class="toggle-text">
                <span class="toggle-title">Enable quantity</span>
                <span class="toggle-desc">Show + / - buttons to track how many of this item you need.</span>
              </div>
            </label>
            <div class="row">
              <${TF} id="quantity_step" label="Quantity step" type="number" min="1" max="99" helper="How much +/- adjusts" hint="How much +/- adjusts"></${TF}>
              <${TF} id="quantity_max" label="Quantity max" type="number" min="1" max="999" helper="Optional cap" hint="Optional cap"></${TF}>
            </div>
            <label class="toggle-row">
              <ha-switch id="keep_at_zero"></ha-switch>
              <div class="toggle-text">
                <span class="toggle-title">Keep item at zero</span>
                <span class="toggle-desc">Keep the item as "Name (0)" instead of deleting it, and always show the quantity in parentheses.</span>
              </div>
            </label>
            <ha-select id="hold_action" label="Hold action" naturalMenuWidth fixedMenuPosition>
              <mwc-list-item value="default">Remove item (default)</mwc-list-item>
              <mwc-list-item value="more-info">Open more-info</mwc-list-item>
              <mwc-list-item value="none">None</mwc-list-item>
            </ha-select>
            <label class="toggle-row">
              <ha-switch id="haptic"></ha-switch>
              <div class="toggle-text">
                <span class="toggle-title">Haptic feedback</span>
                <span class="toggle-desc">Short vibration on tap and hold (mobile only).</span>
              </div>
            </label>
          </div>
        </ha-expansion-panel>
      </div>
    `;

    // Wire hass-consuming components
    const ep = this.shadowRoot.querySelector('#todo_list');
    ep.hass = this._hass;
    ep.includeDomains = ['todo'];
    ep.allowCustomEntity = false;
    this.shadowRoot.querySelectorAll('ha-icon-picker').forEach(el => { el.hass = this._hass; });

    // Trigger lazy-loading of ha-picture-upload if HA hasn't loaded it yet.
    this._ensurePictureUploadLoaded();
    const pu = this.shadowRoot.querySelector('#image_upload');
    if (pu) {
      pu.hass = this._hass;
      pu.original = false;
      pu.crop = undefined;
      pu.addEventListener('change', () => {
        const tf = this.shadowRoot.querySelector('#image');
        tf.value = pu.value || '';
        this._handleConfigChanged();
      });
    }

    // Field change listeners (non-select)
    this.shadowRoot.querySelectorAll(
      'ha-textfield, ha-input, ha-switch, ha-entity-picker, ha-icon-picker'
    ).forEach(el => {
      const handler = () => this._handleConfigChanged();
      el.addEventListener('input', handler);
      el.addEventListener('change', handler);
      el.addEventListener('value-changed', handler);
    });

    // Native <textarea> for the Types list (one type per line).
    const typesEl = this.shadowRoot.querySelector('#types');
    if (typesEl) {
      const handler = () => this._handleConfigChanged();
      typesEl.addEventListener('input', handler);
      typesEl.addEventListener('change', handler);
    }

    // ha-select needs special handling. In HA 2026.x, ha-select was rewritten
    // to use ha-dropdown internally and IGNORES slotted <mwc-list-item>
    // children - it only renders from the `.options` property. Older HA uses
    // slotted children and fires `selected` with ev.detail.index (not value).
    // We set `.options` for the new component and keep the children for the
    // old one, then normalize the event shape.
    const SELECT_OPTIONS = {
      layout: [
        { value: 'horizontal', label: 'Horizontal' },
        { value: 'vertical', label: 'Vertical' },
      ],
      hold_action: [
        { value: 'default', label: 'Remove item (default)' },
        { value: 'more-info', label: 'Open more-info' },
        { value: 'none', label: 'None' },
      ],
      types_sort: [
        { value: 'none', label: 'As listed' },
        { value: 'asc', label: 'Alphabetical (A-Z)' },
        { value: 'desc', label: 'Alphabetical (Z-A)' },
      ],
    };
    this.shadowRoot.querySelectorAll('ha-select').forEach(el => {
      const opts = SELECT_OPTIONS[el.id];
      if (opts) {
        try { el.options = opts; } catch (_) {}
      }
      const capture = (ev) => {
        ev.stopPropagation();
        let v = ev?.detail?.value;
        // Older mwc-select fires `selected` with ev.detail.index. Map it.
        if ((v == null || v === '') && ev?.detail && typeof ev.detail.index === 'number' && opts) {
          v = opts[ev.detail.index]?.value;
        }
        // Final fallback: whatever the element itself reports.
        if (v == null || v === '') v = el.value;
        if (typeof v === 'string' && v !== '') {
          el._slcValue = v;
          try { if (el.value !== v) el.value = v; } catch (_) {}
        }
        this._handleConfigChanged();
      };
      el.addEventListener('selected', capture);
      el.addEventListener('change', capture);
      el.addEventListener('closed', (e) => e.stopPropagation());
    });

    // Color swatch <-> textfield sync
    ['off', 'on'].forEach(type => {
      const tf = this.shadowRoot.querySelector(`#${type}_color`);
      const cp = this.shadowRoot.querySelector(`#${type}_color_picker`);
      cp.addEventListener('input', () => {
        tf.value = cp.value;
        this._handleConfigChanged();
      });
      tf.addEventListener('input', () => {
        const hex = this._getEditorHex(tf.value);
        if (hex) cp.value = hex;
        this._handleConfigChanged();
      });
    });

    this._rendered = true;
    if (this._config) this._updateFormValues();
  }

  /**
   * Force-load ha-picture-upload by creating a hidden ha-form whose schema
   * uses the image-upload media selector. HA lazy-loads ha-picture-upload
   * the first time that selector is rendered, after which the browser will
   * upgrade our existing <ha-picture-upload> placeholder.
   */
  _ensurePictureUploadLoaded() {
    if (customElements.get('ha-picture-upload')) return;
    try {
      const loader = document.createElement('ha-form');
      loader.style.display = 'none';
      loader.schema = [{
        name: 'image',
        selector: { media: { accept: ['image/*'], image_upload: true, clearable: true, hide_content_type: true } },
      }];
      loader.data = {};
      loader.hass = this._hass;
      this.shadowRoot.appendChild(loader);
      customElements.whenDefined('ha-picture-upload').then(() => {
        const pu = this.shadowRoot.querySelector('#image_upload');
        if (pu) {
          pu.hass = this._hass;
          if (this._config?.image) pu.value = this._config.image;
        }
      }).catch(() => {});
      setTimeout(() => loader.remove(), 0);
    } catch (_) { /* ignore */ }
  }

  /** Robust ha-select value reader. Prefers the value captured from the
   *  `selected`/`change` event (stashed on the element as _slcValue) because
   *  mwc-select in newer HA sometimes fires `selected` before updating its
   *  own .value. Falls back to .value, then to the selected item's value. */
  _selectVal(id) {
    const el = this.shadowRoot.querySelector('#' + id);
    if (!el) return '';
    if (typeof el._slcValue === 'string' && el._slcValue !== '') return el._slcValue;
    if (typeof el.value === 'string' && el.value !== '') return el.value;
    const sel = el.selected;
    if (sel && typeof sel.value === 'string' && sel.value !== '') return sel.value;
    return '';
  }

  _getEditorHex(val) {
    if (!val) return '#000000';
    if (val.startsWith('#')) return val;
    const hex = CARD_DEFAULTS.COLOR_MAP[val.toLowerCase()];
    return hex || '#000000';
  }

  _updateFormValues() {
    const s = this.shadowRoot;
    const c = this._config;

    let todoEntity = c.todo_list;
    let shouldAutoPopulate = false;
    if (!todoEntity && this._hass && !this._hasInitialized) {
      const todoEntities = Object.keys(this._hass.states).filter(id => id.startsWith('todo.'));
      if (todoEntities.length > 0) { todoEntity = todoEntities[0]; shouldAutoPopulate = true; }
      this._hasInitialized = true;
    }

    s.querySelector('#title').value = c.title || '';
    s.querySelector('#subtitle').value = c.subtitle || '';
    const typesEl = s.querySelector('#types');
    if (typesEl) {
      let arr = [];
      if (Array.isArray(c.types)) {
        arr = c.types.map(t => (typeof t === 'string' ? t : (t && t.name) || '')).filter(Boolean);
      } else if (typeof c.types === 'string') {
        arr = c.types.split(/[,\n]/).map(x => x.trim()).filter(Boolean);
      }
      typesEl.value = arr.join('\n');
    }
    const sortEl = s.querySelector('#types_sort');
    if (sortEl) {
      const sortVal = (c.types_sort === 'asc' || c.types_sort === 'desc') ? c.types_sort : 'none';
      sortEl.value = sortVal;
      sortEl._slcValue = sortVal;
    }
    s.querySelector('#image').value = c.image || '';
    s.querySelector('#image_base').value = c.image_base || '';
    s.querySelector('#list_prefix').value = c.list_prefix || '';
    const pu = s.querySelector('#image_upload');
    if (pu) pu.value = c.image || '';
    s.querySelector('#todo_list').value = c.todo_list || '';
    s.querySelector('#enable_quantity').checked = !!c.enable_quantity;
    s.querySelector('#keep_at_zero').checked = c.remove_zero === false;
    s.querySelector('#colorize_background').checked = c.colorize_background !== false;
    s.querySelector('#show_name').checked = c.show_name !== false;
    const layoutVal = c.layout === 'vertical' ? 'vertical' : 'horizontal';
    const layoutEl = s.querySelector('#layout');
    layoutEl.value = layoutVal;
    layoutEl._slcValue = layoutVal;
    s.querySelector('#haptic').checked = !!c.haptic;
    const holdVal = (c.hold_action?.action) || 'default';
    const holdEl = s.querySelector('#hold_action');
    holdEl.value = holdVal;
    holdEl._slcValue = holdVal;
    s.querySelector('#quantity_step').value = c.quantity_step != null ? c.quantity_step : '';
    s.querySelector('#quantity_max').value = c.quantity_max != null ? c.quantity_max : '';

    if (shouldAutoPopulate && todoEntity) {
      s.querySelector('#todo_list').value = todoEntity;
      setTimeout(() => this._handleConfigChanged(), 100);
    }

    ['off','on'].forEach(type => {
      s.querySelector(`#${type}_icon`).value = c[`${type}_icon`] || CARD_DEFAULTS[`DEFAULT_${type.toUpperCase()}_ICON`];
      const col = c[`${type}_color`] || CARD_DEFAULTS[`DEFAULT_${type.toUpperCase()}_COLOR`];
      s.querySelector(`#${type}_color`).value = col;
      s.querySelector(`#${type}_color_picker`).value = this._getEditorHex(col);
    });
  }

  _handleConfigChanged() {
    const s = this.shadowRoot;
    const n = { ...this._config };

    n.title = s.querySelector('#title').value;
    const sub = s.querySelector('#subtitle').value;
    if (sub) n.subtitle = sub; else delete n.subtitle;
    const typesEl = s.querySelector('#types');
    if (typesEl) {
      const list = updateTypeNames(n.types, typesEl.value);
      if (list.length) n.types = list; else delete n.types;
    }
    const sortVal = this._selectVal('types_sort');
    if (sortVal === 'asc' || sortVal === 'desc') n.types_sort = sortVal; else delete n.types_sort;
    const img = s.querySelector('#image').value;
    if (img) n.image = img; else delete n.image;
    const imgBase = s.querySelector('#image_base').value.trim();
    if (imgBase) n.image_base = imgBase; else delete n.image_base;
    const prefix = s.querySelector('#list_prefix').value.trim();
    if (prefix) n.list_prefix = prefix; else delete n.list_prefix;
    n.todo_list = s.querySelector('#todo_list').value;

    const enableQty = s.querySelector('#enable_quantity').checked;
    if (enableQty) n.enable_quantity = true; else delete n.enable_quantity;

    // `remove_zero` defaults to true (delete at zero); only persist the opt-out.
    const keepAtZero = s.querySelector('#keep_at_zero').checked;
    if (keepAtZero) n.remove_zero = false; else delete n.remove_zero;

    const colorBg = s.querySelector('#colorize_background').checked;
    if (colorBg) delete n.colorize_background; else n.colorize_background = false;

    const showName = s.querySelector('#show_name').checked;
    if (showName) delete n.show_name; else n.show_name = false;

    const haptic = s.querySelector('#haptic').checked;
    if (haptic) n.haptic = true; else delete n.haptic;

    const layoutVal = this._selectVal('layout');
    if (layoutVal === 'vertical') n.layout = 'vertical'; else delete n.layout;

    const holdVal = this._selectVal('hold_action') || 'default';
    if (holdVal === 'default') delete n.hold_action;
    else n.hold_action = { action: holdVal };

    const stepRaw = s.querySelector('#quantity_step').value;
    const stepNum = parseInt(stepRaw, 10);
    if (stepRaw && !isNaN(stepNum) && stepNum > 1) n.quantity_step = stepNum;
    else delete n.quantity_step;

    const maxRaw = s.querySelector('#quantity_max').value;
    const maxNum = parseInt(maxRaw, 10);
    if (maxRaw && !isNaN(maxNum) && maxNum > 0) n.quantity_max = maxNum;
    else delete n.quantity_max;

    ['off','on'].forEach(type => {
      const icon = s.querySelector(`#${type}_icon`).value;
      if (icon === CARD_DEFAULTS[`DEFAULT_${type.toUpperCase()}_ICON`]) delete n[`${type}_icon`];
      else n[`${type}_icon`] = icon;

      const col = s.querySelector(`#${type}_color`).value;
      if (col === CARD_DEFAULTS[`DEFAULT_${type.toUpperCase()}_COLOR`]) delete n[`${type}_color`];
      else n[`${type}_color`] = col;
    });

    this._config = n;
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: n }, bubbles: true, composed: true }));
  }
}
if (!customElements.get('shopping-list-card-editor')) {
  customElements.define('shopping-list-card-editor', ShoppingListCardEditor);
}

/*
 * Shopping List Card
 *
 * A Home Assistant Lovelace card to manage items on a to-do list with a
 * clean, modern interface and a visual editor.
 *
 * Author: eyalgal
 * License: MIT
 * Version: 2.2.0
 *
 * Note: This card requires a to-do entity to function properly.
 * For more information, visit: https://github.com/eyalgal/ha-shopping-list-card
 */


const CARD_VERSION = '2.2.0';

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Card ─────────────────────────────────────────────────────────────────────

class ShoppingListCard extends HTMLElement {
  static DEFAULT_ON_ICON    = CARD_DEFAULTS.DEFAULT_ON_ICON;
  static DEFAULT_OFF_ICON   = CARD_DEFAULTS.DEFAULT_OFF_ICON;
  static DEFAULT_ON_COLOR   = CARD_DEFAULTS.DEFAULT_ON_COLOR;
  static DEFAULT_OFF_COLOR  = CARD_DEFAULTS.DEFAULT_OFF_COLOR;
  static COLOR_MAP = CARD_DEFAULTS.COLOR_MAP;

  constructor() {
    super();
    this._isUpdating = false;
    this._items = null;
    this._unsubscribe = null;
    this._store = null;
    this._syncState = null;
    this._actionError = null;
    this._configVersion = 0;
    this._lastRenderKey = null;
    this._expanded = false;
    this._holdCleanups = new Set();
    this._suppressClick = false;
    this._clickResetTimer = null;
    this.addEventListener('click', event => {
      if (!this._suppressClick) return;
      this._suppressClick = false;
      clearTimeout(this._clickResetTimer);
      this._clickResetTimer = null;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
  }

  set hass(hass) {
    this._hass = hass;
    if (this._config && this.isConnected) this._ensureSubscription();
  }

  setConfig(config) {
    if (typeof config.title !== 'string' || !config.title.trim()) throw new Error('You must define a title.');
    if (typeof config.todo_list !== 'string' || !config.todo_list.startsWith('todo.')) {
      throw new Error('You must define a todo_list entity_id.');
    }
    const prev = this._config;
    this._clearHolds();
    this._config = { ...config };
    this._configVersion++;
    this._actionError = null;
    this._isUpdating = false;
    this._lastRenderKey = null;
    if (prev && prev.todo_list !== config.todo_list) {
      this._items = null;
      this._teardownSubscription();
    }
    if (this._hass && this.isConnected) {
      this._ensureSubscription();
      this._render();
    }
  }

  connectedCallback() {
    if (this._hass && this._config) this._ensureSubscription();
  }

  disconnectedCallback() {
    this._clearHolds();
    clearTimeout(this._clickResetTimer);
    this._clickResetTimer = null;
    this._suppressClick = false;
    this._teardownSubscription();
    this._configVersion++;
    this._isUpdating = false;
  }

  _ensureSubscription() {
    if (!this._hass || !this._config?.todo_list) return;
    if (this._store?.entityId === this._config.todo_list
      && this._store.connection === this._hass.connection && this._unsubscribe) {
      this._store.updateHass(this._hass);
      return;
    }
    this._teardownSubscription();
    this._items = null;
    const store = getTodoStore(this._hass, this._config.todo_list);
    this._store = store;
    this._unsubscribe = store.subscribe(snapshot => {
      if (this._store !== store) return;
      this._syncState = snapshot;
      this._items = snapshot.items;
      this._render();
    });
  }

  _teardownSubscription() {
    const unsubscribe = this._unsubscribe;
    this._unsubscribe = null;
    this._store = null;
    this._syncState = null;
    unsubscribe?.();
  }

  static getConfigElement() { return document.createElement('shopping-list-card-editor'); }
  static getStubConfig() {
    return {
      type: 'custom:shopping-list-card',
      title: 'New Item',
      todo_list: '' // Add empty string to pass validation, editor will populate
    };
  }

  /** Build the todo item summary to match / write, honoring list_prefix. */
  _buildFullName() {
    return this._buildNameFor(this._config.subtitle);
  }

  /** Build a summary for a given subtitle/type, honoring list_prefix. */
  _buildNameFor(subtitle) {
    return buildName(this._config, subtitle);
  }

  /** Normalized list of configured types (variants). Each entry is an object
   *  `{ name, image?, icon? }`. Accepts plain strings or objects in config.
   *  Returns an empty array when no types are configured. */
  _getTypes() {
    let raw = this._config && this._config.types;
    // Accept a comma / newline separated string (handy when the list comes
    // from a JSON catalog, e.g. "Pink Lady, Granny Smith, Gala").
    if (typeof raw === 'string') {
      raw = raw.split(/[,\n]/).map(x => x.trim()).filter(Boolean);
    }
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const entry of raw) {
      if (typeof entry === 'string') {
        const name = entry.trim();
        if (name) out.push({ name });
      } else if (entry && typeof entry === 'object' && entry.name != null) {
        const name = String(entry.name).trim();
        if (name) out.push({ name, image: entry.image, icon: entry.icon });
      }
    }
    const sort = this._config && this._config.types_sort;
    if (sort === 'asc' || sort === 'desc') {
      const dir = sort === 'desc' ? -1 : 1;
      out.sort((a, b) => dir * a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    }
    return out;
  }

  /** When `remove_zero: false`, keep emptied items as `Name (0)` and always
   *  suffix the quantity. Requires quantity mode; defaults off (remove at 0). */
  _keepZero() {
    return keepZero(this._config);
  }

  /** Match a summary against the current items. `present` is whether it exists
   *  at all; `isOn` is whether it's active (a kept `Name (0)` is present but off). */
  _matchSummary(fullName) {
    return matchItem(this._items, fullName, this._config);
  }

  /** Resolve the on-state and stored name for a single type. */
  _typeState(typeName) {
    const fullName = this._buildNameFor(typeName);
    return { fullName, ...this._matchSummary(fullName) };
  }

  /** Resolve the effective image URL: explicit `image` wins, otherwise
   *  derive from `image_base` + slug(title) + '.png'. Returns the first
   *  candidate; use `_imageCandidates()` for the full fallback list. */
  _resolveImage() {
    const list = this._imageCandidates();
    return list[0] || '';
  }

  /** Ordered list of image URL candidates to try. When `image` is set it is
   *  the sole candidate. Otherwise, when `image_base` is set, we generate
   *  multiple slug variants of the title so a file named any of
   *  `ice-cream.png`, `ice_cream.png`, `ice cream.png`, or `icecream.png`
   *  is picked up automatically. */
  _imageCandidates() {
    const c = this._config;
    if (c.image) return [c.image];
    if (!c.image_base) return [];
    const base = c.image_base.endsWith('/') ? c.image_base : c.image_base + '/';
    const raw = String(c.title || '').toLowerCase().trim();
    if (!raw) return [];
    // Split on any non-letter/number run to get word tokens, preserving
    // Unicode letters/numbers only.
    const tokens = raw.split(/[^\p{Letter}\p{Number}]+/gu).filter(Boolean);
    if (!tokens.length) return [];
    const joiners = ['-', '_', ' ', ''];
    const seen = new Set();
    const out = [];
    for (const j of joiners) {
      const slug = tokens.join(j);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      out.push(`${base}${encodeURI(slug)}.png`);
    }
    return out;
  }

  _getColorValue(val) {
    if (!val) return null;
    if (val.startsWith('#')) return val;
    return ShoppingListCard.COLOR_MAP[val.toLowerCase()] || val;
  }

  _hexToRgb(hex) {
    const m = hex.replace('#','').match(/^(.{2})(.{2})(.{2})$/);
    return m ? { r: parseInt(m[1],16), g: parseInt(m[2],16), b: parseInt(m[3],16) } : null;
  }

  _toRgba(hex, a) {
    const c = this._hexToRgb(hex);
    return c ? `rgba(${c.r}, ${c.g}, ${c.b}, ${a})` : hex;
  }

  /** Returns an RGB triplet string ("R, G, B" or a var() with hex fallback) or null. */
  _colorRgbTriplet(val) {
    if (!val) return null;
    if (val.startsWith('#')) {
      const c = this._hexToRgb(val);
      return c ? `${c.r}, ${c.g}, ${c.b}` : null;
    }
    const key = val.toLowerCase();
    const hex = ShoppingListCard.COLOR_MAP[key];
    if (!hex) return null;
    const rgb = this._hexToRgb(hex);
    if (!rgb) return `var(--rgb-${key})`;
    // Hex-triplet fallback so unknown/unset theme vars still render.
    return `var(--rgb-${key}, ${rgb.r}, ${rgb.g}, ${rgb.b})`;
  }

  /** Theme-aware rgba() string. Falls back to hex when unknown. */
  _rgbaFor(colorName, alpha) {
    const triplet = this._colorRgbTriplet(colorName);
    if (triplet) return `rgba(${triplet}, ${alpha})`;
    const hex = this._getColorValue(colorName);
    return hex ? this._toRgba(hex, alpha) : `rgba(128, 128, 128, ${alpha})`;
  }

  /** Theme-aware solid color string. */
  _solidFor(colorName) {
    const triplet = this._colorRgbTriplet(colorName);
    if (triplet) return `rgb(${triplet})`;
    return this._getColorValue(colorName) || '#808080';
  }

  _ensureShell() {
    if (this.content) return;
    this.innerHTML = `<ha-card><div class="list-status" role="status" aria-live="polite"></div><div class="card-content"></div></ha-card>`;
    this.content = this.querySelector('div.card-content');
    this._statusElement = this.querySelector('.list-status');
    this._attachStyles();
  }

  _renderStatus() {
    const status = this._syncState?.status || 'loading';
    const message = this._actionError || this._syncState?.error || (status === 'loading' ? 'Loading list...' : '');
    const severity = this._actionError || status === 'error' ? 'error' : status === 'loading' ? 'info' : 'warning';
    const key = `${severity}|${message}`;
    if (this._lastStatusKey === key) return;
    this._lastStatusKey = key;
    this._statusElement.innerHTML = message ? `<ha-alert alert-type="${severity}">${escapeHtml(message)}
      ${status !== 'loading' ? '<button class="refresh-list" type="button" title="Refresh list" aria-label="Refresh list"><ha-icon icon="mdi:refresh"></ha-icon></button>' : ''}
    </ha-alert>` : '';
    this._statusElement.querySelector('.refresh-list')?.addEventListener('click', async () => {
      const store = this._store;
      this._actionError = null;
      try { await store?.refresh(); }
      catch (error) { if (this._store === store) this._actionError = error.message || 'Could not refresh the list.'; }
      if (this._store === store) this._renderStatus();
    });
  }

  _applyBusyState() {
    const card = this.content?.querySelector('.card-container');
    if (!card) return;
    const names = [this._buildFullName(), ...this._getTypes().map(type => this._buildNameFor(type.name))];
    const busy = this._isUpdating || names.some(name => this._store?.pending.has(name.toLowerCase()));
    const unavailable = !this._store?.ready;
    card.classList.toggle('is-updating', busy);
    card.classList.toggle('is-unavailable', unavailable);
    card.setAttribute('aria-busy', String(busy));
    for (const control of [card, ...card.querySelectorAll('[role="button"]')]) {
      control.setAttribute('aria-disabled', String(busy || unavailable));
    }
  }

  _render() {
    this._ensureShell();
    this._renderStatus();
    this._applyBusyState();
    if (!this._config || !this._hass) return;

    if (this._items === null) {
      this._clearHolds();
      this.content.innerHTML = '';
      this._lastRenderKey = null;
      return;
    }

    const types = this._getTypes();
    if (types.length) { this._renderTypesMode(types); return; }

    const fullName = this._buildFullName();
    const { isOn, qty, matched, matchedUid, present } = this._matchSummary(fullName);

    // Memoize: skip the DOM rewrite when nothing visible (or interaction-relevant)
    // changed for this card. Config changes invalidate _lastRenderKey via setConfig().
    // This avoids rebuilding innerHTML on every WebSocket push that doesn't affect us
    // (e.g. a sibling item being added on a 50-card dashboard).
    const renderKey = `${isOn}|${qty}|${present ? 1 : 0}|${matchedUid || ''}|${matched || ''}`;
    if (this._lastRenderKey === renderKey) return;
    this._lastRenderKey = renderKey;

    const onIcon    = this._config.on_icon    || ShoppingListCard.DEFAULT_ON_ICON;
    const offIcon   = this._config.off_icon   || ShoppingListCard.DEFAULT_OFF_ICON;
    const onColorN  = this._config.on_color   || ShoppingListCard.DEFAULT_ON_COLOR;
    const offColorN = this._config.off_color || ShoppingListCard.DEFAULT_OFF_COLOR;
    const activeColor = isOn ? onColorN : offColorN;

    const icon    = isOn ? onIcon : offIcon;
    const bg      = this._rgbaFor(activeColor, 0.2);
    const fg      = this._solidFor(activeColor);

    let cardBgStyle = '';
    if (isOn && this._config.colorize_background !== false) {
      cardBgStyle = `style="background-color: ${this._rgbaFor(onColorN, 0.1)};"`;
    }

    const isVertical = this._config.layout === 'vertical';
    const layoutClass = isVertical ? 'vertical-layout' : '';
    const effectiveImage = this._resolveImage();

    let mainContent = '';
    let qtyControls = '';
    let topBlock = '';

    if (isVertical) {
        let quantityBadge = '';
        if (isOn && this._config.enable_quantity) {
            quantityBadge = `<span class="quantity-badge">${qty}</span>`;
        }

        const safeImage = escapeHtml(effectiveImage);
        const safeTitle = escapeHtml(this._config.title || '');
        const decBtn = `<div class="quantity-btn" role="button" tabindex="0" aria-label="Decrease quantity" data-action="decrement"><ha-icon icon="mdi:minus"></ha-icon></div>`;
        const incBtn = `<div class="quantity-btn" role="button" tabindex="0" aria-label="Increase quantity" data-action="increment"><ha-icon icon="mdi:plus"></ha-icon></div>`;

        let iconElement;
        if (effectiveImage) {
            iconElement = `<div class="image-wrapper vertical-image">
                             <img src="${safeImage}" alt="${safeTitle}" />
                             ${quantityBadge}
                             <div class="icon-wrapper vertical-icon" style="background:${bg}; color:${fg};">
                               <ha-icon icon="${icon}"></ha-icon>
                             </div>
                           </div>`;
        } else {
            iconElement = `<div class="icon-wrapper vertical-icon" style="background:${bg}; color:${fg};">
                             <ha-icon icon="${icon}"></ha-icon>
                             ${quantityBadge}
                           </div>`;
        }

        if (isOn && this._config.enable_quantity) {
            topBlock = `<div class="vertical-icon-container">
                                ${(this._keepZero() || qty > 1) ? decBtn : `<div class="quantity-btn-placeholder"></div>`}
                                ${iconElement}
                                ${incBtn}
                             </div>`;
        } else {
            topBlock = iconElement;
        }
    } else { // Horizontal layout
        const safeImage = escapeHtml(effectiveImage);
        const safeTitle = escapeHtml(this._config.title || '');
        const decBtn = `<div class="quantity-btn" role="button" tabindex="0" aria-label="Decrease quantity" data-action="decrement"><ha-icon icon="mdi:minus"></ha-icon></div>`;
        const incBtn = `<div class="quantity-btn" role="button" tabindex="0" aria-label="Increase quantity" data-action="increment"><ha-icon icon="mdi:plus"></ha-icon></div>`;

        if (effectiveImage) {
            mainContent = `<div class="image-wrapper">
                             <img src="${safeImage}" alt="${safeTitle}" />
                             <div class="icon-wrapper" style="background:${bg}; color:${fg};">
                               <ha-icon icon="${icon}"></ha-icon>
                             </div>
                           </div>`;
        } else {
            mainContent = `<div class="icon-wrapper" style="background:${bg}; color:${fg};">
                             <ha-icon icon="${icon}"></ha-icon>
                           </div>`;
        }

        if (isOn && this._config.enable_quantity) {
            qtyControls = `<div class="quantity-controls">
                                ${(this._keepZero() || qty > 1) ? decBtn : ''}
                                <span class="quantity" aria-label="Quantity: ${qty}">${qty}</span>
                                ${incBtn}
                             </div>`;
        }
    }

    const ariaLabelParts = [this._config.title];
    if (this._config.subtitle) ariaLabelParts.push(this._config.subtitle);
    ariaLabelParts.push(isOn ? (this._config.enable_quantity ? `quantity ${qty}` : 'on list') : 'not on list');
    const ariaLabel = escapeHtml(ariaLabelParts.join(', '));

    const showName = this._config.show_name !== false;
    const nameBlock = showName
      ? `<div class="info-container">
          <div class="primary">${escapeHtml(this._config.title)}</div>
          ${this._config.subtitle?`<div class="secondary">${escapeHtml(this._config.subtitle)}</div>`:''}
        </div>`
      : '';
    const nameClass = showName ? '' : 'no-name';

    this._clearHolds();
    this.content.innerHTML = `
      <div class="card-container ${isOn?'is-on':'is-off'} ${layoutClass} ${nameClass}"
           role="button" tabindex="0" aria-pressed="${isOn ? 'true' : 'false'}" aria-label="${ariaLabel}"
           ${cardBgStyle}>
        ${isVertical ? `<div class="vertical-top-block">${topBlock}</div>` : mainContent}
        ${nameBlock}
        ${qtyControls}
      </div>
    `;

    const card = this.content.querySelector('.card-container');
    this._wireInteractions(card);
    this._wireImageError(card);
    this._applyBusyState();
  }

  /** Render the expandable "types" (variants) layout. The header is the bare
   *  title: tapping its body adds / removes the plain item, while the chevron
   *  expands the variant list. Each type row adds / removes / adjusts the
   *  quantity of `Title - Type` independently. */
  _renderTypesMode(types) {
    const onIcon    = this._config.on_icon    || ShoppingListCard.DEFAULT_ON_ICON;
    const offIcon   = this._config.off_icon   || ShoppingListCard.DEFAULT_OFF_ICON;
    const onColorN  = this._config.on_color   || ShoppingListCard.DEFAULT_ON_COLOR;
    const offColorN = this._config.off_color  || ShoppingListCard.DEFAULT_OFF_COLOR;

    // Each type renders as its own row ("Title - Type"). The header itself is
    // the bare title ("Apple"): tapping the header body adds / removes the
    // plain item, while the chevron expands the variant list. Tapping a row
    // toggles that specific variant independently.
    const states = types.map(t => ({
      label: t.name, subtitle: t.name, image: t.image, icon: t.icon,
      ...this._typeState(t.name),
    }));
    // Cache the subtitle per row index for tap handling.
    this._typeEntries = states.map(s => s.subtitle);
    const activeCount = states.filter(s => s.isOn).length;

    // Bare-item state drives the header's add / remove action. When a `subtitle`
    // is configured, the header item is stored as "Title - subtitle"; otherwise
    // it is the plain title.
    const baseSubtitle = this._config.subtitle || null;
    const bare = this._typeState(baseSubtitle);

    // Memoize on header + per-row states. Expansion is a pure CSS toggle applied
    // outside render, so it is intentionally excluded from the key.
    const renderKey = 'types|' + (bare.isOn ? 1 : 0) + ':' + bare.qty + ':' + (bare.present ? 1 : 0) + '|' + activeCount + '|' +
      states.map(s => `${s.label}:${s.isOn ? 1 : 0}:${s.qty}:${s.present ? 1 : 0}`).join('|');
    if (this._lastRenderKey === renderKey) { this._applyExpanded(); return; }
    this._lastRenderKey = renderKey;

    const headerOn = bare.isOn;
    const anyOn = bare.isOn || activeCount > 0;
    // The header icon reflects the whole group: it is in the selected state when
    // the bare item OR any variant is on the list.
    const headColor = anyOn ? onColorN : offColorN;
    const headBg = this._rgbaFor(headColor, 0.2);
    const headFg = this._solidFor(headColor);
    const headIcon = anyOn ? onIcon : offIcon;
    const effectiveImage = this._resolveImage();
    const safeImage = escapeHtml(effectiveImage);
    const safeTitle = escapeHtml(this._config.title || '');
    const isVertical = this._config.layout === 'vertical';

    // Optional badge showing how many variants are currently on the list.
    const countBadge = activeCount > 0
      ? `<span class="quantity-badge">${activeCount}</span>` : '';

    let parentIcon;
    if (isVertical) {
      parentIcon = effectiveImage
        ? `<div class="image-wrapper vertical-image">
             <img src="${safeImage}" alt="${safeTitle}" />
             ${countBadge}
             <div class="icon-wrapper vertical-icon" style="background:${headBg}; color:${headFg};">
               <ha-icon icon="${headIcon}"></ha-icon>
             </div>
           </div>`
        : `<div class="icon-wrapper vertical-icon" style="background:${headBg}; color:${headFg};">
             <ha-icon icon="${headIcon}"></ha-icon>
             ${countBadge}
           </div>`;
    } else {
      parentIcon = effectiveImage
        ? `<div class="image-wrapper">
             <img src="${safeImage}" alt="${safeTitle}" />
             <div class="icon-wrapper" style="background:${headBg}; color:${headFg};">
               <ha-icon icon="${headIcon}"></ha-icon>
             </div>
           </div>`
        : `<div class="icon-wrapper" style="background:${headBg}; color:${headFg};">
             <ha-icon icon="${headIcon}"></ha-icon>
           </div>`;
    }

    // Parent secondary line: active selections, else the configured subtitle.
    const activeNames = states.filter(s => s.isOn)
      .map(s => s.qty > 1 ? `${s.label} (${s.qty})` : s.label).join(', ');
    const secondary = activeNames || this._config.subtitle || '';

    let cardBgStyle = '';
    if (anyOn && this._config.colorize_background !== false) {
      cardBgStyle = `style="background-color: ${this._rgbaFor(onColorN, 0.1)};"`;
    }

    const enableQty = !!this._config.enable_quantity;
    const decBtn = `<div class="quantity-btn" role="button" tabindex="0" aria-label="Decrease quantity" data-action="decrement"><ha-icon icon="mdi:minus"></ha-icon></div>`;
    const incBtn = `<div class="quantity-btn" role="button" tabindex="0" aria-label="Increase quantity" data-action="increment"><ha-icon icon="mdi:plus"></ha-icon></div>`;

    const onSolid = this._solidFor(onColorN);
    const rowsHtml = states.map((s, i) => {
      const thumb = s.image
        ? `<div class="type-thumb"><img src="${escapeHtml(s.image)}" alt=""></div>` : '';
      let rightHtml;
      if (s.isOn && enableQty) {
        rightHtml = `<div class="type-qty">
            ${(this._keepZero() || s.qty > 1) ? decBtn : ''}
            <span class="quantity" aria-label="Quantity: ${s.qty}">${s.qty}</span>
            ${incBtn}
          </div>`;
      } else if (s.isOn) {
        // Active without quantity: a flat check indicator (not a toggle button).
        rightHtml = `<div class="type-indicator" style="color:${onSolid};"><ha-icon icon="mdi:check"></ha-icon></div>`;
      } else {
        // Inactive: a muted add affordance. Tapping the row adds the variant.
        rightHtml = `<div class="type-indicator type-add"><ha-icon icon="mdi:plus"></ha-icon></div>`;
      }
      const rowStyle = s.isOn ? ` style="background:${this._rgbaFor(onColorN, 0.12)};"` : '';
      return `<div class="type-row ${s.isOn ? 'is-on' : 'is-off'}" data-type-index="${i}"${rowStyle}
                   role="button" tabindex="0" aria-pressed="${s.isOn ? 'true' : 'false'}"
                   aria-label="${escapeHtml(s.label)}">
                ${thumb}
                <div class="type-name">${escapeHtml(s.label)}</div>
                ${rightHtml}
              </div>`;
    }).join('');

    const headerLabel = escapeHtml([this._config.title, secondary].filter(Boolean).join(', '));

    // Vertical mirrors the normal vertical tile: icon top-center, text bottom,
    // chevron pinned bottom-right. Horizontal keeps the inline row.
    const headerInner = isVertical
      ? `<div class="vertical-top-block">${parentIcon}</div>
         <div class="info-container">
           <div class="primary">${safeTitle}</div>
           ${secondary ? `<div class="secondary">${escapeHtml(secondary)}</div>` : ''}
         </div>
         <ha-icon class="types-chevron" icon="mdi:chevron-down" role="button" tabindex="0"
                  aria-expanded="false" aria-controls="slc-types-list" aria-label="Toggle types"></ha-icon>`
      : `${parentIcon}
         <div class="info-container">
           <div class="primary">${safeTitle}</div>
           ${secondary ? `<div class="secondary">${escapeHtml(secondary)}</div>` : ''}
         </div>
         <ha-icon class="types-chevron" icon="mdi:chevron-down" role="button" tabindex="0"
                  aria-expanded="false" aria-controls="slc-types-list" aria-label="Toggle types"></ha-icon>`;

    this._clearHolds();
    this.content.innerHTML = `
      <div class="card-container types-mode ${isVertical ? 'vertical-layout' : ''} ${anyOn ? 'is-on' : 'is-off'}" ${cardBgStyle}>
        <div class="types-header ${isVertical ? 'vertical-header' : ''}" role="button" tabindex="0"
             aria-pressed="${headerOn ? 'true' : 'false'}" aria-label="${headerLabel}">
          ${headerInner}
        </div>
        <div class="types-list" id="slc-types-list" role="group">${rowsHtml}</div>
      </div>
    `;

    const card = this.content.querySelector('.card-container');
    this._wireTypesInteractions(card);
    this._wireImageError(card);
    this._applyExpanded();
    this._applyBusyState();
  }

  _applyExpanded() {
    const card = this.content?.querySelector('.card-container.types-mode');
    if (!card) return;
    const expanded = !!this._expanded;
    card.classList.toggle('expanded', expanded);
    const list = card.querySelector('.types-list');
    if (list) {
      list.inert = !expanded;
      list.setAttribute('aria-hidden', String(!expanded));
    }
    const chevron = card.querySelector('.types-chevron');
    if (chevron) chevron.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  }

  _wireTypesInteractions(card) {
    const header = card.querySelector('.types-header');
    const chevron = card.querySelector('.types-chevron');
    const expand = () => {
      this._expanded = !this._expanded;
      this._vibrate();
      this._applyExpanded();
    };

    // The chevron is the dedicated expand / collapse control.
    if (chevron) {
      chevron.addEventListener('click', (ev) => { ev.stopPropagation(); expand(); });
      chevron.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.stopPropagation(); expand(); }
      });
    }

    // Tapping the header body (anywhere but the chevron) adds / removes the
    // bare title, like a normal single-item card. Holding it clears every
    // item that belongs to this card (the bare title and all variants).
    if (header) {
      header.addEventListener('click', (ev) => {
        if (ev.target.closest('.types-chevron')) return;
        this._handleHeaderTap(ev);
      });
      header.addEventListener('keydown', (ev) => {
        if ((ev.key === 'Enter' || ev.key === ' ') && !ev.target.closest('.types-chevron')) {
          ev.preventDefault(); this._handleHeaderTap(ev);
        }
      });
      this._attachHold(header, () => this._removeAllTypes());
    }

    card.querySelectorAll('.type-row').forEach(row => {
      const idx = +row.dataset.typeIndex;
      const tap = (ev) => this._handleTypeTap(ev, idx);
      row.addEventListener('click', tap);
      row.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); tap(ev); }
      });
      // Holding a row removes that specific variant entirely, regardless of
      // its quantity.
      this._attachHold(row, () => this._removeType(idx));
    });
  }

  /** Generic press-and-hold wiring: fires `onHold` after a 500ms hold and
   *  swallows the trailing click so the tap handler doesn't also fire.
   *  Honors `hold_action: { action: none }` to disable holds entirely. */
  _attachHold(el, onHold) {
    if (this._config.hold_action?.action === 'none') return;
    let holdTimer = null;
    let startX = 0;
    let startY = 0;
    const version = this._configVersion;
    const start = event => {
      if (event.button !== 0 || event.isPrimary === false
        || event.target.closest('.quantity-btn, .types-chevron')) return;
      startX = event.clientX;
      startY = event.clientY;
      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => {
        holdTimer = null;
        if (!el.isConnected || this._configVersion !== version) return;
        this._suppressClick = true;
        clearTimeout(this._clickResetTimer);
        this._clickResetTimer = setTimeout(() => { this._suppressClick = false; }, 1000);
        this._vibrate();
        this._handleHoldAction(onHold);
      }, 500);
    };
    const cancel = () => { clearTimeout(holdTimer); holdTimer = null; };
    const move = event => {
      if (!holdTimer) return;
      if (Math.abs(event.clientX - startX) > 10 || Math.abs(event.clientY - startY) > 10) cancel();
    };
    el.addEventListener('pointerdown', start);
    el.addEventListener('pointermove', move);
    for (const event of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(event, cancel);
    this._holdCleanups.add(() => {
      cancel();
      el.removeEventListener('pointerdown', start);
      el.removeEventListener('pointermove', move);
      for (const event of ['pointerup', 'pointerleave', 'pointercancel']) el.removeEventListener(event, cancel);
    });
  }

  _clearHolds() {
    for (const cleanup of this._holdCleanups) cleanup();
    this._holdCleanups.clear();
  }

  /** Hold on the header: remove every item that belongs to this card, i.e.
   *  the bare title plus each configured variant currently on the list. */
  _removeAllTypes() {
    return this._runItemActions([this._config.subtitle || null, ...this._getTypes().map(type => type.name)], 'remove');
  }

  /** Hold on a variant row: remove that specific variant entirely. */
  _removeType(idx) {
    const entries = this._typeEntries || [];
    if (idx < 0 || idx >= entries.length) return;
    return this._runItemActions([entries[idx]], 'remove');
  }

  _handleHeaderTap(ev) {
    return this._toggleSubtitle(ev, this._config.subtitle || null);
  }

  _handleTypeTap(ev, idx) {
    ev.stopPropagation();
    const entries = this._typeEntries || [];
    if (idx < 0 || idx >= entries.length) return;
    return this._toggleSubtitle(ev, entries[idx]);
  }

  _toggleSubtitle(event, subtitle) {
    event.stopPropagation();
    const action = event.target.closest('.quantity-btn')?.dataset.action || 'toggle';
    return this._runItemActions([subtitle], action);
  }

  async _runItemActions(subtitles, action) {
    if (this._isUpdating || !this.isConnected) return;
    const store = this._store;
    const config = this._config;
    const version = this._configVersion;
    const keys = [...new Set(subtitles.map(subtitle => buildName(config, subtitle).toLowerCase()))];
    if (keys.some(key => store?.pending.has(key))) return;
    if (!store?.ready) {
      this._actionError = store?.error || 'Wait for the to-do list to reconnect.';
      this._renderStatus();
      return;
    }
    this._vibrate();
    this._isUpdating = true;
    this._actionError = null;
    this._applyBusyState();
    this._renderStatus();
    try {
      await store.execute(keys, items => {
        const seen = new Set();
        return subtitles.map(subtitle => planItemAction(config, items, subtitle, action)).filter(operation => {
          if (!operation || seen.has(operation.key)) return false;
          seen.add(operation.key);
          return true;
        });
      });
    } catch (error) {
      if (this._store === store && this._configVersion === version) {
        this._actionError = error.message || 'Could not update the to-do list.';
      }
    } finally {
      if (this._store === store && this._configVersion === version) {
        this._isUpdating = false;
        this._applyBusyState();
        this._renderStatus();
      }
    }
  }

  _wireImageError(card) {
    const img = card.querySelector('img');
    if (!img) return;
    // Try each candidate in order; when all fail, hide the image so the
    // icon-only fallback shows through.
    const candidates = this._imageCandidates();
    let idx = 0;
    img.addEventListener('error', () => {
      idx += 1;
      if (idx < candidates.length) {
        img.src = candidates[idx];
      } else {
        img.style.display = 'none';
        img.parentElement?.classList.add('image-error');
      }
    });
  }

  _wireInteractions(card) {
    const tap = (event) => this._toggleSubtitle(event, this._config.subtitle || null);
    card.addEventListener('click', tap);
    card.addEventListener('keydown', (ev) => {
      if (ev.target.closest('.quantity-btn')) {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          tap(ev);
        }
        return;
      }
      if (ev.target === card && (ev.key === 'Enter' || ev.key === ' ')) {
        ev.preventDefault();
        tap(ev);
      }
    });

    this._attachHold(card, () => this._runItemActions([this._config.subtitle || null], 'remove'));
  }

  _handleHoldAction(onRemove) {
    const cfg = this._config.hold_action;
    const action = cfg?.action || 'default';

    if (action === 'none') return;

    if (action === 'more-info') {
      const event = new CustomEvent('hass-more-info', {
        bubbles: true,
        composed: true,
        detail: { entityId: this._config.todo_list },
      });
      this.dispatchEvent(event);
      return;
    }

    if (action === 'default') return onRemove();
  }

  _vibrate() {
    if (this._config?.haptic && navigator.vibrate) navigator.vibrate(50);
  }

  _attachStyles() {
    if (this.querySelector('style')) return;
    const s = document.createElement('style');
    s.textContent = CARD_STYLES;
    this.appendChild(s);
  }

  getCardSize() {
    if (this._config && this._getTypes().length) return 2;
    if (this._config && this._config.layout === 'vertical') {
      return this._config.show_name === false ? 1 : 2;
    }
    return 1;
  }

  getLayoutOptions() {
    if (this._config && this._getTypes().length) {
      // Expandable: let the card grow with its content. `grid_rows: auto` keeps
      // the height flexible by default so the expanded variant list is never
      // clipped in the sections layout.
      // Vertical types cards are narrower (grid tiles), horizontal span wider.
      const cols = this._config.layout === 'vertical' ? 2 : 4;
      return { grid_rows: 'auto', grid_columns: cols, grid_min_columns: 2 };
    }
    if (this._config && this._config.layout === 'vertical') {
      const rows = this._config.show_name === false ? 1 : 2;
      return { grid_rows: rows, grid_min_rows: rows, grid_columns: 2, grid_min_columns: 2 };
    }
    return { grid_rows: 1, grid_min_rows: 1, grid_columns: 4, grid_min_columns: 2 };
  }
}
if (!customElements.get('shopping-list-card')) {
  customElements.define('shopping-list-card', ShoppingListCard);
}

window.customCards = window.customCards || [];
if (!window.customCards.some(c => c.type === 'shopping-list-card')) {
  window.customCards.push({
    type: 'shopping-list-card',
    name: 'Shopping List Card',
    preview: true,
    description: 'A card to manage items on a shopping list.',
    getEntitySuggestion: (hass, entityId) => {
      if (typeof entityId !== 'string' || entityId.split('.')[0] !== 'todo') return null;
      return { config: { type: 'custom:shopping-list-card', title: 'New item', todo_list: entityId } };
    },
  });
}

console.info(
  `%c SHOPPING-LIST-CARD %c v${CARD_VERSION} `,
  'color: white; background: #4CAF50; font-weight: 700;',
  'color: #4CAF50; background: white; font-weight: 700;'
);
