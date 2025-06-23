// A custom card for Home Assistant's Lovelace UI to manage a shopping list.
// Version 25: Fixed icon colors with custom implementation and proper fonts

console.log("Shopping List Card: File loaded. Version 25.");

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
    let qtyControls = '';
    if (isOn && this._config.enable_quantity) {
      const decBtn = qty > 1
        ? `<ha-icon-button class="quantity-btn" data-action="decrement"><ha-icon icon="mdi:minus"></ha-icon></ha-icon-button>`
        : `<div class="quantity-btn-placeholder"></div>`;
      qtyControls = `
        <div class="quantity-controls">
          ${decBtn}
          <span class="quantity">${qty}</span>
          <ha-icon-button class="quantity-btn" data-action="increment"><ha-icon icon="mdi:plus"></ha-icon></ha-icon-button>
        </div>
      `;
    }

    this.content.innerHTML = `
      <div class="card-container ${isOn ? 'state-on' : 'state-off'}">
        <div class="custom-shape-icon">
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
      // Main card click
      if (isOn) {
        // If quantity is enabled and qty > 1, don't remove - let user use decrement
        if (this._config.enable_quantity && qty > 1) {
          // Do nothing on main click when qty > 1
          this._isUpdating = false;
          this.content.querySelector('.card-container').classList.remove('is-updating');
          return;
        } else {
          // Remove item (qty = 1 or quantity not enabled)
          call = this._removeItem(matched);
        }
      } else {
        // Add item
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
        this._isUpdating = false;
        this.content.querySelector('.card-container').classList.remove('is-updating');
      }
    } else {
      this._isUpdating = false;
      this.content.querySelector('.card-container').classList.remove('is-updating');
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
      /* match Mushroom Template Card container */
      ha-card {
        border-radius: var(--ha-card-border-radius, 8px);
        background: var(--card-background-color);
        box-shadow: var(--ha-card-box-shadow);
        overflow: hidden;
      }
      .card-content { 
        padding: 0 !important; 
      }

      /* row layout & hover */
      .card-container {
        display: flex;
        align-items: center;
        padding: var(--spacing);
        gap: var(--spacing);
        cursor: pointer;
        transition: background-color 0.2s;
      }
      .card-container:hover {
        background-color: var(--secondary-background-color);
      }
      .card-container.is-updating {
        opacity: 0.5;
        pointer-events: none;
      }

      /* Custom shape icon to replace mushroom-shape-icon */
      .custom-shape-icon {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        width: var(--control-height);
        height: var(--control-height);
        border-radius: 50%;
        flex-shrink: 0;
        transition: all 0.2s ease;
      }
      
      .custom-shape-icon ha-icon {
        --mdc-icon-size: var(--control-icon-size);
        transition: color 0.2s ease;
      }

      /* State-based colors */
      .state-on .custom-shape-icon {
        background-color: rgba(var(--rgb-green), 0.2);
      }
      .state-on .custom-shape-icon ha-icon {
        color: rgb(var(--rgb-green));
      }
      .state-off .custom-shape-icon {
        background-color: rgba(var(--rgb-state-inactive), 0.2);
      }
      .state-off .custom-shape-icon ha-icon {
        color: rgb(var(--rgb-state-inactive));
      }

      /* text styles - use Mushroom variables */
      .info-container { 
        flex-grow: 1; 
        overflow: hidden; 
        min-width: 0;
      }
      .primary {
        font-weight: var(--card-primary-font-weight);
        font-size: var(--card-primary-font-size);
        line-height: var(--card-primary-line-height);
        color: var(--card-primary-color);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .secondary {
        font-weight: var(--card-secondary-font-weight);
        font-size: var(--card-secondary-font-size);
        line-height: var(--card-secondary-line-height);
        color: var(--card-secondary-color);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* quantity controls */
      .quantity-controls {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .quantity {
        font-size: var(--card-primary-font-size);
        font-weight: var(--card-primary-font-weight);
        color: var(--card-primary-color);
        min-width: 24px;
        text-align: center;
      }
      .quantity-btn {
        --mdc-icon-button-size: var(--control-height);
        --mdc-icon-size: var(--control-icon-size);
      }
      .quantity-btn-placeholder { 
        width: var(--control-height); 
      }

      /* warnings */
      .warning {
        padding: var(--spacing);
        background: var(--error-color);
        color: var(--text-primary-color);
        border-radius: var(--ha-card-border-radius, 8px);
      }
    `;
    this.appendChild(style);
  }

  getCardSize() {
    return 1;
  }
}

customElements.define("shopping-list-card", ShoppingListCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "shopping-list-card",
  name: "Shopping List Card",
  preview: true,
  description: "A card to manage items on a shopping list."
});
