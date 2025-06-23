// A custom card for Home Assistant's Lovelace UI to manage a shopping list.
// Version 18: Use direct shape-color/icon-color attributes and inherit border-radius from theme.

console.log("Shopping List Card: File loaded. Version 18.");

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
    if (!config.title) throw new Error("You must define a title.");
    if (!config.todo_list) throw new Error("You must define a todo_list entity_id.");
    this._config = config;
  }

  _escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async _render() {
    // Release update lock
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

    let todoSummaries = [];
    try {
      const result = await this._hass.callWS({
        type: 'todo/item/list',
        entity_id: this._config.todo_list,
      });
      todoSummaries = result.items.map(item => item.summary);
    } catch (err) {
      console.error('Shopping List Card: Error fetching to-do items.', err);
      this.content.innerHTML = `<div class="warning">Error fetching items.</div>`;
      return;
    }

    const escaped = this._escapeRegExp(fullItemName);
    const rx = new RegExp(`^${escaped}(?: \\((\\d+)\\))?$`, 'i');

    let isOnList = false, quantity = 0, matchedItem = null;
    for (const summary of todoSummaries) {
      if (typeof summary !== 'string') continue;
      const m = summary.match(rx);
      if (m) {
        isOnList = true;
        matchedItem = summary;
        quantity = m[1] ? parseInt(m[1], 10) : 1;
        break;
      }
    }

    const icon = isOnList ? "mdi:check" : "mdi:plus";

    let quantityControls = '';
    if (isOnList && this._config.enable_quantity) {
      const dec = quantity > 1
        ? `<ha-icon-button class="quantity-btn" data-action="decrement"><ha-icon icon="mdi:minus"></ha-icon></ha-icon-button>`
        : `<div class="quantity-btn-placeholder"></div>`;
      quantityControls = `
        <div class="quantity-controls">
          ${dec}
          <span class="quantity">${quantity}</span>
          <ha-icon-button class="quantity-btn" data-action="increment"><ha-icon icon="mdi:plus"></ha-icon></ha-icon-button>
        </div>
      `;
    }

    // Direct attributes for shape/icon colours
    const shapeColor = isOnList
      ? 'rgba(var(--rgb-green-color), 0.2)'
      : 'rgba(var(--rgb-disabled-color), 0.2)';
    const iconColor = isOnList
      ? 'rgb(var(--rgb-green-color))'
      : 'rgb(var(--rgb-disabled-color))';

    this.content.innerHTML = `
      <div class="card-container">
        <mushroom-shape-icon
          slot="icon"
          shape-color="${shapeColor}"
          icon-color="${iconColor}"
        >
          <ha-icon icon="${icon}"></ha-icon>
        </mushroom-shape-icon>
        <div class="info-container">
          <div class="primary">${this._config.title}</div>
          ${this._config.subtitle ? `<div class="secondary">${this._config.subtitle}</div>` : ''}
        </div>
        ${quantityControls}
      </div>
    `;

    this.content.querySelector('.card-container').onclick = (ev) =>
      this._handleTap(ev, isOnList, matchedItem, quantity, fullItemName);
  }

  async _handleTap(ev, isOnList, matchedItem, quantity, fullItemName) {
    if (this._isUpdating) return;
    ev.stopPropagation();

    const action = ev.target.closest('.quantity-btn')?.dataset.action;
    this._isUpdating = true;
    this.content.querySelector('.card-container').classList.add('is-updating');

    let serviceCall;
    if (action === 'increment') {
      serviceCall = this._updateQuantity(matchedItem, quantity + 1, fullItemName);
    } else if (action === 'decrement') {
      if (quantity > 1) serviceCall = this._updateQuantity(matchedItem, quantity - 1, fullItemName);
    } else {
      if (isOnList) {
        if (!this._config.enable_quantity || quantity === 1) {
          serviceCall = this._removeItem(matchedItem);
        }
      } else {
        serviceCall = this._addItem(fullItemName);
      }
    }

    if (serviceCall) {
      try {
        await serviceCall;
        this._lastUpdated = null;
        this._render();
      } catch (err) {
        console.error("Shopping List Card: Service call failed", err);
        this._isUpdating = false;
        this.content.querySelector('.card-container').classList.remove('is-updating');
      }
    } else {
      this._isUpdating = false;
      this.content.querySelector('.card-container').classList.remove('is-updating');
    }
  }

  _addItem(itemName) {
    return this._hass.callService("todo", "add_item", {
      entity_id: this._config.todo_list,
      item: itemName
    });
  }

  _removeItem(item) {
    if (!item) return Promise.resolve();
    return this._hass.callService("todo", "remove_item", {
      entity_id: this._config.todo_list,
      item
    });
  }

  _updateQuantity(oldItem, newQty, fullItemName) {
    const newName = newQty > 1 ? `${fullItemName} (${newQty})` : fullItemName;
    return this._hass.callService("todo", "update_item", {
      entity_id: this._config.todo_list,
      item: oldItem,
      rename: newName
    });
  }

  _attachStyles() {
    if (this.querySelector("style")) return;
    const style = document.createElement('style');
    style.textContent = `
      ha-card {
        border-radius: var(--ha-card-border-radius, 4px);
        border-width: 0;
      }
      .card-content { padding: 0 !important; }
      .card-container {
        display: flex;
        align-items: center;
        padding: 12px;
        cursor: pointer;
        transition: opacity 0.3s ease-in-out;
      }
      .card-container.is-updating {
        opacity: 0.5;
        pointer-events: none;
      }
      mushroom-shape-icon { flex-shrink: 0; }
      .info-container {
        flex-grow: 1;
        line-height: 1.4;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        margin-left: 12px;
      }
      .primary { font-weight: 500; }
      .secondary {
        font-size: 0.9em;
        color: var(--secondary-text-color);
      }
      .quantity-controls {
        display: flex;
        align-items: center;
        margin-left: 8px;
      }
      .quantity {
        margin: 0 4px;
        font-weight: 500;
        font-size: 1.1em;
        text-align: center;
      }
      .quantity-btn {
        color: var(--secondary-text-color);
        --mdc-icon-button-size: 36px;
      }
      .quantity-btn-placeholder { width: 36px; }
      .warning {
        padding: 12px;
        background-color: var(--error-color);
        color: var(--text-primary-color);
        border-radius: var(--ha-card-border-radius, 4px);
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
