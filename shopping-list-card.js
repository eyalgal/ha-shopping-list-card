/**
 * Shopping List Card
 *
 * A Home Assistant Lovelace card to manage items on a to-do list with a
 * clean, modern interface and a visual editor.
 *
 * Author: eyalgal (extended)
 * License: MIT
 */

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
        .form-row { margin-bottom: 16px; }
        .switch-row { display: flex; align-items: center; justify-content: space-between; margin-top: 24px; }
        .switch-row span { font-weight: 500; font-size: 14px; }
        ha-textfield, ha-entity-picker, ha-icon-picker { display: block; margin-bottom: 8px; }
      </style>

      <!-- Required fields -->
      <div class="form-row">
        <ha-textfield id="title" label="Title (Required)" required></ha-textfield>
      </div>
      <div class="form-row">
        <ha-entity-picker
          id="todo_list"
          label="To-do List Entity (Required)"
          required>
        </ha-entity-picker>
      </div>

      <!-- Optional fields -->
      <div class="form-row">
        <ha-textfield id="subtitle" label="Subtitle (Optional)"></ha-textfield>
      </div>
      <div class="switch-row">
        <span>Enable Quantity Controls</span>
        <ha-switch id="enable_quantity"></ha-switch>
      </div>

      <!-- Custom icon selectors -->
      <div class="form-row">
        <ha-icon-picker id="on_icon" label="On Icon (default: mdi:check)"></ha-icon-picker>
      </div>
      <div class="form-row">
        <ha-icon-picker id="off_icon" label="Off Icon (default: mdi:plus)"></ha-icon-picker>
      </div>

      <!-- Custom color inputs -->
      <div class="form-row">
        <ha-textfield id="on_color" label="On Color (name or #hex)"></ha-textfield>
      </div>
      <div class="form-row">
        <ha-textfield id="off_color" label="Off Color (name or #hex)"></ha-textfield>
      </div>
    `;

    // wire up entity picker
    const ep = this.shadowRoot.querySelector('#todo_list');
    ep.hass = this._hass;
    ep.includeDomains = ['todo'];
    ep.allowCustomEntity = false;

    // listeners
    this.shadowRoot.querySelector('#title')
      .addEventListener('input', () => this._handleConfigChanged());
    this.shadowRoot.querySelector('#subtitle')
      .addEventListener('input', () => this._handleConfigChanged());
    this.shadowRoot.querySelector('#enable_quantity')
      .addEventListener('change', () => this._handleConfigChanged());
    ep.addEventListener('value-changed', () => this._handleConfigChanged());
    ['on_color','off_color'].forEach(id => {
      this.shadowRoot.querySelector('#'+id)
        .addEventListener('input', () => this._handleConfigChanged());
    });
    ['on_icon','off_icon'].forEach(id => {
      this.shadowRoot.querySelector('#'+id)
        .addEventListener('value-changed', () => this._handleConfigChanged());
    });

    this._rendered = true;
    if (this._config) this._updateFormValues();
  }

  _updateFormValues() {
    const s = this.shadowRoot;
    s.querySelector('#title').value          = this._config.title        || '';
    s.querySelector('#todo_list').value      = this._config.todo_list    || '';
    s.querySelector('#subtitle').value       = this._config.subtitle     || '';
    s.querySelector('#enable_quantity').checked = this._config.enable_quantity || false;
    s.querySelector('#on_icon').value        = this._config.on_icon      || '';
    s.querySelector('#off_icon').value       = this._config.off_icon     || '';
    s.querySelector('#on_color').value       = this._config.on_color     || '';
    s.querySelector('#off_color').value      = this._config.off_color    || '';
  }

  _handleConfigChanged() {
    const s = this.shadowRoot;
    const cfg = {
      type: 'custom:shopping-list-card',
      title: s.querySelector('#title').value,
      todo_list: s.querySelector('#todo_list').value,
    };

    // only include subtitle if non-empty
    if (s.querySelector('#subtitle').value)       cfg.subtitle        = s.querySelector('#subtitle').value;
    // only include quantity flag if true
    if (s.querySelector('#enable_quantity').checked) cfg.enable_quantity = true;

    // only include icons if non-default
    const onI  = s.querySelector('#on_icon').value;
    if (onI && onI !== ShoppingListCard.DEFAULT_ON_ICON)  cfg.on_icon  = onI;
    const offI = s.querySelector('#off_icon').value;
    if (offI && offI !== ShoppingListCard.DEFAULT_OFF_ICON) cfg.off_icon = offI;

    // include colors if specified
    const onC  = s.querySelector('#on_color').value.trim();
    if (onC) cfg.on_color  = onC;
    const offC = s.querySelector('#off_color').value.trim();
    if (offC) cfg.off_color = offC;

    this.dispatchEvent(new CustomEvent('config-changed', {
      detail: { config: cfg },
      bubbles: true, composed: true,
    }));
  }
}

class ShoppingListCard extends HTMLElement {
  static COLOR_MAP = {
    red: '#F44336', pink: '#E91E63', purple: '#9C27B0',
    'deep-purple': '#673AB7', indigo: '#3F51B5',
    blue: '#2196F3', 'light-blue': '#03A9F4',
    cyan: '#00BCD4', teal: '#009688', green: '#4CAF50',
    lime: '#CDDC39', yellow: '#FFEB3B', amber: '#FFC107',
    orange: '#FF9800', brown: '#795548', grey: '#9E9E9E',
    'blue-grey': '#607D8B',
  };
  static DEFAULT_ON_ICON  = 'mdi:check';
  static DEFAULT_OFF_ICON = 'mdi:plus';

  constructor() {
    super();
    this._isUpdating = false;
    this._lastUpdated = null;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    const newState = hass.states[this._config.todo_list];
    if (!newState || newState.last_updated === this._lastUpdated) return;
    this._lastUpdated = newState.last_updated;

    if (!this.content) {
      this.innerHTML = `<ha-card><div class="card-content"></div></ha-card>`;
      this.content = this.querySelector("div.card-content");
      this._attachStyles();
    }
    this._render();
  }

  setConfig(config) {
    if (!config.title)     throw new Error("You must define a title.");
    if (!config.todo_list) throw new Error("You must define a todo_list entity_id.");
    this._config = config;
  }

  static getConfigElement() {
    return document.createElement('shopping-list-card-editor');
  }

  static getStubConfig() {
    return {
      type: 'custom:shopping-list-card',
      title: 'New Item',
      todo_list: ''
    };
  }

  _escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  _getColorValue(val) {
    if (!val) return null;
    if (val.startsWith('#')) return val;
    return ShoppingListCard.COLOR_MAP[val] || val;
  }

  _hexToRgb(hex) {
    const m = hex.replace('#','').match(/^(.{2})(.{2})(.{2})$/);
    return m && { r: parseInt(m[1],16), g: parseInt(m[2],16), b: parseInt(m[3],16) };
  }

  _toRgba(hex, alpha) {
    const c = this._hexToRgb(hex);
    return c
      ? `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`
      : hex;
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
      const result = await this._hass.callWS({
        type: 'todo/item/list',
        entity_id: this._config.todo_list,
      });
      summaries = result.items.map(i => i.summary);
    } catch (e) {
      console.error('Shopping List Card: Error fetching to-do items.', e);
      this.content.innerHTML = `<div class="warning">Error fetching items.</div>`;
      return;
    }

    const rx = new RegExp(`^${this._escapeRegExp(fullName)}(?: \\((\\d+)\\))?$`, 'i');
    let isOn = false, qty = 0, matched = null;
    for (const s of summaries) {
      const m = s.match(rx);
      if (m) {
        isOn = true;
        matched = s;
        qty = m[1] ? parseInt(m[1], 10) : 1;
        break;
      }
    }

    // icons & colors
    const onIcon  = this._config.on_icon  || ShoppingListCard.DEFAULT_ON_ICON;
    const offIcon = this._config.off_icon || ShoppingListCard.DEFAULT_OFF_ICON;
    const onColorHex  = this._getColorValue(this._config.on_color)  || '#4CAF50';
    const offColorHex = this._getColorValue(this._config.off_color) || '#808080';

    const icon    = isOn ? onIcon  : offIcon;
    const styleBg = isOn
      ? this._toRgba(onColorHex, 0.2)
      : this._toRgba(offColorHex, 0.2);
    const styleFg = isOn ? onColorHex : offColorHex;

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
        <div class="icon-wrapper" style="background-color: ${styleBg}; color: ${styleFg};">
          <ha-icon icon="${icon}"></ha-icon>
        </div>
        <div class="info-container">
          <div class="primary">${this._config.title}</div>
          ${this._config.subtitle
            ? `<div class="secondary">${this._config.subtitle}</div>`
            : ''}
        </div>
        ${qtyControls}
      </div>
    `;

    this.content.querySelector('.card-container')
      .onclick = ev => this._handleTap(ev, isOn, matched, qty, fullName);
  }

  async _handleTap(ev, isOn, matched, qty, fullItemName) {
    if (this._isUpdating) return;
    ev.stopPropagation();
    const action = ev.target.closest('.quantity-btn')?.dataset.action;

    this._isUpdating = true;
    this.content.querySelector('.card-container').classList.add('is-updating');

    let call;
    if (action === 'increment') {
      call = this._updateQuantity(matched, qty + 1, fullItemName);
    } else if (action === 'decrement') {
      if (qty > 1) call = this._updateQuantity(matched, qty - 1, fullItemName);
    } else {
      if (isOn) {
        if (!this._config.enable_quantity || qty === 1) {
          call = this._removeItem(matched);
        }
      } else {
        call = this._addItem(fullItemName);
      }
    }

    if (call) {
      try {
        await call;
        this._lastUpdated = null;
        await this._render();
      } catch (e) {
        console.error("Shopping List Card: Service call failed", e);
      }
    }

    this._isUpdating = false;
    const container = this.content.querySelector('.card-container');
    if (container) container.classList.remove('is-updating');
  }

  _addItem(name) {
    return this._hass.callService("todo", "add_item", {
      entity_id: this._config.todo_list,
      item: name,
    });
  }

  _removeItem(item) {
    return item
      ? this._hass.callService("todo", "remove_item", {
          entity_id: this._config.todo_list,
          item,
        })
      : Promise.resolve();
  }

  _updateQuantity(oldItem, newQty, fullName) {
    const newName = newQty > 1 ? `${fullName} (${newQty})` : fullName;
    return this._hass.callService("todo", "update_item", {
      entity_id: this._config.todo_list,
      item: oldItem,
      rename: newName,
    });
  }

  _attachStyles() {
    if (this.querySelector("style")) return;
    const style = document.createElement('style');
    style.textContent = `
      ha-card { border-radius: var(--ha-card-border-radius,12px); background: var(--card-background-color); box-shadow: var(--ha-card-box-shadow); overflow:hidden; }
      .card-content { padding:0 !important; }
      .card-container { display:flex; align-items:center; padding:10px; gap:10px; cursor:pointer; transition:background-color .2s; }
      .card-container:hover { background: var(--secondary-background-color); }
      .icon-wrapper { display:flex; align-items:center; justify-content:center; width:36px; height:36px; border-radius:50%; flex-shrink:0; }
      .info-container { flex-grow:1; overflow:hidden; min-width:0; }
      .primary { font-size:14px; font-weight:500; line-height:20px; color:var(--primary-text-color); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .secondary { font-size:12px; font-weight:400; line-height:16px; color:var(--secondary-text-color); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .quantity-controls { display:flex; align-items:center; gap:4px; flex-shrink:0; }
      .quantity { font-size:14px; font-weight:500; min-width:20px; text-align:center; }
      .quantity-btn { width:24px; height:24px; background:rgba(128,128,128,0.2); border-radius:5px; display:flex; align-items:center; justify-content:center; }
      .warning { padding:12px; background:var(--error-color); color:var(--text-primary-color); border-radius:var(--ha-card-border-radius,12px); }
    `;
    this.appendChild(style);
  }

  getCardSize() {
    return 1;
  }
}

// Register custom elements
customElements.define('shopping-list-card-editor', ShoppingListCardEditor);
customElements.define('shopping-list-card', ShoppingListCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "shopping-list-card",
  name: "Shopping List Card",
  preview: true,
  description: "A card to manage items on a shopping list."
});
