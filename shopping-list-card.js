/*
 * Shopping List Card
 *
 * A Home Assistant Lovelace card to manage items on a
 * shopping list with a clean, modern interface and a visual editor.
 *
 * Author: eyalgal
 * License: MIT License
 */

import '/frontend/src/components/ha-entity-picker.js';
import '/frontend/src/components/ha-textfield.js';
import '/frontend/src/components/ha-switch.js';

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
        .switch-row { display: flex; align-items: center; justify-content: space-between; margin-top: 24px; }
        .switch-row span { font-weight: 500; font-size: 14px; }
        ha-textfield, ha-entity-picker { display: block; width: 100%; }
        ha-switch { margin-left: 8px; }
      </style>
      <div class="form-row">
        <ha-textfield
          id="title"
          label="Title (Required)"
          required
        ></ha-textfield>
      </div>
      <div class="form-row">
        <ha-textfield
          id="subtitle"
          label="Subtitle (Optional)"
        ></ha-textfield>
      </div>
      <div class="form-row">
        <ha-entity-picker
          id="todo_list"
          label="To-do List Entity (Required)"
          required
        ></ha-entity-picker>
      </div>
      <div class="switch-row">
        <span>Enable Quantity Controls</span>
        <ha-switch id="enable_quantity"></ha-switch>
      </div>
    `;
    this._rendered = true;
    
    // Configure entity-picker for the Shopping List integration
    const entityPicker = this.shadowRoot.querySelector('#todo_list');
    entityPicker.hass = this._hass;
    entityPicker.includeDomains = ['shopping_list'];
    entityPicker.allowCustomEntity = true;

    // Add event listeners
    this.shadowRoot.querySelector('#title').addEventListener('input', () => this._handleConfigChanged());
    this.shadowRoot.querySelector('#subtitle').addEventListener('input', () => this._handleConfigChanged());
    entityPicker.addEventListener('value-changed', () => this._handleConfigChanged());
    this.shadowRoot.querySelector('#enable_quantity').addEventListener('change', () => this._handleConfigChanged());
    
    if (this._config) {
      this._updateFormValues();
    }
  }
  
  _updateFormValues() {
    this.shadowRoot.querySelector('#title').value = this._config.title || '';
    this.shadowRoot.querySelector('#subtitle').value = this._config.subtitle || '';
    this.shadowRoot.querySelector('#todo_list').value = this._config.todo_list || '';
    this.shadowRoot.querySelector('#enable_quantity').checked = this._config.enable_quantity || false;
  }

  _handleConfigChanged() {
    const newConfig = {
      type: 'custom:shopping-list-card',
      title: this.shadowRoot.querySelector('#title').value,
      subtitle: this.shadowRoot.querySelector('#subtitle').value,
      todo_list: this.shadowRoot.querySelector('#todo_list').value,
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
  
  static async getConfigElement() {
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

    const icon = isOn ? 'mdi:check' : 'mdi:plus';
    const stateClass = isOn ? "is-on" : "is-off";
    
    let qtyControls = '';
    if (isOn && this._config.enable_quantity) {
      const decBtn = qty > 1
        ? `<div class="quantity-btn" data-action="decrement"><ha-icon icon="mdi:minus"></ha-icon></div>`
        : `<div class="quantity-btn-placeholder"></div>`;
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
        <div class="icon-wrapper">
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

    this._isUpdating = false;
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
    return this._hass.callService("shopping_list", "add_item", {
      entity_id: this._config.todo_list,
      item: name,
    });
  }

  _removeItem(item) {
    if (!item) return Promise.resolve();
    return this._hass.callService("shopping_list", "remove_item", {
      entity_id: this._config.todo_list,
      item,
    });
  }

  _updateQuantity(oldItem, newQty, fullName) {
    const newName = newQty > 1 ? `${fullName} (${newQty})` : fullName;
    return this._hass.callService("shopping_list", "update_item", {
      entity_id: this._config.todo_list,
      item: oldItem,
      rename: newName,
    });
  }

  _attachStyles() {
    if (this.querySelector("style")) return;
    const style = document.createElement('{"{code cut due to length}
