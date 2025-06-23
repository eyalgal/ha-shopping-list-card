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

// Shared color map for the card and editor
const colorMap = {
    'red': { name: 'Red', hex: '#F44336' },
    'pink': { name: 'Pink', hex: '#E91E63' },
    'purple': { name: 'Purple', hex: '#9C27B0' },
    'deep-purple': { name: 'Deep Purple', hex: '#673AB7' },
    'indigo': { name: 'Indigo', hex: '#3F51B5' },
    'blue': { name: 'Blue', hex: '#2196F3' },
    'light-blue': { name: 'Light Blue', hex: '#03A9F4' },
    'cyan': { name: 'Cyan', hex: '#00BCD4' },
    'teal': { name: 'Teal', hex: '#009688' },
    'green': { name: 'Green', hex: '#4CAF50' },
    'light-green': { name: 'Light Green', hex: '#8BC34A' },
    'lime': { name: 'Lime', hex: '#CDDC39' },
    'yellow': { name: 'Yellow', hex: '#FFEB3B' },
    'amber': { name: 'Amber', hex: '#FFC107' },
    'orange': { name: 'Orange', hex: '#FF9800' },
    'deep-orange': { name: 'Deep Orange', hex: '#FF5722' },
    'brown': { name: 'Brown', hex: '#795548' },
    'grey': { name: 'Grey', hex: '#9E9E9E' },
    'blue-grey': { name: 'Blue Grey', hex: '#607D8B' },
    'disabled': { name: 'Disabled', hex: '#808080' } // Default grey for off-state
};


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
        .form-row { margin-bottom: 16px; }
        .grid-container { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .switch-row { display: flex; align-items: center; justify-content: space-between; margin-top: 24px; }
        .switch-row span { font-weight: 500; font-size: 14px; }
        ha-textfield, ha-entity-picker, ha-icon-picker { display: block; }

        /* Custom Dropdown Styles */
        .color-picker-wrapper { position: relative; }
        .color-picker-label { font-size: 12px; color: var(--secondary-text-color); margin-bottom: 4px; }
        .color-picker-selected { display: flex; align-items: center; padding: 8px; border: 1px solid var(--divider-color); border-radius: 4px; cursor: pointer; }
        .color-swatch { width: 20px; height: 20px; border-radius: 50%; margin-right: 8px; }
        .color-dropdown { display: none; position: absolute; background: var(--card-background-color); border: 1px solid var(--divider-color); border-radius: 4px; max-height: 200px; overflow-y: auto; z-index: 10; width: 100%; box-shadow: 0 2px 4px rgba(0,0,0,0.2); }
        .color-dropdown.open { display: block; }
        .color-option { display: flex; align-items: center; padding: 8px; cursor: pointer; }
        .color-option:hover { background-color: var(--secondary-background-color); }
      </style>
      <div class="form-row">
        <ha-textfield id="title" label="Title (Required)" required></ha-textfield>
      </div>
      <div class="form-row">
        <ha-textfield id="subtitle" label="Subtitle (Optional)"></ha-textfield>
      </div>
      <div class="form-row">
        <ha-entity-picker id="todo_list" label="To-do List Entity (Required)" required></ha-entity-picker>
      </div>
      <div class="grid-container">
          <div class="form-row">
            <ha-icon-picker id="on_icon" label="On-list Icon"></ha-icon-picker>
          </div>
          <div class="form-row">
            <ha-icon-picker id="off_icon" label="Off-list Icon"></ha-icon-picker>
          </div>
          <div class="form-row color-picker-wrapper">
              <div class="color-picker-label">On-list Color</div>
              <div class="color-picker-selected" data-target="on_color_dropdown">
                  <div class="color-swatch" id="on_color_swatch"></div>
                  <span id="on_color_name"></span>
              </div>
              <div class="color-dropdown" id="on_color_dropdown"></div>
          </div>
          <div class="form-row color-picker-wrapper">
              <div class="color-picker-label">Off-list Color</div>
              <div class="color-picker-selected" data-target="off_color_dropdown">
                  <div class="color-swatch" id="off_color_swatch"></div>
                  <span id="off_color_name"></span>
              </div>
              <div class="color-dropdown" id="off_color_dropdown"></div>
          </div>
      </div>
      <div class="switch-row">
        <span>Enable Quantity Controls</span>
        <ha-switch id="enable_quantity"></ha-switch>
      </div>
    `;
    this._rendered = true;
    
    this._populateColorDropdowns();

    const entityPicker = this.shadowRoot.querySelector('#todo_list');
    entityPicker.hass = this._hass;
    entityPicker.includeDomains = ['todo'];
    entityPicker.allowCustomEntity = false;

    this.shadowRoot.querySelectorAll('ha-textfield, ha-icon-picker, ha-switch, ha-entity-picker').forEach(el => {
        el.addEventListener('value-changed', () => this._handleConfigChanged());
        el.addEventListener('change', () => this._handleConfigChanged());
        el.addEventListener('input', () => this._handleConfigChanged());
    });
    
    if (this._config) {
      this._updateFormValues();
    }
  }
  
  _populateColorDropdowns() {
    const onDropdown = this.shadowRoot.querySelector('#on_color_dropdown');
    const offDropdown = this.shadowRoot.querySelector('#off_color_dropdown');

    for (const [key, value] of Object.entries(colorMap)) {
        const createOption = (k, v) => {
            const option = document.createElement('div');
            option.className = 'color-option';
            option.dataset.value = k;
            option.innerHTML = `<div class="color-swatch" style="background-color: ${v.hex};"></div><span>${v.name}</span>`;
            option.addEventListener('click', (e) => {
                e.stopPropagation();
                const dropdown = e.currentTarget.parentElement;
                const wrapper = dropdown.parentElement;
                wrapper.querySelector('.color-picker-selected .color-swatch').style.backgroundColor = v.hex;
                wrapper.querySelector('.color-picker-selected span').textContent = v.name;
                dropdown.classList.remove('open');
                this._handleConfigChanged();
            });
            return option;
        };
        onDropdown.appendChild(createOption(key, value));
        offDropdown.appendChild(createOption(key, value));
    }
    
    this.shadowRoot.querySelectorAll('.color-picker-selected').forEach(el => {
        el.addEventListener('click', (e) => {
            const targetId = e.currentTarget.dataset.target;
            this.shadowRoot.getElementById(targetId).classList.toggle('open');
        });
    });
  }

  _updateFormValues() {
    this.shadowRoot.querySelector('#title').value = this._config.title || '';
    this.shadowRoot.querySelector('#subtitle').value = this._config.subtitle || '';
    this.shadowRoot.querySelector('#todo_list').value = this._config.todo_list || '';
    this.shadowRoot.querySelector('#on_icon').value = this._config.on_icon || 'mdi:check';
    this.shadowRoot.querySelector('#off_icon').value = this._config.off_icon || 'mdi:plus';
    this.shadowRoot.querySelector('#enable_quantity').checked = this._config.enable_quantity || false;

    const onColorKey = this._config.on_color || 'green';
    const offColorKey = this._config.off_color || 'disabled';
    
    this.shadowRoot.querySelector('#on_color_swatch').style.backgroundColor = colorMap[onColorKey].hex;
    this.shadowRoot.querySelector('#on_color_name').textContent = colorMap[onColorKey].name;
    this.shadowRoot.querySelector('#off_color_swatch').style.backgroundColor = colorMap[offColorKey].hex;
    this.shadowRoot.querySelector('#off_color_name').textContent = colorMap[offColorKey].name;
  }

  _handleConfigChanged() {
    // Find the selected color name from the dropdown. This is a bit more involved now.
    const getSelectedColor = (dropdownId) => {
      const selectedSwatch = this.shadowRoot.querySelector(`#${dropdownId}_swatch`).style.backgroundColor;
      for (const [key, value] of Object.entries(colorMap)) {
          // Note: Browser might convert hex to rgb() so we can't do a direct string compare.
          // A safer, though more complex, approach would be needed for perfect matching.
          // For now, we find based on the name displayed.
          if(this.shadowRoot.querySelector(`#${dropdownId}_name`).textContent === value.name) {
              return key;
          }
      }
      return dropdownId === 'on_color' ? 'green' : 'disabled';
    };
    
    const newConfig = {
      type: 'custom:shopping-list-card',
      title: this.shadowRoot.querySelector('#title').value,
      subtitle: this.shadowRoot.querySelector('#subtitle').value,
      todo_list: this.shadowRoot.querySelector('#todo_list').value,
      on_icon: this.shadowRoot.querySelector('#on_icon').value,
      off_icon: this.shadowRoot.querySelector('#off_icon').value,
      on_color: getSelectedColor('on_color'),
      off_color: getSelectedColor('off_color'),
      enable_quantity: this.shadowRoot.querySelector('#enable_quantity').checked,
    };
    
    const event = new CustomEvent('config-changed', {
      bubbles: true,
      composed: true,
      detail: { config: newConfig },
    });
    this.dispatchEvent(event);
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

    const rx = new RegExp(`^${this._escapeRegExp(fullItemName)}(?: \\((\\d+)\\))?$`, 'i');
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
    
    // Get hex color from map, with defaults
    const onColorHex = colorMap[this._config.on_color]?.hex || '#4CAF50';
    const offColorHex = colorMap[this._config.off_color]?.hex || '#808080';

    const icon = isOn ? onIcon : offIcon;
    const color = isOn ? onColorHex : offColorHex;
    const stateClass = isOn ? "is-on" : "is-off";
    
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
      <div class="card-container ${stateClass}">
        <div class="icon-wrapper" style="color: ${color};">
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
        if (container) {
          container.classList.remove('is-updating');
        }
      }
    } else {
      this._isUpdating = false;
      const container = this.content.querySelector('.card-container');
      if (container) {
          container.classList.remove('is-updating');
      }
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
      entity_id: this._config.todo_list,
      item,
    });
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
      ha-card {
        border-radius: var(--ha-card-border-radius, 12px);
        background:     var(--card-background-color);
        box-shadow:     var(--ha-card-box-shadow);
        overflow:       hidden;
      }
      .card-content { padding: 0 !important; }

      .card-container {
        display:        flex;
        align-items:    center;
        padding:        10px;
        gap:            10px;
        cursor:         pointer;
        transition:     background-color 0.2s;
      }
      .card-container:hover {
        background-color: var(--secondary-background-color);
      }
      .card-container.is-updating {
        opacity:         0.5;
        pointer-events:  none;
      }
      
      .icon-wrapper {
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        flex-shrink: 0;
      }
      .icon-wrapper::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: currentColor;
        opacity: 0.2;
        border-radius: 50%;
      }
      .icon-wrapper ha-icon {
        --mdc-icon-size: 22px;
        position: relative;
      }
      
      .info-container { 
        flex-grow: 1; 
        overflow: hidden; 
        min-width: 0;
      }
      .primary, .secondary {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .primary {
        font-family:    var(--primary-font-family);
        font-size:      14px;
        font-weight:    500;
        line-height:    20px;
        color:          var(--primary-text-color);
      }
      .secondary {
        font-family:    var(--secondary-font-family);
        font-size:      12px;
        font-weight:    400;
        line-height:    16px;
        color:          var(--secondary-text-color);
      }

      .quantity-controls {
        display:        flex;
        align-items:    center;
        gap:            4px;
        flex-shrink: 0;
      }
      .quantity {
        font-size:      14px;
        font-weight:    500;
        min-width:      1.2em;
        text-align:     center;
      }
      .quantity-btn {
        width: 24px;
        height: 24px;
        background-color: rgba(128, 128, 128, 0.2);
        border-radius: 5px;
        color: var(--secondary-text-color);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .quantity-btn ha-icon {
        --mdc-icon-size: 20px;
      }

      .warning {
        padding:        12px;
        background:     var(--error-color);
        color:          var(--text-primary-color);
        border-radius:  var(--ha-card-border-radius, 12px);
      }
    `;
    this.appendChild(style);
  }

  getCardSize() {
    return 1;
  }
}

// Register both custom elements
customElements.define("shopping-list-card", ShoppingListCard);
customElements.define('shopping-list-card-editor', ShoppingListCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "shopping-list-card",
  name: "Shopping List Card",
  preview: true,
  description: "A card to manage items on a shopping list."
});
