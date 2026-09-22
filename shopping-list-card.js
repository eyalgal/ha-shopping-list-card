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
      .type-thumb ha-icon { --mdc-icon-size: 28px; color: var(--secondary-text-color); }
      .type-thumb .type-image-fallback, .type-thumb.image-error img { display: none; }
      .type-thumb.image-error .type-image-fallback { display: inline-flex; }
      .type-name { flex: 1; min-width: 0; font-size: 14px; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .type-qty { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
      .type-indicator { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
      .type-indicator ha-icon { --mdc-icon-size: 20px; }
      .type-indicator.type-add ha-icon { color: var(--secondary-text-color); opacity: .45; }
`;

class ShoppingListVariantsEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._entries = [];
    this._nextId = 1;
    this._sort = 'none';
    this._textField = !customElements.get('ha-textfield') && customElements.get('ha-input')
      ? 'ha-input' : 'ha-textfield';
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; min-width: 0; container-type: inline-size; }
        * { box-sizing: border-box; }
        .variant-row { padding: 8px 0; border-bottom: 1px solid var(--divider-color, #ddd); }
        .variant-main { display: grid; grid-template-columns: 32px minmax(80px, 1fr) auto; align-items: center; gap: 8px; }
        .variant-preview { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; color: var(--secondary-text-color); }
        .variant-preview img { width: 32px; height: 32px; object-fit: contain; border-radius: 4px; }
        [hidden] { display: none !important; }
        .variant-name { width: 100%; min-width: 0; height: 40px; padding: 8px; font: inherit; font-size: 14px; color: var(--primary-text-color); background: var(--input-fill-color, rgba(127,127,127,.08)); border: 1px solid var(--divider-color, #aaa); border-radius: 4px; }
        .variant-name[aria-invalid="true"] { border-color: var(--error-color, #db4437); }
        .variant-tools { display: flex; gap: 2px; }
        button { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; width: 34px; height: 36px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: var(--primary-text-color); cursor: pointer; }
        button:hover:not(:disabled) { background: var(--secondary-background-color, rgba(127,127,127,.12)); }
        button:disabled { opacity: .35; cursor: default; }
        button:focus-visible, input:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 1px; }
        ha-icon { --mdc-icon-size: 20px; }
        .variant-media { display: grid; gap: 12px; padding: 12px 0 4px 40px; min-width: 0; }
        ha-textfield, ha-input, ha-picture-upload, ha-icon-picker { display: block; width: 100%; min-width: 0; }
        .variant-error { color: var(--error-color, #db4437); font-size: 12px; line-height: 1.5; padding: 4px 0 0 40px; overflow-wrap: anywhere; }
        .add-variant { width: auto; gap: 6px; padding: 0 8px; margin-top: 8px; font: inherit; font-size: 14px; color: var(--primary-color); }
        @container (max-width: 360px) {
          .variant-main { grid-template-columns: 32px minmax(0, 1fr); }
          .variant-tools { grid-column: 2; justify-self: end; }
          .variant-media { padding-left: 0; }
        }
      </style>
      <div class="variant-list" role="list" aria-label="Variants"></div>
      <button type="button" class="add-variant"><ha-icon icon="mdi:plus"></ha-icon>Add variant</button>
    `;
    this._list = this.shadowRoot.querySelector('.variant-list');
    this.shadowRoot.querySelector('.add-variant').addEventListener('click', () => {
      const entry = this._entry('');
      this._entries.push(entry);
      this._renderRows();
      entry.element.querySelector('[data-field="name"]').focus();
      this._validate();
    });
  }

  set hass(hass) {
    this._hass = hass;
    this.shadowRoot.querySelectorAll('ha-icon-picker, ha-picture-upload').forEach(control => {
      control.hass = hass;
    });
  }

  set value(value) {
    const signature = JSON.stringify(value);
    if (signature === this._signature) return;
    this._signature = signature;
    this._value = value;
    const entries = typeof value === 'string'
      ? value.split(/[,\n]/).map(name => name.trim()).filter(Boolean)
      : Array.isArray(value) ? value : [];
    this._entries = entries.map(entry => this._entry(entry));
    this._renderRows();
    this._validate();
  }

  get value() { return this._value; }

  set sort(value) {
    this._sort = value === 'asc' || value === 'desc' ? value : 'none';
    this._updateOrderButtons();
  }

  _entry(value) {
    const object = value !== null && typeof value === 'object';
    return {
      id: this._nextId++,
      object,
      data: object ? { ...value, name: String(value.name ?? '') } : { name: String(value ?? '') },
    };
  }

  _createRow(entry) {
    const row = document.createElement('div');
    row.className = 'variant-row';
    row.setAttribute('role', 'listitem');
    row.dataset.rowId = String(entry.id);
    row.innerHTML = `
      <div class="variant-main">
        <span class="variant-preview" aria-hidden="true"><img alt="" hidden><ha-icon icon="mdi:tag-outline"></ha-icon></span>
        <input class="variant-name" data-field="name" type="text" required aria-label="Variant name" placeholder="Variant name">
        <div class="variant-tools">
          <button type="button" data-action="up" aria-label="Move up" title="Move up"><ha-icon icon="mdi:arrow-up"></ha-icon></button>
          <button type="button" data-action="down" aria-label="Move down" title="Move down"><ha-icon icon="mdi:arrow-down"></ha-icon></button>
          <button type="button" data-action="media" aria-label="Image and icon" title="Image and icon" aria-expanded="false" aria-controls="media-${entry.id}"><ha-icon icon="mdi:chevron-down"></ha-icon></button>
          <button type="button" data-action="remove" aria-label="Remove variant" title="Remove variant"><ha-icon icon="mdi:trash-can-outline"></ha-icon></button>
        </div>
      </div>
      <div class="variant-error" id="error-${entry.id}" role="alert" hidden></div>
      <div class="variant-media" id="media-${entry.id}" hidden>
        <ha-picture-upload data-field="upload"></ha-picture-upload>
        <${this._textField} data-field="image" label="Image URL" placeholder="/local/... or https://..."></${this._textField}>
        <ha-icon-picker data-field="icon" label="Icon"></ha-icon-picker>
      </div>
    `;
    entry.element = row;
    for (const field of ['name', 'image', 'icon']) {
      const control = row.querySelector(`[data-field="${field}"]`);
      control.value = entry.data[field] || '';
      if (field === 'icon') control.hass = this._hass;
      const change = event => {
        event.stopPropagation();
        this._changeField(entry, field, event.detail?.value ?? control.value ?? '');
      };
      for (const event of ['input', 'change', 'value-changed']) control.addEventListener(event, change);
    }
    const name = row.querySelector('[data-field="name"]');
    name.setAttribute('aria-describedby', `error-${entry.id}`);
    const upload = row.querySelector('[data-field="upload"]');
    upload.hass = this._hass;
    upload.original = false;
    upload.crop = undefined;
    upload.value = entry.data.image || '';
    upload.addEventListener('change', event => {
      event.stopPropagation();
      this._changeField(entry, 'image', event.detail?.value ?? upload.value ?? '');
    });
    row.querySelector('img').addEventListener('error', () => {
      row.querySelector('img').hidden = true;
      row.querySelector('.variant-preview ha-icon').hidden = false;
    });
    for (const button of row.querySelectorAll('[data-action]')) {
      button.addEventListener('click', event => {
        event.stopPropagation();
        if (!this._entries.includes(entry)) return;
        const action = button.dataset.action;
        if (action === 'media') {
          const panel = row.querySelector('.variant-media');
          panel.hidden = !panel.hidden;
          button.setAttribute('aria-expanded', String(!panel.hidden));
          button.querySelector('ha-icon').setAttribute('icon', panel.hidden ? 'mdi:chevron-down' : 'mdi:chevron-up');
          return;
        }
        const index = this._entries.indexOf(entry);
        if (action === 'remove') this._entries.splice(index, 1);
        else {
          if (this._sort !== 'none') return;
          const next = index + (action === 'up' ? -1 : 1);
          if (next < 0 || next >= this._entries.length) return;
          this._entries.splice(index, 1);
          this._entries.splice(next, 0, entry);
        }
        this._renderRows();
        this._publish();
        if (action === 'remove') {
          const next = this._entries[Math.min(index, this._entries.length - 1)];
          (next?.element.querySelector('[data-field="name"]') || this.shadowRoot.querySelector('.add-variant')).focus();
        } else button.focus();
      });
    }
    this._updatePreview(entry);
    return row;
  }

  _changeField(entry, field, value) {
    if (!this._entries.includes(entry)) return;
    const text = String(value);
    if ((entry.data[field] || '') === text) return;
    if (field !== 'name' && !text) delete entry.data[field];
    else entry.data[field] = text;
    if (field === 'image') {
      const input = entry.element.querySelector('[data-field="image"]');
      const upload = entry.element.querySelector('[data-field="upload"]');
      if (input.value !== text) input.value = text;
      if (upload.value !== text) upload.value = text;
    }
    if (field !== 'name') this._updatePreview(entry);
    this._publish();
  }

  _updatePreview(entry) {
    const image = entry.element.querySelector('.variant-preview img');
    const icon = entry.element.querySelector('.variant-preview ha-icon');
    const url = entry.data.image || '';
    if (url && image.getAttribute('src') !== url) image.setAttribute('src', url);
    if (!url) image.removeAttribute('src');
    image.hidden = !url;
    icon.hidden = !!url;
    icon.setAttribute('icon', entry.data.icon || 'mdi:tag-outline');
  }

  _renderRows() {
    const current = new Set(this._entries.map(entry => entry.element || this._createRow(entry)));
    for (const row of [...this._list.children]) if (!current.has(row)) row.remove();
    this._entries.forEach((entry, index) => {
      if (this._list.children[index] !== entry.element) {
        this._list.insertBefore(entry.element, this._list.children[index] || null);
      }
    });
    this._updateOrderButtons();
  }

  _updateOrderButtons() {
    this._entries.forEach((entry, index) => {
      entry.element.querySelector('[data-action="up"]').disabled = this._sort !== 'none' || index === 0;
      entry.element.querySelector('[data-action="down"]').disabled = this._sort !== 'none' || index === this._entries.length - 1;
    });
  }

  _validate() {
    const names = this._entries.map(entry => entry.data.name.trim().toLowerCase());
    let valid = true;
    this._entries.forEach((entry, index) => {
      const message = !names[index] ? 'Enter a variant name.'
        : names.indexOf(names[index]) !== names.lastIndexOf(names[index]) ? 'Variant names must be unique.' : '';
      const error = entry.element.querySelector('.variant-error');
      error.textContent = message;
      error.hidden = !message;
      const input = entry.element.querySelector('[data-field="name"]');
      input.setAttribute('aria-invalid', String(!!message));
      input.setCustomValidity(message);
      if (message) valid = false;
    });
    return valid;
  }

  _publish() {
    if (!this._validate()) return;
    const value = this._entries.map(entry => {
      const data = { ...entry.data, name: entry.data.name.trim() };
      return entry.object || Object.keys(data).length > 1 ? data : data.name;
    });
    const signature = JSON.stringify(value);
    if (signature === this._signature) return;
    this._value = value;
    this._signature = signature;
    this.dispatchEvent(new CustomEvent('value-changed', { detail: { value }, bubbles: true, composed: true }));
  }
}

if (!customElements.get('shopping-list-variants-editor')) {
  customElements.define('shopping-list-variants-editor', ShoppingListVariantsEditor);
}

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
      'ha-entity-picker, ha-icon-picker, ha-picture-upload, shopping-list-variants-editor'
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
              <span class="types-label">Variants</span>
              <shopping-list-variants-editor id="types"></shopping-list-variants-editor>
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

    const typesEl = this.shadowRoot.querySelector('#types');
    typesEl.hass = this._hass;
    typesEl.addEventListener('value-changed', event => {
      event.stopPropagation();
      const config = { ...this._config };
      if (event.detail.value.length) config.types = event.detail.value;
      else delete config.types;
      this._emitConfig(config);
    });

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
        this.shadowRoot.querySelector('#types').hass = this._hass;
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
    typesEl.value = c.types;
    typesEl.sort = c.types_sort;
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
    const sortVal = this._selectVal('types_sort');
    if (sortVal === 'asc' || sortVal === 'desc') n.types_sort = sortVal; else delete n.types_sort;
    s.querySelector('#types').sort = sortVal;
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

    this._emitConfig(n);
  }

  _emitConfig(config) {
    this._config = config;
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config }, bubbles: true, composed: true }));
  }
}
if (!customElements.get('shopping-list-card-editor')) {
  customElements.define('shopping-list-card-editor', ShoppingListCardEditor);
}

const itemFields = [
  'title', 'subtitle', 'types', 'types_sort', 'image', 'image_base', 'list_prefix',
  'layout', 'show_name', 'enable_quantity', 'quantity_step', 'quantity_max',
  'remove_zero', 'on_icon', 'off_icon', 'on_color', 'off_color',
  'colorize_background', 'hold_action', 'haptic',
];

function itemOptions(options) {
  return Object.fromEntries(itemFields.filter(field => Object.hasOwn(options, field)).map(field => [field, options[field]]));
}

function typeNames(types) {
  const entries = typeof types === 'string' ? types.split(/[,\n]/) : Array.isArray(types) ? types : [];
  return entries.map(entry => typeof entry === 'string' ? entry.trim() : String(entry?.name ?? '').trim()).filter(Boolean);
}

function searchText(value) {
  return String(value).normalize('NFKD').replace(/\p{Mark}/gu, '').toLocaleLowerCase();
}

function readCatalog(hass, config) {
  const entity = hass.states?.[config.catalog_entity];
  if (!entity) throw new Error(`Catalog entity not found: ${config.catalog_entity}`);
  if (entity.state === 'unavailable' || entity.state === 'unknown') throw new Error('The product catalog is unavailable.');
  let data = config.catalog_attribute ? entity.attributes?.[config.catalog_attribute] : entity.attributes;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); }
    catch { throw new Error('The catalog attribute does not contain valid JSON.'); }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('The catalog must contain categories with product arrays.');
  }
  const defaults = { layout: 'vertical', enable_quantity: true, ...itemOptions(config.item_options || {}) };
  const groups = [];
  for (const [category, entries] of Object.entries(data)) {
    if (!Array.isArray(entries)) {
      if (config.catalog_attribute) throw new Error(`Category "${category}" must be an array.`);
      continue;
    }
    if (!category.trim()) throw new Error('Catalog categories must have a name.');
    const identities = new Map();
    const products = entries.map((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)
        || typeof entry.title !== 'string' || !entry.title.trim()) {
        throw new Error(`Product ${index + 1} in "${category}" needs a title.`);
      }
      const options = {
        ...defaults, ...itemOptions(entry), type: 'custom:shopping-list-card', todo_list: config.todo_list,
      };
      for (const field of ['subtitle', 'image', 'image_base', 'list_prefix', 'on_icon', 'off_icon', 'on_color', 'off_color']) {
        if (options[field] != null && typeof options[field] !== 'string') {
          throw new Error(`Product "${entry.title}" has an invalid ${field}.`);
        }
      }
      if (options.types != null && typeof options.types !== 'string' && !Array.isArray(options.types)) {
        throw new Error(`Product "${entry.title}" has invalid variants.`);
      }
      const identity = typeof entry.id === 'string' && entry.id ? entry.id : buildName(options, options.subtitle);
      const occurrence = identities.get(identity) || 0;
      identities.set(identity, occurrence + 1);
      const names = typeNames(options.types);
      return {
        key: JSON.stringify([category, identity, occurrence]),
        config: options,
        search: searchText([category, options.title, options.subtitle || '', ...names].join(' ')),
        names: [...new Set([buildName(options, options.subtitle), ...names.map(name => buildName(options, name))])],
      };
    });
    groups.push({ name: category, products });
  }
  return groups;
}

function productOnList(product, items) {
  return product.names.some(name => matchItem(items, name, product.config).isOn);
}

class ShoppingListCatalogEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  setConfig(config) {
    this._config = { ...config };
    if (this._rendered) this._updateValues();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._rendered) this._render();
    this.shadowRoot.querySelectorAll('ha-entity-picker').forEach(picker => { picker.hass = hass; });
  }

  _render() {
    const field = !customElements.get('ha-textfield') && customElements.get('ha-input') ? 'ha-input' : 'ha-textfield';
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; min-width: 0; }
        .catalog-form { display: flex; flex-direction: column; gap: 12px; }
        ha-expansion-panel { border: 1px solid var(--divider-color); border-radius: 8px; --expansion-panel-summary-padding: 0 16px; --expansion-panel-content-padding: 0; }
        .catalog-panel { display: grid; gap: 16px; padding: 0 16px 16px; }
        ha-entity-picker, ha-textfield, ha-input, ha-select { display: block; width: 100%; min-width: 0; }
        .catalog-fields { display: flex; gap: 12px; flex-wrap: wrap; }
        .catalog-fields > * { flex: 1 1 120px; min-width: 0; }
        .catalog-toggle { display: flex; align-items: center; gap: 12px; font-size: 14px; color: var(--primary-text-color); }
        .catalog-toggle ha-switch { flex-shrink: 0; }
      </style>
      <div class="catalog-form">
        <ha-expansion-panel header="Catalog" outlined expanded>
          <div class="catalog-panel">
            <ha-entity-picker id="catalog_entity" label="Catalog sensor" required></ha-entity-picker>
            <${field} id="catalog_attribute" label="Catalog attribute (optional)"></${field}>
            <ha-entity-picker id="todo_list" label="To-do list" required></ha-entity-picker>
            <div class="catalog-fields">
              <${field} id="title" label="Title" placeholder="Shopping"></${field}>
              <${field} id="columns" label="Maximum columns" type="number" min="1" max="6"></${field}>
            </div>
          </div>
        </ha-expansion-panel>
        <ha-expansion-panel header="Product defaults" outlined>
          <div class="catalog-panel">
            <ha-select id="layout" label="Layout" naturalMenuWidth fixedMenuPosition>
              <mwc-list-item value="vertical">Vertical</mwc-list-item>
              <mwc-list-item value="horizontal">Horizontal</mwc-list-item>
            </ha-select>
            <${field} id="image_base" label="Image base path" placeholder="/local/images/shopping-list/"></${field}>
            <${field} id="list_prefix" label="List prefix (optional)"></${field}>
            <label class="catalog-toggle"><ha-switch id="enable_quantity"></ha-switch><span>Quantity controls</span></label>
            <div class="catalog-fields">
              <${field} id="quantity_step" label="Quantity step" type="number" min="1"></${field}>
              <${field} id="quantity_max" label="Quantity maximum" type="number" min="1"></${field}>
            </div>
            <label class="catalog-toggle"><ha-switch id="keep_at_zero"></ha-switch><span>Keep items at zero</span></label>
          </div>
        </ha-expansion-panel>
      </div>
    `;
    for (const [id, domain] of [['catalog_entity', 'sensor'], ['todo_list', 'todo']]) {
      const picker = this.shadowRoot.getElementById(id);
      picker.includeDomains = [domain];
      picker.allowCustomEntity = false;
    }
    const layout = this.shadowRoot.getElementById('layout');
    layout.options = [{ value: 'vertical', label: 'Vertical' }, { value: 'horizontal', label: 'Horizontal' }];
    for (const control of this.shadowRoot.querySelectorAll('[id]')) {
      const changed = event => {
        event.stopPropagation();
        let value = event.detail?.value;
        if (control.id === 'layout' && value == null && typeof event.detail?.index === 'number') {
          value = ['vertical', 'horizontal'][event.detail.index];
        }
        if (control.localName === 'ha-switch') value = control.checked;
        this._change(control.id, value ?? control.value);
      };
      for (const event of ['input', 'change', 'value-changed']) control.addEventListener(event, changed);
      if (control.id === 'layout') control.addEventListener('selected', changed);
    }
    this._rendered = true;
    this._updateValues();
  }

  _updateValues() {
    if (!this._config) return;
    const config = this._config;
    const options = config.item_options || {};
    const values = {
      catalog_entity: config.catalog_entity || '', catalog_attribute: config.catalog_attribute || '',
      todo_list: config.todo_list || '', title: config.title || '', columns: config.columns ?? 4,
      layout: options.layout || 'vertical', image_base: options.image_base || '', list_prefix: options.list_prefix || '',
      quantity_step: options.quantity_step ?? 1, quantity_max: options.quantity_max ?? '',
    };
    for (const [id, value] of Object.entries(values)) {
      const control = this.shadowRoot.getElementById(id);
      if (String(control.value ?? '') !== String(value)) control.value = String(value);
    }
    this.shadowRoot.getElementById('enable_quantity').checked = options.enable_quantity !== false;
    this.shadowRoot.getElementById('keep_at_zero').checked = options.remove_zero === false;
  }

  _change(field, value) {
    if (!this._config || value == null) return;
    const config = { ...this._config };
    const defaults = ['layout', 'image_base', 'list_prefix', 'enable_quantity', 'quantity_step', 'quantity_max', 'keep_at_zero'];
    const target = defaults.includes(field) ? { ...(config.item_options || {}) } : config;
    if (defaults.includes(field)) config.item_options = target;
    const key = field === 'keep_at_zero' ? 'remove_zero' : field;
    let next = value;
    if (['columns', 'quantity_step', 'quantity_max'].includes(field)) {
      next = value === '' ? undefined : Number(value);
      if (next !== undefined && (!Number.isInteger(next) || next < 1 || (field === 'columns' && next > 6))) return;
    } else if (field === 'enable_quantity') next = value ? undefined : false;
    else if (field === 'keep_at_zero') next = value ? false : undefined;
    else if (field === 'layout') {
      if (value !== 'vertical' && value !== 'horizontal') return;
      next = value === 'vertical' ? undefined : value;
    } else if (typeof value === 'string') next = value.trim() || undefined;
    if (next === undefined) delete target[key];
    else target[key] = next;
    if (config.item_options && !Object.keys(config.item_options).length) delete config.item_options;
    if (JSON.stringify(config) === JSON.stringify(this._config)) return;
    this._config = config;
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config }, bubbles: true, composed: true }));
  }
}

if (!customElements.get('shopping-list-catalog-card-editor')) {
  customElements.define('shopping-list-catalog-card-editor', ShoppingListCatalogEditor);
}

class ShoppingListCatalogCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._groups = [];
    this._sections = new Map();
    this._products = new Map();
    this._category = null;
    this._query = '';
    this._onList = false;
    this._store = null;
    this._unsubscribe = null;
    this._snapshot = null;
    this._sourceError = null;
    this._sourceSignature = null;
    this._sourceEntity = null;
    this._needsSource = true;
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; min-width: 0; container-type: inline-size; color: var(--primary-text-color); }
        * { box-sizing: border-box; }
        [hidden] { display: none !important; }
        .catalog-header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
        .catalog-title { flex: 1; margin: 0; min-width: 0; font-size: 20px; line-height: 1.3; font-weight: 500; overflow-wrap: anywhere; }
        .catalog-counter { color: var(--secondary-text-color); font-size: 12px; white-space: nowrap; }
        button { font: inherit; color: inherit; cursor: pointer; }
        button:focus-visible, input:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }
        .catalog-icon-button { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; padding: 0; border: 0; border-radius: 4px; background: transparent; flex-shrink: 0; }
        .catalog-icon-button:hover { background: var(--secondary-background-color); }
        .catalog-toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
        .catalog-search { display: flex; flex: 1 1 180px; align-items: center; min-width: 0; height: 44px; padding-inline: 10px 4px; gap: 8px; border: 1px solid var(--divider-color, #aaa); border-radius: 6px; background: var(--card-background-color); }
        .catalog-search ha-icon { flex-shrink: 0; color: var(--secondary-text-color); --mdc-icon-size: 20px; }
        .catalog-search input { min-width: 0; width: 100%; padding: 8px 0; border: 0; outline: 0; background: transparent; color: var(--primary-text-color); font: inherit; font-size: 14px; }
        .catalog-search:focus-within { outline: 2px solid var(--primary-color); outline-offset: 1px; }
        .catalog-search input::-webkit-search-cancel-button { -webkit-appearance: none; }
        .catalog-on-list { display: inline-flex; align-items: center; gap: 8px; min-height: 40px; font-size: 14px; cursor: pointer; white-space: nowrap; }
        .catalog-on-list input { width: 18px; height: 18px; accent-color: var(--primary-color); }
        .catalog-tabs { display: flex; gap: 2px; overflow-x: auto; margin: 12px 0 0; border-bottom: 1px solid var(--divider-color); scrollbar-width: thin; }
        .catalog-tab { display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; min-height: 44px; padding: 8px 12px; border: 0; border-bottom: 2px solid transparent; background: transparent; font-size: 14px; color: var(--secondary-text-color); white-space: nowrap; }
        .catalog-tab[aria-selected="true"] { color: var(--primary-color); border-bottom-color: var(--primary-color); }
        .catalog-tab-count { font-size: 12px; opacity: .8; }
        .catalog-section { margin: 18px 0 0; }
        .catalog-category-heading { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
        .catalog-category-title { margin: 0; min-width: 0; font-size: 16px; font-weight: 500; line-height: 1.4; overflow-wrap: anywhere; }
        .catalog-category-count { color: var(--secondary-text-color); font-size: 12px; }
        .catalog-grid { display: grid; grid-template-columns: repeat(var(--catalog-columns, 4), minmax(0, 1fr)); gap: 8px; align-items: start; }
        .catalog-grid > shopping-list-card { display: block; min-width: 0; }
        .catalog-grid > shopping-list-card[hidden] { display: none !important; }
        :host([data-sync-state]:not([data-sync-state="ready"])) shopping-list-card .list-status { display: none; }
        .catalog-status:not(:empty) { margin-top: 12px; overflow-wrap: anywhere; }
        .catalog-empty { padding: 24px 0; margin: 0; color: var(--secondary-text-color); font-size: 14px; }
        @container (max-width: 900px) { .catalog-grid { grid-template-columns: repeat(var(--catalog-medium-columns, 3), minmax(0, 1fr)); } }
        @container (max-width: 560px) { .catalog-grid { grid-template-columns: repeat(var(--catalog-mobile-columns, 2), minmax(0, 1fr)); } }
        @container (max-width: 300px) { .catalog-grid { grid-template-columns: minmax(0, 1fr); } .catalog-counter { display: none; } }
      </style>
      <div class="catalog-header">
        <h2 class="catalog-title"></h2>
        <span class="catalog-counter" aria-live="polite"></span>
        <button class="catalog-icon-button catalog-open-list" type="button" aria-label="Open shopping list" title="Open shopping list"><ha-icon icon="mdi:format-list-checks"></ha-icon></button>
      </div>
      <div class="catalog-toolbar">
        <label class="catalog-search"><ha-icon icon="mdi:magnify"></ha-icon><input type="search" aria-label="Search catalog" placeholder="Search products" autocomplete="off"><button class="catalog-icon-button catalog-clear-search" type="button" aria-label="Clear search" title="Clear search" hidden><ha-icon icon="mdi:close"></ha-icon></button></label>
        <label class="catalog-on-list"><input type="checkbox">On list</label>
      </div>
      <div class="catalog-tabs" role="tablist" aria-label="Product categories"></div>
      <div class="catalog-status" role="status" aria-live="polite"></div>
      <div class="catalog-content" id="catalog-content" role="tabpanel"></div>
      <p class="catalog-empty" role="status" hidden></p>
    `;
    this._content = this.shadowRoot.querySelector('.catalog-content');
    this._tabs = this.shadowRoot.querySelector('.catalog-tabs');
    this._status = this.shadowRoot.querySelector('.catalog-status');
    this._search = this.shadowRoot.querySelector('input[type="search"]');
    this._search.addEventListener('input', () => {
      this._query = this._search.value;
      this._applyFilters();
    });
    this.shadowRoot.querySelector('.catalog-clear-search').addEventListener('click', () => {
      this._query = '';
      this._search.value = '';
      this._applyFilters();
      this._search.focus();
    });
    this.shadowRoot.querySelector('.catalog-on-list input').addEventListener('change', event => {
      this._onList = event.target.checked;
      this._applyFilters();
    });
    this.shadowRoot.querySelector('.catalog-open-list').addEventListener('click', () => {
      if (!this._config) return;
      this.dispatchEvent(new CustomEvent('hass-more-info', {
        detail: { entityId: this._config.todo_list }, bubbles: true, composed: true,
      }));
    });
  }

  setConfig(config) {
    if (typeof config.catalog_entity !== 'string' || !/^sensor\.[a-z0-9_]+$/.test(config.catalog_entity)) {
      throw new Error('Select a sensor entity for the catalog.');
    }
    if (typeof config.todo_list !== 'string' || !/^todo\.[a-z0-9_]+$/.test(config.todo_list)) {
      throw new Error('Select a to-do list entity.');
    }
    if (config.catalog_attribute != null && typeof config.catalog_attribute !== 'string') {
      throw new Error('The catalog attribute must be a name.');
    }
    if (config.item_options != null && (typeof config.item_options !== 'object' || Array.isArray(config.item_options))) {
      throw new Error('Item options must be an object.');
    }
    const columns = config.columns ?? 4;
    if (!Number.isInteger(columns) || columns < 1 || columns > 6) throw new Error('Columns must be an integer from 1 to 6.');
    if (this._config?.catalog_entity !== config.catalog_entity || this._config?.catalog_attribute !== config.catalog_attribute) this._category = null;
    this._config = { ...config };
    this._needsSource = true;
    this.style.setProperty('--catalog-columns', String(columns));
    this.style.setProperty('--catalog-medium-columns', String(Math.min(columns, 3)));
    this.style.setProperty('--catalog-mobile-columns', String(Math.min(columns, 2)));
    this.shadowRoot.querySelector('.catalog-title').textContent = config.title || 'Shopping';
    this._update();
  }

  set hass(hass) {
    this._hass = hass;
    this._update();
  }

  connectedCallback() { this._update(); }

  disconnectedCallback() {
    const unsubscribe = this._unsubscribe;
    this._unsubscribe = null;
    this._store = null;
    this._snapshot = null;
    unsubscribe?.();
  }

  _update() {
    if (!this._config || !this._hass) return;
    if (this.isConnected) this._ensureSubscription();
    const entity = this._hass.states?.[this._config.catalog_entity];
    if (this._needsSource || entity !== this._sourceEntity) {
      this._needsSource = false;
      this._sourceEntity = entity;
      try {
        const groups = readCatalog(this._hass, this._config);
        const signature = JSON.stringify(groups);
        this._sourceError = null;
        if (signature !== this._sourceSignature) {
          this._sourceSignature = signature;
          this._reconcile(groups);
        }
      } catch (error) {
        this._sourceError = error.message;
        this._sourceSignature = null;
        this._reconcile([]);
      }
    }
    for (const product of this._products.values()) product.card.hass = this._hass;
    this._renderStatus();
    this._applyFilters();
  }

  _ensureSubscription() {
    if (this._store?.entityId === this._config.todo_list && this._store.connection === this._hass.connection && this._unsubscribe) {
      this._store.updateHass(this._hass);
      return;
    }
    this.disconnectedCallback();
    const store = getTodoStore(this._hass, this._config.todo_list);
    this._store = store;
    this._unsubscribe = store.subscribe(snapshot => {
      if (this._store !== store) return;
      this._snapshot = snapshot;
      this._renderStatus();
      this._applyFilters();
    });
  }

  _reconcile(groups) {
    this._groups = groups;
    if (this._category !== null && !groups.some(group => group.name === this._category)) this._category = null;
    const keepProducts = new Set();
    const keepSections = new Set();
    groups.forEach((group, groupIndex) => {
      keepSections.add(group.name);
      let section = this._sections.get(group.name);
      if (!section) {
        const element = document.createElement('section');
        element.className = 'catalog-section';
        element.innerHTML = '<div class="catalog-category-heading"><h3 class="catalog-category-title"></h3><span class="catalog-category-count"></span></div><div class="catalog-grid"></div>';
        element.querySelector('h3').textContent = group.name;
        section = { element, grid: element.querySelector('.catalog-grid'), count: element.querySelector('.catalog-category-count') };
        this._sections.set(group.name, section);
      }
      if (this._content.children[groupIndex] !== section.element) this._content.insertBefore(section.element, this._content.children[groupIndex] || null);
      group.products.forEach((product, index) => {
        keepProducts.add(product.key);
        let record = this._products.get(product.key);
        if (!record) {
          record = { card: document.createElement('shopping-list-card'), signature: null };
          this._products.set(product.key, record);
        }
        record.product = product;
        const signature = JSON.stringify(product.config);
        if (record.signature !== signature) {
          record.card.setConfig(product.config);
          record.signature = signature;
        }
        record.card.hass = this._hass;
        if (section.grid.children[index] !== record.card) section.grid.insertBefore(record.card, section.grid.children[index] || null);
      });
    });
    for (const [key, record] of this._products) {
      if (!keepProducts.has(key)) { record.card.remove(); this._products.delete(key); }
    }
    for (const [name, section] of this._sections) {
      if (!keepSections.has(name)) { section.element.remove(); this._sections.delete(name); }
    }
    this._renderTabs();
  }

  _renderTabs() {
    const categories = [{ name: null, title: 'All', count: this._products.size }, ...this._groups.map(group => ({ name: group.name, title: group.name, count: group.products.length }))];
    const signature = JSON.stringify(categories);
    if (signature === this._tabSignature) return;
    this._tabSignature = signature;
    this._tabs.replaceChildren();
    categories.forEach((category, index) => {
      const button = document.createElement('button');
      button.className = 'catalog-tab';
      button.type = 'button';
      button.id = `catalog-tab-${index}`;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', 'catalog-content');
      button._category = category.name;
      const title = document.createElement('span');
      title.textContent = category.title;
      const count = document.createElement('span');
      count.className = 'catalog-tab-count';
      count.textContent = String(category.count);
      button.append(title, count);
      button.addEventListener('click', () => { this._category = category.name; this._applyFilters(); });
      button.addEventListener('keydown', event => {
        const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
        if (!keys.includes(event.key)) return;
        event.preventDefault();
        const buttons = [...this._tabs.children];
        const direction = event.key === 'ArrowLeft' ? -1 : 1;
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
          : (buttons.indexOf(button) + direction + buttons.length) % buttons.length;
        buttons[next].click();
        buttons[next].focus();
      });
      this._tabs.append(button);
    });
  }

  _applyFilters() {
    const terms = searchText(this._query).trim().split(/\s+/).filter(Boolean);
    const items = this._snapshot?.items;
    let visible = 0;
    for (const group of this._groups) {
      let count = 0;
      for (const product of group.products) {
        const record = this._products.get(product.key);
        const matches = (this._category === null || this._category === group.name)
          && terms.every(term => product.search.includes(term))
          && (!this._onList || productOnList(product, items));
        if (!matches && !record.card.hidden) record.card._clearHolds?.();
        record.card.hidden = !matches;
        record.card.inert = !matches;
        if (matches) count++;
      }
      const section = this._sections.get(group.name);
      section.element.hidden = count === 0;
      section.count.textContent = String(count);
      visible += count;
    }
    for (const tab of this._tabs.children) {
      const selected = tab._category === this._category;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected) this._content.setAttribute('aria-labelledby', tab.id);
    }
    this.shadowRoot.querySelector('.catalog-counter').textContent = `${visible} / ${this._products.size}`;
    this.shadowRoot.querySelector('.catalog-clear-search').hidden = !this._query;
    const empty = this.shadowRoot.querySelector('.catalog-empty');
    empty.hidden = visible > 0 || !!this._sourceError || !this._hass
      || (this._onList && items === null);
    empty.textContent = !this._products.size ? 'The product catalog is empty.'
      : this._onList ? 'No catalog products match the selected list filters.' : 'No products match your search.';
  }

  _renderStatus() {
    const status = this._snapshot?.status || 'loading';
    this.setAttribute('data-sync-state', status);
    const message = this._sourceError || this._snapshot?.error || (status === 'loading' ? 'Loading shopping list...' : '');
    const key = `${status}|${message}|${!!this._sourceError}`;
    if (key === this._statusKey) return;
    this._statusKey = key;
    this._status.replaceChildren();
    if (!message) return;
    const alert = document.createElement('ha-alert');
    alert.setAttribute('alert-type', this._sourceError || status === 'error' ? 'error' : status === 'loading' ? 'info' : 'warning');
    alert.textContent = message;
    if (!this._sourceError && status !== 'loading') {
      const refresh = document.createElement('button');
      refresh.className = 'catalog-icon-button';
      refresh.type = 'button';
      refresh.setAttribute('aria-label', 'Refresh shopping list');
      refresh.title = 'Refresh shopping list';
      refresh.innerHTML = '<ha-icon icon="mdi:refresh"></ha-icon>';
      refresh.addEventListener('click', () => { void this._store?.refresh().catch(() => {}); });
      alert.append(refresh);
    }
    this._status.append(alert);
  }

  getCardSize() {
    return Math.max(3, 2 + this._groups.reduce((rows, group) => rows + 1 + Math.ceil(group.products.length / (this._config?.columns || 4)) * 2, 0));
  }

  getLayoutOptions() { return { grid_rows: 'auto', grid_columns: 12, grid_min_columns: 4 }; }

  static getConfigElement() { return document.createElement('shopping-list-catalog-card-editor'); }

  static getStubConfig(hass) {
    const entities = Object.entries(hass?.states || {});
    const catalog = entities.find(([entityId, state]) => entityId.startsWith('sensor.')
      && Object.values(state.attributes || {}).some(value => Array.isArray(value) && value.some(entry => typeof entry?.title === 'string')));
    return {
      type: 'custom:shopping-list-catalog-card',
      catalog_entity: catalog?.[0] || '',
      todo_list: entities.find(([entityId]) => entityId.startsWith('todo.'))?.[0] || '',
    };
  }
}

if (!customElements.get('shopping-list-catalog-card')) {
  customElements.define('shopping-list-catalog-card', ShoppingListCatalogCard);
}
window.customCards = window.customCards || [];
if (!window.customCards.some(card => card.type === 'shopping-list-catalog-card')) {
  window.customCards.push({
    type: 'shopping-list-catalog-card', name: 'Shopping Catalog', preview: true,
    description: 'A shared product catalog with categories, search, and shopping-list controls.',
  });
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

    const icon    = escapeHtml(isOn ? onIcon : offIcon);
    const bg      = escapeHtml(this._rgbaFor(activeColor, 0.2));
    const fg      = escapeHtml(this._solidFor(activeColor));

    let cardBgStyle = '';
    if (isOn && this._config.colorize_background !== false) {
      cardBgStyle = `style="background-color: ${escapeHtml(this._rgbaFor(onColorN, 0.1))};"`;
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
    const headBg = escapeHtml(this._rgbaFor(headColor, 0.2));
    const headFg = escapeHtml(this._solidFor(headColor));
    const headIcon = escapeHtml(anyOn ? onIcon : offIcon);
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
      cardBgStyle = `style="background-color: ${escapeHtml(this._rgbaFor(onColorN, 0.1))};"`;
    }

    const enableQty = !!this._config.enable_quantity;
    const decBtn = `<div class="quantity-btn" role="button" tabindex="0" aria-label="Decrease quantity" data-action="decrement"><ha-icon icon="mdi:minus"></ha-icon></div>`;
    const incBtn = `<div class="quantity-btn" role="button" tabindex="0" aria-label="Increase quantity" data-action="increment"><ha-icon icon="mdi:plus"></ha-icon></div>`;

    const onSolid = escapeHtml(this._solidFor(onColorN));
    const rowsHtml = states.map((s, i) => {
      const thumb = s.image
        ? `<div class="type-thumb"><img src="${escapeHtml(s.image)}" alt=""><ha-icon class="type-image-fallback" icon="${escapeHtml(s.icon || offIcon)}"></ha-icon></div>`
        : s.icon ? `<div class="type-thumb"><ha-icon icon="${escapeHtml(s.icon)}"></ha-icon></div>` : '';
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
      const rowStyle = s.isOn ? ` style="background:${escapeHtml(this._rgbaFor(onColorN, 0.12))};"` : '';
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
    card.querySelectorAll('.type-thumb img').forEach(image => {
      image.addEventListener('error', () => image.parentElement?.classList.add('image-error'));
    });
    const img = card.querySelector('.image-wrapper img');
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
