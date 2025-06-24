
/**
 * Shopping List Card
 *
 * A Home Assistant Lovelace card to manage items on a to-do list with a
 * clean, modern interface and a visual editor.
 *
 * Extended by: eyalgal
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
        .row { display: flex; gap: 8px; margin-bottom: 16px; }
        .row-full { display: flex; margin-bottom: 16px; }
        .row-full ha-entity-picker { flex: 1; }
        ha-textfield, ha-entity-picker, ha-icon-picker, ha-select { display: block; }
      </style>

      <!-- Title + Subtitle -->
      <div class="row">
        <ha-textfield id="title" label="Title (Required)" required></ha-textfield>
        <ha-textfield id="subtitle" label="Subtitle (Optional)"></ha-textfield>
      </div>

      <!-- Entity Picker -->
      <div class="row-full">
        <ha-entity-picker id="todo_list" label="To-Do List Entity (Required)" required></ha-entity-picker>
      </div>

      <!-- Quantity -->
      <div class="row-full">
        <span style="align-self:center; margin-right:8px; font-weight:500;">Enable Quantity Controls</span>
        <ha-switch id="enable_quantity"></ha-switch>
      </div>

      <!-- Off state icon + color -->
      <div class="row">
        <ha-icon-picker id="off_icon" label="Off Icon"></ha-icon-picker>
        <ha-select id="off_color" label="Off Color"></ha-select>
      </div>

      <!-- On state icon + color -->
      <div class="row">
        <ha-icon-picker id="on_icon" label="On Icon"></ha-icon-picker>
        <ha-select id="on_color" label="On Color"></ha-select>
      </div>
    `;

    // entity picker setup
    const ep = this.shadowRoot.querySelector('#todo_list');
    ep.hass = this._hass;
    ep.includeDomains = ['todo'];
    ep.allowCustomEntity = false;

    // both icon-pickers load lists
    ['off_icon','on_icon'].forEach(id => {
      const ip = this.shadowRoot.querySelector('#'+id);
      ip.hass = this._hass;
    });

    // populate color dropdowns
    ['off','on'].forEach(type => {
      const sel = this.shadowRoot.querySelector(`#${type}_color`);
      sel.innerHTML = '';
      Object.entries(ShoppingListCard.COLOR_MAP).forEach(([name, hex]) => {
        const item = document.createElement('mwc-list-item');
        item.setAttribute('value', name);
        item.setAttribute('graphic', 'icon');
        item.innerHTML = `
          <span slot="graphic">
            <ha-icon icon="mdi:circle" style="color:${hex};"></ha-icon>
          </span>
          ${name}
        `;
        sel.appendChild(item);
      });
    });

    // listeners
    ['title','subtitle','enable_quantity'].forEach(id => {
      const el = this.shadowRoot.querySelector('#'+id);
      const evt = el.tagName === 'HA-SWITCH' ? 'change' : 'input';
      el.addEventListener(evt, () => this._handleConfigChanged());
    });
    ep.addEventListener('value-changed', () => this._handleConfigChanged());
    ['off_icon','on_icon'].forEach(id => {
      this.shadowRoot.querySelector('#'+id)
        .addEventListener('value-changed', () => this._handleConfigChanged());
    });
    ['off_color','on_color'].forEach(id => {
      this.shadowRoot.querySelector('#'+id)
        .addEventListener('selected', () => this._handleConfigChanged());
    });

    this._rendered = true;
    if (this._config) this._updateFormValues();
  }

  _updateFormValues() {
    const s = this.shadowRoot;
    s.querySelector('#title').value           = this._config.title        || '';
    s.querySelector('#subtitle').value        = this._config.subtitle     || '';
    s.querySelector('#todo_list').value       = this._config.todo_list    || '';
    s.querySelector('#enable_quantity').checked = !!this._config.enable_quantity;

    s.querySelector('#off_icon').value        = this._config.off_icon     || ShoppingListCard.DEFAULT_OFF_ICON;
    s.querySelector('#on_icon').value         = this._config.on_icon      || ShoppingListCard.DEFAULT_ON_ICON;

    s.querySelector('#off_color').value       = this._config.off_color    || ShoppingListCard.DEFAULT_OFF_COLOR;
    s.querySelector('#on_color').value        = this._config.on_color     || ShoppingListCard.DEFAULT_ON_COLOR;
  }

  _handleConfigChanged() {
    const s   = this.shadowRoot;
    const cfg = {
      type:      'custom:shopping-list-card',
      title:     s.querySelector('#title').value,
      todo_list: s.querySelector('#todo_list').value,
    };

    if (s.querySelector('#subtitle').value)          cfg.subtitle        = s.querySelector('#subtitle').value;
    if (s.querySelector('#enable_quantity').checked) cfg.enable_quantity = true;

    const offI = s.querySelector('#off_icon').value;
    if (offI && offI !== ShoppingListCard.DEFAULT_OFF_ICON)  cfg.off_icon = offI;
    const onI  = s.querySelector('#on_icon').value;
    if (onI  && onI  !== ShoppingListCard.DEFAULT_ON_ICON)   cfg.on_icon  = onI;

    const offC = s.querySelector('#off_color').value;
    if (offC && offC !== ShoppingListCard.DEFAULT_OFF_COLOR) cfg.off_color = offC;
    const onC  = s.querySelector('#on_color').value;
    if (onC  && onC  !== ShoppingListCard.DEFAULT_ON_COLOR)  cfg.on_color  = onC;

    this.dispatchEvent(new CustomEvent('config-changed', {
      detail: { config: cfg }, bubbles: true, composed: true
    }));
  }
}
customElements.define('shopping-list-card-editor', ShoppingListCardEditor);


// ── Card ─────────────────────────────────────────────────────────────────────

class ShoppingListCard extends HTMLElement {
  static DEFAULT_ON_ICON   = 'mdi:check';
  static DEFAULT_OFF_ICON  = 'mdi:plus';
  static DEFAULT_ON_COLOR  = 'green';
  static DEFAULT_OFF_COLOR = 'grey';

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
  static getStubConfig()   { return { type: 'custom:shopping-list-card', title: 'New Item', todo_list: '' }; }

  _escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  _getColorValue(val) {
    if (!val) return null;
    if (val.startsWith('#')) return val;
    return ShoppingListCard.COLOR_MAP[val] || val;
  }

  _hexToRgb(hex) {
    const m = hex.replace('#','').match(/^(..)(..)(..)$/);
    return m && { r: parseInt(m[1],16), g: parseInt(m[2],16), b: parseInt(m[3],16) };
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
      const res = await this._hass.callWS({ type: 'todo/item/list', entity_id: this._config.todo_list });
      summaries = res.items.map(i => i.summary);
    } catch (e) {
      console.error('Error fetching items', e);
      this.content.innerHTML = `<div class="warning">Error fetching items.</div>`;
      return;
    }

    const rx = new RegExp(`^${this._escapeRegExp(fullName)}(?: \\(\\d+\\))?$`, 'i');
    let isOn = false, qty = 0, matched = null;
    for (const s of summaries) {
      const m = s.match(rx);
      if (m) { isOn = true; matched = s; qty = m[1] ? +m[1] : 1; break; }
    }

    const onIcon   = this._config.on_icon  || ShoppingListCard.DEFAULT_ON_ICON;
    const offIcon  = this._config.off_icon || ShoppingListCard.DEFAULT_OFF_ICON;
    const onColorN = this._config.on_color  || ShoppingListCard.DEFAULT_ON_COLOR;
    const offColorN= this._config.off_color || ShoppingListCard.DEFAULT_OFF_COLOR;
    const onHex    = this._getColorValue(onColorN)  || '#4CAF50';
    const offHex   = this._getColorValue(offColorN) || '#808080';

    const icon    = isOn ? onIcon : offIcon;
    const bg      = isOn ? this._toRgba(onHex, 0.2) : this._toRgba(offHex, 0.2);
    const fg      = isOn ? onHex : offHex;

    let qtyControls = '';
    if (isOn && this._config.enable_quantity) {
      if (qty > 1) {
        qtyControls = `
          <div class="quantity-controls">
            <div class="quantity-btn" data-action="decrement"><ha-icon icon="mdi:minus"></ha-icon></div>
            <span class="quantity">${qty}</span>
            <div class="quantity-btn" data-action="increment"><ha-icon icon="mdi:plus"></ha-icon></div>
          </div>
        `;
      } else {
        qtyControls = `
          <div class="quantity-controls">
            <span class="quantity">${qty}</span>
            <div class="quantity-btn" data-action="increment"><ha-icon icon="mdi:plus"></ha-icon></div>
          </div>
        `;
      }
    }

    this.content.innerHTML = `
      <div class="card-container ${isOn?'is-on':'is-off'}">
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
        await this._render();
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
      .card-container:hover { background: var(...
```}
