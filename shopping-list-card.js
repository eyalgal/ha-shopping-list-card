// A custom card for Home Assistant's Lovelace UI to manage a shopping list.
// Version 23: styling tweaked to match Mushroom Template Card exactly

console.log("Shopping List Card: File loaded. Version 23.");

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

    const shapeColor = isOn
      ? 'rgba(var(--rgb-green-color), 0.2)'
      : 'rgba(var(--rgb-disabled-color), 0.2)';
    const iconColor = isOn
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
        background:     var(--card-background-color);
        box-shadow:     var(--ha-card-box-shadow);
        overflow:       hidden;
      }
      .card-content { padding: 0 !important; }

      /* row layout & hover */
      .card-container {
        display:        flex;
        align-items:    center;
        padding:        16px;
        gap:            16px;
        cursor:         pointer;
        transition:     background-color 0.2s;
      }
      .card-container:hover {
        background-color: var(--hover-background-color);
      }
      .card-container.is-updating {
        opacity:         0.5;
        pointer-events:  none;
      }

      /* icon size, shape, padding */
      mushroom-shape-icon {
        --shape-size:   40px;
        --mdc-icon-size:24px;
        flex-shrink:    0;
      }
      /* ensure perfect circle */
      mushroom-shape-icon .shape {
        border-radius:  50% !important;
      }

      /* text styles */
      .info-container { flex-grow: 1; overflow: hidden; }
      .primary {
        font-family:    var(--ha-user-font-family, var(--font-family));
        font-size:      16px;
        font-weight:    500;
        line-height:    1.2;
        color:          var(--primary-text-color);
      }
      .secondary {
        font-family:    var(--ha-user-font-family, var(--font-family));
        font-size:      14px;
        font-weight:    400;
        line-height:    1.2;
        color:          var(--secondary-text-color);
      }

      /* quantity controls */
      .quantity-controls {
        display:        flex;
        align-items:    center;
        gap:            8px;
      }
      .quantity {
        font-size:      16px;
        font-weight:    500;
      }
      .quantity-btn {
        --mdc-icon-button-size: 36px;
      }
      .quantity-btn-placeholder { width: 36px; }

      /* warnings */
      .warning {
        padding:        12px;
        background:     var(--error-color);
        color:          var(--text-primary-color);
        border-radius:  var(--ha-card-border-radius, 8px);
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
  type:        "shopping-list-card",
  name:        "Shopping List Card",
  preview:     true,
  description: "A card to manage items on a shopping list."
});
