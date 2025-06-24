/*
 * Shopping List Card
 *
 * A Home Assistant Lovelace card to manage items on a to-do list with a
 * clean, modern interface and a visual editor.
 *
 * Author: eyalgal
 * License: MIT
 */

// ── Editor ───────────────────────────────────────────────────────────────────

class ShoppingListCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._rendered = false;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._rendered) this._render();
  }

  setConfig(config) {
    this._config = config;
    if (this._rendered) this._updateFormValues();
  }

  _render() {
    if (!this.shadowRoot || !this._hass) return;

    this.shadowRoot.innerHTML = `
      <style>
        .row { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
        .switch-row { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
        ha-textfield, ha-entity-picker, ha-icon-picker { flex-grow: 1; }
        .picker-row { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
        input[type="color"] {
          width: 40px;
          height: 40px;
          padding: 0;
          border: 1px solid var(--divider-color, #888);
          border-radius: 4px;
          cursor: pointer;
          background: none;
        }
      </style>

      <div class="row">
        <ha-entity-picker id="todo_list" label="To-Do List Entity (Required)" required></ha-entity-picker>
      </div>
      <div class="row">
        <ha-textfield id="title" label="Title (Required)" required></ha-textfield>
        <ha-textfield id="subtitle" label="Subtitle (Optional)"></ha-textfield>
      </div>
      <div class="switch-row">
        <ha-switch id="enable_quantity"></ha-switch>
        <span style="font-weight:500; flex-grow: 1;">Enable Quantity</span>
      </div>
      <div class="picker-row">
        <ha-icon-picker id="off_icon" label="Off Icon"></ha-icon-picker>
        <ha-textfield id="off_color" label="Off Color (name or hex)"></ha-textfield>
        <input type="color" id="off_color_picker" title="Pick off-state color" />
      </div>
      <div class="picker-row">
        <ha-icon-picker id="on_icon" label="On Icon"></ha-icon-picker>
        <ha-textfield id="on_color" label="On Color (name or hex)"></ha-textfield>
        <input type="color" id="on_color_picker" title="Pick on-state color" />
      </div>
      <div class="switch-row">
        <ha-switch id="colorize_background"></ha-switch>
        <span style="font-weight:500; flex-grow: 1;">Colorize card background when "On"</span>
      </div>
    `;

    // Setup pickers
    const ep = this.shadowRoot.querySelector('#todo_list');
    ep.hass = this._hass;
    ep.includeDomains = ['todo'];
    ep.allowCustomEntity = false;

    ['off_icon', 'on_icon'].forEach(id => {
      this.shadowRoot.querySelector(`#${id}`).hass = this._hass;
    });

    // Add all event listeners
    this.shadowRoot.querySelectorAll('ha-textfield, ha-switch, ha-entity-picker, ha-icon-picker').forEach(el => {
        el.addEventListener('input', () => this._handleConfigChanged());
        el.addEventListener('change', () => this._handleConfigChanged());
        el.addEventListener('value-changed', () => this._handleConfigChanged());
    });

    ['off','on'].forEach(type => {
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

  _getEditorHex(val) {
    if (!val) return '#000000';
    if (val.startsWith('#')) return val;
    const hex = ShoppingListCard.COLOR_MAP[val.toLowerCase()];
    return hex || '#000000';
  }

  _updateFormValues() {
    const s = this.shadowRoot;
    s.querySelector('#title').value = this._config.title || '';
    s.querySelector('#subtitle').value = this._config.subtitle || '';
    s.querySelector('#todo_list').value = this._config.todo_list || '';
    s.querySelector('#enable_quantity').checked = !!this._config.enable_quantity;
    s.querySelector('#colorize_background').checked = !!this._config.colorize_background;

    ['off','on'].forEach(type => {
      s.querySelector(`#${type}_icon`).value = this._config[`${type}_icon`] || ShoppingListCard[`DEFAULT_${type.toUpperCase()}_ICON`];
      const col = this._config[`${type}_color`] || ShoppingListCard[`DEFAULT_${type.toUpperCase()}_COLOR`];
      s.querySelector(`#${type}_color`).value = col;
      s.querySelector(`#${type}_color_picker`).value = this._getEditorHex(col);
    });
  }

  _handleConfigChanged() {
    const s = this.shadowRoot;
    const cfg = { type: 'custom:shopping-list-card', title: s.querySelector('#title').value, todo_list: s.querySelector('#todo_list').value };
    if (s.querySelector('#subtitle').value) cfg.subtitle = s.querySelector('#subtitle').value;
    if (s.querySelector('#enable_quantity').checked) cfg.enable_quantity = true;
    if (s.querySelector('#colorize_background').checked) cfg.colorize_background = true;

    ['off','on'].forEach(type => {
      const icon = s.querySelector(`#${type}_icon`).value;
      if (icon && icon !== ShoppingListCard[`DEFAULT_${type.toUpperCase()}_ICON`]) cfg[`${type}_icon`] = icon;
      const col = s.querySelector(`#${type}_color`).value;
      if (col && col !== ShoppingListCard[`DEFAULT_${type.toUpperCase()}_COLOR`]) cfg[`${type}_color`] = col;
    });
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: cfg }, bubbles: true, composed: true }));
  }
}
customElements.define('shopping-list-card-editor', ShoppingListCardEditor);

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
    this._lastUpdated = null;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    const st = hass.states[this._config.todo_list];
    if (!st || st.last_updated === this._lastUpdated) return;
    this._lastUpdated = st.last_updated;

    if (!this.content) {
      this.innerHTML = `<ha-card><div class="card-content"></div></ha-card>`;
      this.content = this.querySelector('div.card-content');
      this._attachStyles();
    }
    this._render();
  }

  setConfig(config) {
    if (!config.title)     throw new Error('You must define a title.');
    if (!config.todo_list) throw new Error('You must define a todo_list entity_id.');
    this._config = config;
  }

  static getConfigElement() { return document.createElement('shopping-list-card-editor'); }
  static getStubConfig()    { return { type: 'custom:shopping-list-card', title: 'New Item', todo_list: '' }; }

  _escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

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

  async _render() {
    this._isUpdating = false;
    const container = this.content.querySelector('.card-container');
    if (container) container.classList.remove('is-updating');
    if (!this._config || !this._hass) return;

    const state = this._hass.states[this._config.todo_list];
    if (!state) {
      this.content.innerHTML = `<div class="warning">Entity not found: ${this._config.todo_list}</div>`;
      return;
    }

    const fullName = this._config.subtitle
      ? `${this._config.title} - ${this._config.subtitle}`
      : this._config.title;

    let summaries = [];
    try {
      const res = await this._hass.callWS({
        type: 'todo/item/list',
        entity_id: this._config.todo_list,
      });
      summaries = res.items.map(i => i.summary);
    } catch (e) {
      console.error('Error fetching items', e);
      this.content.innerHTML = `<div class="warning">Error fetching items.</div>`;
      return;
    }

    const rx = new RegExp(`^${this._escapeRegExp(fullName)}(?: \\((\\d+)\\))?$`, 'i');
    let isOn = false, qty = 0, matched = null;
    for (const s of summaries) {
      const m = s.match(rx);
      if (m) { isOn = true; matched = s; qty = m[1] ? +m[1] : 1; break; }
    }

    const onIcon    = this._config.on_icon   || ShoppingListCard.DEFAULT_ON_ICON;
    const offIcon   = this._config.off_icon  || ShoppingListCard.DEFAULT_OFF_ICON;
    const onColorN  = this._config.on_color  || ShoppingListCard.DEFAULT_ON_COLOR;
    const offColorN = this._config.off_color || ShoppingListCard.DEFAULT_OFF_COLOR;
    const onHex     = this._getColorValue(onColorN)  || '#4CAF50';
    const offHex    = this._getColorValue(offColorN) || '#808080';

    const icon    = isOn ? onIcon : offIcon;
    const bg      = isOn ? this._toRgba(onHex, 0.2) : this._toRgba(offHex, 0.2);
    const fg      = isOn ? onHex : offHex;

    let cardBgStyle = '';
    if (isOn && this._config.colorize_background) {
      cardBgStyle = `style="background-color: ${this._toRgba(onHex, 0.1)};"`;
    }

    let qtyControls = '';
    if (isOn && this._config.enable_quantity) {
        qtyControls = `
            <div class="quantity-controls">
                ${qty > 1 ? `<div class="quantity-btn" data-action="decrement"><ha-icon icon="mdi:minus"></ha-icon></div>` : ''}
                <span class="quantity">${qty}</span>
                <div class="quantity-btn" data-action="increment"><ha-icon icon="mdi:plus"></ha-icon></div>
            </div>
        `;
    }

    this.content.innerHTML = `
      <div class="card-container ${isOn?'is-on':'is-off'}" ${cardBgStyle}>
        <div class="icon-wrapper" style="background:${bg}; color:${fg};">
          <ha-icon icon="${icon}"></ha-icon>
        </div>
        <div class="info-container">
          <div class="primary">${this._config.title}</div>
          ${this._config.subtitle?`<div class="secondary">${this._config.subtitle}</div>`:''}
        </div>
        ${qtyControls}
      </div>
    `;

    this.content.querySelector('.card-container')
      .onclick = ev => this._handleTap(ev, isOn, matched, qty, fullName);
  }

  async _handleTap(ev, isOn, matched, qty, fullName) {
    if (this._isUpdating) return;
    ev.stopPropagation();
    const action = ev.target.closest('.quantity-btn')?.dataset.action;

    this._isUpdating = true;
    this.content.querySelector('.card-container').classList.add('is-updating');

    let call;
    if (action === 'increment') {
      call = this._updateQuantity(matched, qty+1, fullName);
    } else if (action === 'decrement') {
      if (qty>1) call = this._updateQuantity(matched, qty-1, fullName);
    } else {
      if (isOn) {
        if (!this._config.enable_quantity || qty===1) call = this._removeItem(matched);
      } else {
        call = this._addItem(fullName);
      }
    }

    if (call) {
      try {
        await call;
        this._lastUpdated = null;
      } catch (e) {
        console.error('Service call failed', e);
      } finally {
        this._isUpdating = false;
        this.content.querySelector('.card-container')?.classList.remove('is-updating');
      }
    } else {
        this._isUpdating = false;
        this.content.querySelector('.card-container')?.classList.remove('is-updating');
    }
  }

  _addItem(name) {
    return this._hass.callService('todo','add_item',{ entity_id: this._config.todo_list, item: name });
  }

  _removeItem(item) {
    return item
      ? this._hass.callService('todo','remove_item',{ entity_id: this._config.todo_list, item })
      : Promise.resolve();
  }

  _updateQuantity(oldItem,newQty,fullName) {
    const newName = newQty>1 ? `${fullName} (${newQty})` : fullName;
    return this._hass.callService('todo','update_item',{
      entity_id: this._config.todo_list,
      item: oldItem,
      rename: newName,
    });
  }

  _attachStyles() {
    if (this.querySelector('style')) return;
    const s = document.createElement('style');
    s.textContent = `
      ha-card { border-radius: var(--ha-card-border-radius,12px); background: var(--card-background-color); box-shadow: var(--ha-card-box-shadow); overflow:hidden }
      .card-content { padding:0 !important }
      .card-container { display:flex; align-items:center; padding:10px; gap:10px; cursor:pointer; transition:background-color .2s }
      .card-container:hover { background: var(--secondary-background-color) }
      .icon-wrapper { display:flex; align-items:center; justify-content:center; width:36px; height:36px; border-radius:50%; flex-shrink:0 }
      .info-container { flex-grow:1; overflow:hidden; min-width:0 }
      .primary { font-size:14px; font-weight:500; line-height:20px; color:var(--primary-text-color); white-space:nowrap; overflow:hidden; text-overflow:ellipsis }
      .secondary { font-size:12px; font-weight:400; line-height:16px; color:var(--secondary-text-color); white-space:nowrap; overflow:hidden; text-overflow:ellipsis }
      .quantity-controls { display:flex; align-items:center; gap:4px; flex-shrink:0 }
      .quantity { font-size:14px; font-weight:500; min-width:20px; text-align:center }
      .quantity-btn { width:24px; height:24px; background:rgba(128,128,128,0.2); border-radius:5px; display:flex; align-items:center; justify-content:center }
      .quantity-btn ha-icon { --mdc-icon-size: 20px; }
      .warning { padding:12px; background:var(--error-color); color:var(--text-primary-color); border-radius:var(--ha-card-border-radius,12px) }
    `;
    this.appendChild(s);
  }

  getCardSize() {
    return 1;
  }
}
customElements.define('shopping-list-card', ShoppingListCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'shopping-list-card',
  name: 'Shopping List Card',
  preview: true,
  description: 'A card to manage items on a shopping list.',
});
