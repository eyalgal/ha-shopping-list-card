/*
 * Shopping List Card
 *
 * A Home Assistant Lovelace card to manage items on a to-do list with a
 * clean, modern interface and a visual editor.
 *
 * Author: eyalgal
 * License: MIT
 * Version: 1.8.0
 *
 * Note: This card requires a to-do entity to function properly.
 * For more information, visit: https://github.com/eyalgal/ha-shopping-list-card
 */

const CARD_VERSION = '1.8.0';

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Shared subscription manager ──────────────────────────────────────────────
// Multiple cards on the same dashboard often point at the same todo entity.
// Opening one WebSocket subscription per card causes a load-time storm (dozens
// of `todo/item/subscribe` messages at once) which can crash the frontend.
// This manager opens a single subscription per (connection, entity) pair and
// multicasts updates to every subscribed card, with reference counting so the
// subscription is closed when the last card detaches.
const _slcSubs = new WeakMap(); // connection -> Map<entityId, SubRecord>

function _slcSubscribe(hass, entityId, listener) {
  const conn = hass.connection;
  let perConn = _slcSubs.get(conn);
  if (!perConn) { perConn = new Map(); _slcSubs.set(conn, perConn); }

  let rec = perConn.get(entityId);
  if (!rec) {
    rec = {
      listeners: new Set(),
      lastItems: null,
      unsub: null,
      unsubPromise: null,
    };
    perConn.set(entityId, rec);
    rec.unsubPromise = conn.subscribeMessage(
      (msg) => {
        rec.lastItems = msg?.items || [];
        for (const l of rec.listeners) {
          try { l(rec.lastItems); } catch (e) { console.error('Shopping List Card listener error', e); }
        }
      },
      { type: 'todo/item/subscribe', entity_id: entityId }
    );
    rec.unsubPromise
      .then(unsub => { rec.unsub = unsub; })
      .catch(err => {
        console.error('Shopping List Card: subscription failed', err);
        perConn.delete(entityId);
        for (const l of rec.listeners) { try { l(null, err); } catch (_) {} }
      });
  }

  rec.listeners.add(listener);
  if (rec.lastItems) {
    // Immediately deliver the cached snapshot to the new subscriber.
    queueMicrotask(() => { if (rec.listeners.has(listener)) listener(rec.lastItems); });
  }

  return () => {
    rec.listeners.delete(listener);
    if (rec.listeners.size === 0) {
      perConn.delete(entityId);
      if (rec.unsub) { try { rec.unsub(); } catch (_) {} }
      else if (rec.unsubPromise) {
        rec.unsubPromise.then(u => { try { u(); } catch (_) {} }).catch(() => {});
      }
    }
  };
}

// ── Editor ───────────────────────────────────────────────────────────────────

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
              <ha-textfield id="title" label="Title" required></ha-textfield>
              <ha-textfield id="subtitle" label="Subtitle"></ha-textfield>
            </div>
            <ha-picture-upload id="image_upload"></ha-picture-upload>
            <div class="image-fallback">
              <ha-textfield id="image" label="Image URL (optional)" placeholder="/local/... or https://..."></ha-textfield>
              <ha-textfield id="image_base" label="Image base path (optional)" placeholder="/local/images/shopping-list/"></ha-textfield>
              <div class="hint">Upload an image above or paste a URL. Or set a base path and the card will look for <code>&lt;base&gt;&lt;slug&gt;.png</code> derived from the title.</div>
            </div>
            <ha-textfield id="list_prefix" label="List prefix (optional)" placeholder="e.g. Dairy" helper="Stored in the list as 'Prefix - Title' for category sorting; display is unchanged."></ha-textfield>
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
                <ha-textfield id="off_color" label="Off color"></ha-textfield>
                <input type="color" class="swatch" id="off_color_picker" title="Pick off color" />
              </div>
            </div>
            <div class="color-group">
              <span class="color-group-label">On state</span>
              <ha-icon-picker id="on_icon" label="On icon"></ha-icon-picker>
              <div class="color-row">
                <ha-textfield id="on_color" label="On color"></ha-textfield>
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
              <ha-textfield id="quantity_step" label="Quantity step" type="number" min="1" max="99" helper="How much +/- adjusts"></ha-textfield>
              <ha-textfield id="quantity_max" label="Quantity max" type="number" min="1" max="999" helper="Optional cap"></ha-textfield>
            </div>
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
      'ha-textfield, ha-switch, ha-entity-picker, ha-icon-picker'
    ).forEach(el => {
      const handler = () => this._handleConfigChanged();
      el.addEventListener('input', handler);
      el.addEventListener('change', handler);
      el.addEventListener('value-changed', handler);
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
    const hex = ShoppingListCard.COLOR_MAP[val.toLowerCase()];
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
    s.querySelector('#image').value = c.image || '';
    s.querySelector('#image_base').value = c.image_base || '';
    s.querySelector('#list_prefix').value = c.list_prefix || '';
    const pu = s.querySelector('#image_upload');
    if (pu) pu.value = c.image || '';
    s.querySelector('#todo_list').value = c.todo_list || '';
    s.querySelector('#enable_quantity').checked = !!c.enable_quantity;
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
      s.querySelector(`#${type}_icon`).value = c[`${type}_icon`] || ShoppingListCard[`DEFAULT_${type.toUpperCase()}_ICON`];
      const col = c[`${type}_color`] || ShoppingListCard[`DEFAULT_${type.toUpperCase()}_COLOR`];
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
    const img = s.querySelector('#image').value;
    if (img) n.image = img; else delete n.image;
    const imgBase = s.querySelector('#image_base').value.trim();
    if (imgBase) n.image_base = imgBase; else delete n.image_base;
    const prefix = s.querySelector('#list_prefix').value.trim();
    if (prefix) n.list_prefix = prefix; else delete n.list_prefix;
    n.todo_list = s.querySelector('#todo_list').value;

    const enableQty = s.querySelector('#enable_quantity').checked;
    if (enableQty) n.enable_quantity = true; else delete n.enable_quantity;

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
      if (icon === ShoppingListCard[`DEFAULT_${type.toUpperCase()}_ICON`]) delete n[`${type}_icon`];
      else n[`${type}_icon`] = icon;

      const col = s.querySelector(`#${type}_color`).value;
      if (col === ShoppingListCard[`DEFAULT_${type.toUpperCase()}_COLOR`]) delete n[`${type}_color`];
      else n[`${type}_color`] = col;
    });

    this._config = n;
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: n }, bubbles: true, composed: true }));
  }
}
if (!customElements.get('shopping-list-card-editor')) {
  customElements.define('shopping-list-card-editor', ShoppingListCardEditor);
}

// ── Card ─────────────────────────────────────────────────────────────────────

class ShoppingListCard extends HTMLElement {
  static DEFAULT_ON_ICON    = 'mdi:check';
  static DEFAULT_OFF_ICON   = 'mdi:plus';
  static DEFAULT_ON_COLOR   = 'green';
  static DEFAULT_OFF_COLOR  = 'grey';
  static COLOR_MAP = {
    red: '#F44336', pink: '#E91E63', purple: '#9C27B0',
    'deep-purple': '#673AB7', indigo: '#3F51B5',
    blue: '#2196F3', 'light-blue': '#03A9F4',
    cyan: '#00BCD4', teal: '#009688', green: '#4CAF50',
    lime: '#CDDC39', yellow: '#FFEB3B', amber: '#FFC107',
    orange: '#FF9800', brown: '#795548', grey: '#9E9E9E',
    'blue-grey': '#607D8B',
  };

  constructor() {
    super();
    this._isUpdating = false;
    this._items = null;
    this._unsubscribe = null;
    this._subscribedEntity = null;
  }

  set hass(hass) {
    const firstHass = !this._hass;
    const prevState = this._hass?.states?.[this._config?.todo_list];
    this._hass = hass;
    if (!this._config) return;
    if (firstHass) this._ensureSubscription();
    // Only re-render if the entity's availability changed (exists / unavailable).
    // Item changes are pushed via subscription; avoid re-rendering on unrelated state updates.
    const newState = hass.states?.[this._config.todo_list];
    const prevAvail = !!prevState && prevState.state !== 'unavailable';
    const newAvail = !!newState && newState.state !== 'unavailable';
    if (prevAvail !== newAvail && this._items !== null) this._render();
  }

  setConfig(config) {
    if (!config.title)      throw new Error('You must define a title.');
    if (!config.todo_list) throw new Error('You must define a todo_list entity_id.');
    const prev = this._config;
    this._config = config;
    if (prev && prev.todo_list !== config.todo_list) {
      this._items = null;
      this._teardownSubscription();
    }
    if (this._hass) {
      this._ensureSubscription();
      if (this._items !== null) this._render();
    }
  }

  connectedCallback() {
    if (this._hass && this._config) this._ensureSubscription();
  }

  disconnectedCallback() {
    this._teardownSubscription();
  }

  _ensureSubscription() {
    if (!this._hass || !this._config?.todo_list) return;
    if (this._subscribedEntity === this._config.todo_list && this._unsubscribe) return;
    this._teardownSubscription();
    const entityId = this._config.todo_list;
    this._subscribedEntity = entityId;

    try {
      this._unsubscribe = _slcSubscribe(this._hass, entityId, (items, err) => {
        if (err) { this._fallbackFetch(); return; }
        this._items = (items || []).filter(i => i.status === 'needs_action');
        this._render();
      });
    } catch (e) {
      console.error('Shopping List Card: subscription failed, falling back to polling', e);
      this._fallbackFetch();
    }
  }

  async _fallbackFetch() {
    if (!this._hass || !this._config?.todo_list) return;
    try {
      const res = await this._hass.callWS({
        type: 'todo/item/list',
        entity_id: this._config.todo_list,
      });
      this._items = (res.items || []).filter(i => i.status === 'needs_action');
      this._render();
    } catch (e) {
      console.error('Shopping List Card: fetch failed', e);
      this._renderError('Error fetching items.');
    }
  }

  _teardownSubscription() {
    if (this._unsubscribe) {
      try { this._unsubscribe(); } catch (_) {}
      this._unsubscribe = null;
    }
    this._subscribedEntity = null;
  }

  static getConfigElement() { return document.createElement('shopping-list-card-editor'); }
  static getStubConfig() {
    return {
      type: 'custom:shopping-list-card',
      title: 'New Item',
      todo_list: '' // Add empty string to pass validation, editor will populate
    };
  }

  _escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /** Slugify a title for use in auto-derived image paths. */
  _slugify(s) {
    return String(s || '')
      .toLowerCase()
      .trim()
      .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
      .replace(/^-+|-+$/g, '');
  }

  /** Build the todo item summary to match / write, honoring list_prefix. */
  _buildFullName() {
    const c = this._config;
    const base = c.subtitle ? `${c.title} - ${c.subtitle}` : c.title;
    return c.list_prefix ? `${c.list_prefix} - ${base}` : base;
  }

  /** Resolve the effective image URL: explicit `image` wins, otherwise
   *  derive from `image_base` + slug(title) + '.png' when image_base is set. */
  _resolveImage() {
    const c = this._config;
    if (c.image) return c.image;
    if (c.image_base) {
      const base = c.image_base.endsWith('/') ? c.image_base : c.image_base + '/';
      const slug = this._slugify(c.title);
      if (slug) return `${base}${slug}.png`;
    }
    return '';
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
    this.innerHTML = `<ha-card><div class="card-content"></div></ha-card>`;
    this.content = this.querySelector('div.card-content');
    this._attachStyles();
  }

  _renderError(message) {
    this._ensureShell();
    this.content.innerHTML = `<ha-alert alert-type="error">${escapeHtml(message)}</ha-alert>`;
  }

  _render() {
    this._ensureShell();
    this._isUpdating = false;
    const container = this.content.querySelector('.card-container');
    if (container) container.classList.remove('is-updating');
    if (!this._config || !this._hass) return;

    const state = this._hass.states[this._config.todo_list];
    if (!state) {
      this._renderError(`Entity not found: ${this._config.todo_list}`);
      return;
    }

    if (this._items === null) {
      return; // waiting for subscription
    }

    const fullName = this._buildFullName();

    const rx = new RegExp(`^${this._escapeRegExp(fullName)}(?: \\((\\d+)\\))?$`, 'i');
    let isOn = false, qty = 0, matched = null, matchedUid = null;
    for (const item of this._items) {
      const m = item.summary.match(rx);
      if (m) { isOn = true; matched = item.summary; matchedUid = item.uid; qty = m[1] ? +m[1] : 1; break; }
    }

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
                             <img src="${safeImage}" alt="${safeTitle}" crossorigin="anonymous" />
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
                                ${qty > 1 ? decBtn : `<div class="quantity-btn-placeholder"></div>`}
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
                             <img src="${safeImage}" alt="${safeTitle}" crossorigin="anonymous" />
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
                                ${qty > 1 ? decBtn : ''}
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
    this._wireInteractions(card, isOn, matched, matchedUid, qty, fullName);
    this._wireImageError(card);
  }

  _wireImageError(card) {
    const img = card.querySelector('img');
    if (!img) return;
    img.addEventListener('error', () => {
      img.style.display = 'none';
      img.parentElement?.classList.add('image-error');
    });
  }

  _wireInteractions(card, isOn, matched, matchedUid, qty, fullName) {
    const tap = (ev) => this._handleTap(ev, isOn, matched, matchedUid, qty, fullName);
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

    const holdCfg = this._config.hold_action;
    if (holdCfg?.action === 'none') return;

    let holdTimer = null;
    let heldFired = false;
    let startX = 0, startY = 0;

    const startHold = (ev) => {
      // Don't start hold on quantity buttons
      if (ev.target.closest('.quantity-btn')) return;
      heldFired = false;
      const touch = ev.touches?.[0];
      startX = touch ? touch.clientX : ev.clientX;
      startY = touch ? touch.clientY : ev.clientY;
      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => {
        heldFired = true;
        holdTimer = null;
        this._vibrate();
        this._handleHold(isOn, matched, matchedUid);
      }, 500);
    };

    const cancelHold = () => { clearTimeout(holdTimer); holdTimer = null; };

    const maybeCancelOnMove = (ev) => {
      if (!holdTimer) return;
      const touch = ev.touches?.[0];
      const x = touch ? touch.clientX : ev.clientX;
      const y = touch ? touch.clientY : ev.clientY;
      if (Math.abs(x - startX) > 10 || Math.abs(y - startY) > 10) cancelHold();
    };

    card.addEventListener('mousedown', startHold);
    card.addEventListener('touchstart', startHold, { passive: true });
    card.addEventListener('mousemove', maybeCancelOnMove);
    card.addEventListener('touchmove', maybeCancelOnMove, { passive: true });
    ['mouseup', 'mouseleave', 'touchend', 'touchcancel'].forEach(e =>
      card.addEventListener(e, cancelHold)
    );
    // Swallow the synthesized click after a successful hold.
    card.addEventListener('click', (ev) => {
      if (heldFired) {
        ev.stopImmediatePropagation();
        ev.preventDefault();
        heldFired = false;
      }
    }, true);
  }

  _handleHold(isOn, matched, matchedUid) {
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

    // Default: remove the item entirely if it is on the list.
    if (action === 'default') {
      if (isOn) this._removeByUidOrSummary(matchedUid, matched)
        .catch(e => console.error('Hold remove failed', e));
    }
  }

  _vibrate() {
    if (this._config?.haptic && navigator.vibrate) navigator.vibrate(50);
  }

  async _handleTap(ev, isOn, matched, matchedUid, qty, fullName) {
    if (this._isUpdating) return;
    ev.stopPropagation();
    const action = ev.target.closest('.quantity-btn')?.dataset.action;

    this._vibrate();
    this._isUpdating = true;
    this.content.querySelector('.card-container').classList.add('is-updating');

    let call;
    const step = Math.max(1, parseInt(this._config.quantity_step, 10) || 1);
    const maxQty = parseInt(this._config.quantity_max, 10);
    if (action === 'increment') {
      let next = qty + step;
      if (!isNaN(maxQty) && maxQty > 0) next = Math.min(next, maxQty);
      if (next !== qty) call = this._updateQuantity(matchedUid, matched, next, fullName);
    } else if (action === 'decrement') {
      const next = qty - step;
      if (next >= 1) call = this._updateQuantity(matchedUid, matched, next, fullName);
      else if (qty > 1) call = this._updateQuantity(matchedUid, matched, 1, fullName);
    } else {
      if (isOn) {
        if (!this._config.enable_quantity || qty===1) call = this._removeByUidOrSummary(matchedUid, matched);
      } else {
        call = this._addItem(fullName);
      }
    }

    if (call) {
      try {
        await call;
        // Subscription will push the update; no manual re-render needed.
      } catch (e) {
        console.error('Service call failed', e);
      }
    }
    this._isUpdating = false;
    this.content.querySelector('.card-container')?.classList.remove('is-updating');
  }

  _addItem(name) {
    return this._hass.callService('todo','add_item',{ entity_id: this._config.todo_list, item: name });
  }

  _removeByUidOrSummary(uid, summary) {
    const target = uid || summary;
    if (!target) return Promise.resolve();
    return this._hass.callService('todo','remove_item',{
      entity_id: this._config.todo_list,
      item: target,
    });
  }

  _updateQuantity(uid, oldSummary, newQty, fullName) {
    const newName = newQty>1 ? `${fullName} (${newQty})` : fullName;
    return this._hass.callService('todo','update_item',{
      entity_id: this._config.todo_list,
      item: uid || oldSummary,
      rename: newName,
    });
  }

  _attachStyles() {
    if (this.querySelector('style')) return;
    const s = document.createElement('style');
    s.textContent = `
      ha-card { box-sizing: border-box; border-radius: var(--ha-card-border-radius,12px); box-shadow: var(--ha-card-box-shadow); overflow:hidden; background: var(--ha-card-background, var(--card-background-color)); }
      .card-content { padding:0 !important; margin: -1px 0; }
      .card-container { display:flex; align-items:center; padding:10px 12px; gap:10px; cursor:pointer; transition:background-color .2s; box-sizing: border-box; outline: none; }
      .card-container:hover { background: var(--secondary-background-color) }
      .card-container:focus-visible { box-shadow: 0 0 0 2px var(--primary-color); }
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
    `;
    this.appendChild(s);
  }

  getCardSize() {
    if (this._config && this._config.layout === 'vertical') {
      return this._config.show_name === false ? 1 : 2;
    }
    return 1;
  }

  getLayoutOptions() {
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
  });
}

console.info(
  `%c SHOPPING-LIST-CARD %c v${CARD_VERSION} `,
  'color: white; background: #4CAF50; font-weight: 700;',
  'color: #4CAF50; background: white; font-weight: 700;'
);
