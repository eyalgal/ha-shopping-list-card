/*
 * Shopping List Card
 *
 * A Home Assistant Lovelace card to manage items on a to-do list with a
 * clean, modern interface and a visual editor.
 *
 * Author: eyalgal
 * License: MIT License
 *
 */

class ShoppingListCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._rendered = false;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._rendered) {
      this._render();
    }
  }

  setConfig(config) {
    this._config = config;
    if (this._rendered) {
      this._updateFormValues();
    }
  }
  
  _render() {
    if (!this.shadowRoot || !this._hass) return;
    
    this.shadowRoot.innerHTML = `
      <style>
        .form { display: flex; flex-direction: column; gap: 16px; }
        .grid-container { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: end; }
        .switch-row { display: flex; align-items: center; justify-content: space-between; }
        .switch-row span { font-weight: 500; font-size: 14px; }
        ha-textfield, ha-entity-picker, ha-icon-picker { display: block; }
        .color-input-container { display: flex; flex-direction: column; }
        .color-input-container label { font-size: 12px; color: var(--secondary-text-color); margin-bottom: 8px;}
      </style>
      <div class="form">
        <ha-textfield id="title" label="Title (Required)" required></ha-textfield>
        <ha-textfield id="subtitle" label="Subtitle (Optional)"></ha-textfield>
        <ha-entity-picker id="todo_list" label="To-do List Entity (Required)" required></ha-entity-picker>
        <div class="grid-container">
          <ha-icon-picker id="off_icon" label="Off-list Icon"></ha-icon-picker>
          <div class="form-row color-input-container">
            <label for="off_color">Off-list Color</label>
            <ha-textfield id="off_color" label="Off-list Color (hex, rgb, or CSS name)" placeholder="#808080 or grey"></ha-textfield>
          </div>
          <ha-icon-picker id="on_icon" label="On-list Icon"></ha-icon-picker>
          <div class="form-row color-input-container">
            <label for="on_color">On-list Color</label>
            <ha-textfield id="on_color" label="On-list Color (hex, rgb, or CSS name)" placeholder="#4CAF50 or green"></ha-textfield>
          </div>
        </div>
        <div class="switch-row">
          <span>Enable Quantity Controls</span>
          <ha-switch id="enable_quantity"></ha-switch>
        </div>
      </div>
    `;
    this._rendered = true;
    
    // give hass to pickers
    const entityPicker = this.shadowRoot.querySelector('#todo_list');
    entityPicker.hass = this._hass;
    entityPicker.includeDomains = ['todo'];
    entityPicker.allowCustomEntity = false;

    const offIconPicker = this.shadowRoot.querySelector('#off_icon');
    offIconPicker.hass = this._hass;
    const onIconPicker = this.shadowRoot.querySelector('#on_icon');
    onIconPicker.hass = this._hass;

    this.shadowRoot.querySelector('.form').addEventListener('input', () => this._handleConfigChanged());
    
    if (this._config) {
      this._updateFormValues();
    }
  }
  
  _updateFormValues() {
    this.shadowRoot.querySelector('#title').value = this._config.title || '';
    this.shadowRoot.querySelector('#subtitle').value = this._config.subtitle || '';
    this.shadowRoot.querySelector('#todo_list').value = this._config.todo_list || '';
    this.shadowRoot.querySelector('#on_icon').value = this._config.on_icon || 'mdi:check';
    this.shadowRoot.querySelector('#off_icon').value = this._config.off_icon || 'mdi:plus';
    this.shadowRoot.querySelector('#on_color').value = this._config.on_color || '';
    this.shadowRoot.querySelector('#off_color').value = this._config.off_color || '';
    this.shadowRoot.querySelector('#enable_quantity').checked = this._config.enable_quantity || false;
  }

  _handleConfigChanged() {
    const newConfig = {
      type: 'custom:shopping-list-card',
      title: this.shadowRoot.querySelector('#title').value,
      todo_list: this.shadowRoot.querySelector('#todo_list').value,
    };
    
    const subtitle = this.shadowRoot.querySelector('#subtitle').value;
    if (subtitle) newConfig.subtitle = subtitle;

    const onIcon = this.shadowRoot.querySelector('#on_icon').value;
    if (onIcon && onIcon !== 'mdi:check') newConfig.on_icon = onIcon;

    const offIcon = this.shadowRoot.querySelector('#off_icon').value;
    if (offIcon && offIcon !== 'mdi:plus') newConfig.off_icon = offIcon;
    
    const onColor = this.shadowRoot.querySelector('#on_color').value.trim();
    if (onColor) newConfig.on_color = onColor;

    const offColor = this.shadowRoot.querySelector('#off_color').value.trim();
    if (offColor) newConfig.off_color = offColor;

    const enableQuantity = this.shadowRoot.querySelector('#enable_quantity').checked;
    if (enableQuantity) newConfig.enable_quantity = true;
    
    this.dispatchEvent(new CustomEvent('config-changed', {
      bubbles: true,
      composed: true,
      detail: { config: newConfig },
    }));
  }
}

class ShoppingListCard extends HTMLElement {
  constructor() {
    super();
    this._isUpdating = false;
    this._lastUpdated = null;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;

    const newState = hass.states[this._config.todo_list];
    if (newState && newState.last_updated !== this._lastUpdated) {
      this._lastUpdated = newState.last_updated;
      if (!this.content) {
        this.innerHTML = `<ha-card><div class="card-content"></div></ha-card>`;
        this.content = this.querySelector("div.card-content");
        this._attachStyles();
      }
      this._render();
    }
  }

  setConfig(config) {
    if (!config.title)      throw new Error("You must define a title.");
    if (!config.todo_list)  throw new Error("You must define a todo_list entity_id.");
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

    const fullItemName = this._config.subtitle
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

    const rx = new RegExp(`^${this._escapeRegExp(fullItemName)}(?: \((\\d+)\))?$`, 'i');
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

    const onIcon = this._config.on_icon || 'mdi:check';
    const offIcon = this._config.off_icon || 'mdi:plus';
    
    // free-form CSS colors
    const onColor = this._config.on_color || 'green';
    const offColor = this._config.off_color || 'grey';

    const icon = isOn ? onIcon : offIcon;
    const color = isOn ? onColor : offColor;
    const bgColor = `${color}33`;
    
    let qtyControls = '';
    if (isOn && this._config.enable_quantity) {
      const decBtn = qty > 1
        ? `<div class="quantity-btn" data-action="decrement"><ha-icon icon="mdi:minus"></ha-icon></div>`
        : ``;
      qtyControls = `
        <div class="quantity-controls">
          ${decBtn}
          <span class="quantity">${qty}</span>
          <div class="quantity-btn" data-action="increment"><ha-icon icon="mdi:plus"></ha-icon></div>
        </div>
      `;
    }

    this.content.innerHTML = `
      <div class="card-container">
        <div class="icon-wrapper" style="color: ${color}; background-color: ${bgColor};">
            <ha-icon icon="${icon}"></ha-icon>
        </div>
        <div class="info-container">
          <div class="primary">${this._config.title}</div>
          ${this._config.subtitle ? `<div class="secondary">${this._config.subtitle}</div>` : ''}
        </div>
        ${qtyControls}
      </div>
    `;

    this.content.querySelector('.card-container')
      .onclick = ev => this._handleTap(ev, isOn, matched, qty, fullItemName);
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
        this._render();
      } catch (e) {
        console.error("Shopping List Card: Service call failed", e);
      } finally {
        this._isUpdating = false;
        const container = this.content.querySelector('.card-container');
        if (container) container.classList.remove('is-updating');
      }
    } else {
      this._isUpdating = false;
      const container = this.content.querySelector('.card-container');
      if (container) container.classList.remove('is-updating');
    }
  }

  _addItem(name) {
    return this._hass.callService("todo", "add_item", {
      entity_id: this._config.todo_list,
      item: name,
    });
  }

  _removeItem(item) {
    if (!item) return Promise.resolve();
    return this._hass.callService("todo", "remove_item", {
