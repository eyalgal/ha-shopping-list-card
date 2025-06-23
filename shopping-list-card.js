// shopping-list-card.js
// Version 20: full Mushroom-style CSS via our own icon wrapper

console.log("Shopping List Card: File loaded. Version 20.");

class ShoppingListCard extends HTMLElement {
  constructor() {
    super();
    this._isUpdating = false;
    this._lastUpdated = null;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;

    const s = hass.states[this._config.todo_list];
    if (s && s.last_updated !== this._lastUpdated) {
      this._lastUpdated = s.last_updated;
      if (!this.content) {
        this.innerHTML = `<ha-card><div class="card-content"></div></ha-card>`;
        this.content = this.querySelector("div.card-content");
        this._attachStyles();
      }
      this._render();
    }
  }

  setConfig(config) {
    if (!config.title)       throw Error("You must define a title.");
    if (!config.todo_list)   throw Error("You must define a todo_list entity_id.");
    this._config = config;
  }

  _escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

    // 1) Build full item name
    const fullName = this._config.subtitle
      ? `${this._config.title} - ${this._config.subtitle}`
      : this._config.title;

    // 2) Fetch to-do items
    let summaries = [];
    try {
      const resp = await this._hass.callWS({
        type: 'todo/item/list',
        entity_id: this._config.todo_list,
      });
      summaries = resp.items.map(i => i.summary);
    } catch (e) {
      console.error('Shopping List Card: Error fetching items.', e);
      this.content.innerHTML = `<div class="warning">Error fetching items.</div>`;
      return;
    }

    // 3) Detect if on list + quantity
    const rx = new RegExp(`^${this._escapeRegExp(fullName)}(?: \\((\\d+)\\))?$`, 'i');
    let isOn = false, qty = 0, matched = null;
    for (const s of summaries) {
      const m = s.match(rx);
      if (m) { isOn = true; matched = s; qty = m[1]?+m[1]:1; break; }
    }

    // 4) Build quantity controls
    let qtyControls = '';
    if (isOn && this._config.enable_quantity) {
      const dec = qty > 1
        ? `<ha-icon-button class="quantity-btn" data-action="decrement">
             <ha-icon icon="mdi:minus"></ha-icon>
           </ha-icon-button>`
        : `<div class="quantity-btn-placeholder"></div>`;
      qtyControls = `
        <div class="quantity-controls">
          ${dec}
          <span class="quantity">${qty}</span>
          <ha-icon-button class="quantity-btn" data-action="increment">
            <ha-icon icon="mdi:plus"></ha-icon>
          </ha-icon-button>
        </div>
      `;
    }

    // 5) Decide icon & colours
    const icon = isOn ? 'mdi:check' : 'mdi:plus';
    const bg   = isOn
      ? 'rgba(var(--rgb-green-color), 0.2)'
      : 'rgba(var(--rgb-disabled-color), 0.2)';
    const fg   = isOn
      ? 'rgb(var(--rgb-green-color))'
      : 'rgb(var(--rgb-disabled-color))';

    // 6) Render the card
    this.content.innerHTML = `
      <div class="card-container">
        <div class="icon-wrapper" style="background-color: ${bg};">
          <ha-icon icon="${icon}" style="color: ${fg};"></ha-icon>
        </div>
        <div class="info-container">
          <div class="primary">${this._config.title}</div>
          ${this._config.subtitle ? `<div class="secondary">${this._config.subtitle}</div>` : ''}
        </div>
        ${qtyControls}
      </div>
    `;

    // 7) Wire up taps & clicks
    const row = this.content.querySelector('.card-container');
    row.onclick = ev => this._handleTap(ev, isOn, matched, qty, fullName);
    this.content.querySelectorAll('.quantity-btn').forEach(btn =>
      btn.addEventListener('click', ev => {
        ev.stopPropagation();
        this._handleTap(ev, isOn, matched, qty, fullName);
      })
    );
  }

  async _handleTap(ev, isOn, matched, qty, fullName) {
    if (this._isUpdating) return;
    ev.stopPropagation();
    const action = ev.target.closest('.quantity-btn')?.dataset.action;
    this._isUpdating = true;
    this.content.querySelector('.card-container').classList.add('is-updating');

    let call;
    if (action === 'increment') {
      call = this._updateQuantity(matched, qty + 1, fullName);
    } else if (action === 'decrement') {
      if (qty > 1) call = this._updateQuantity(matched, qty - 1, fullName);
    } else {
      if (isOn) {
        if (!this._config.enable_quantity || qty === 1) {
          call = this._removeItem(matched);
        }
      } else {
        call = this._addItem(fullName);
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
      /* Card shell */
      ha-card {
        border-radius: var(--ha-card-border-radius, 4px);
        box-shadow: var(--ha-card-box-shadow, none);
        background: var(--card-background-color);
        overflow: hidden;
      }
      .card-content { padding: 0 !important; }

      /* Row layout */
      .card-container {
        display: flex;
        align-items: center;
        padding: 12px 16px;
        gap: 12px;
        cursor: pointer;
        transition: opacity 0.3s ease-in-out;
      }
      .card-container.is-updating {
        opacity: 0.5;
        pointer-events: none;
      }

      /* Icon circle */
      .icon-wrapper {
        flex-shrink: 0;
        width: 40px;
        height: 40px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .icon-wrapper ha-icon {
        width: 24px;
        height: 24px;
      }

      /* Text */
      .info-container { flex-grow: 1; overflow: hidden; }
      .primary {
        font-size: 16px;
        font-weight: 500;
        line-height: 1.2;
      }
      .secondary {
        font-size: 14px;
        color: var(--secondary-text-color);
      }

      /* Quantity buttons */
      .quantity-controls {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .quantity { font-size: 16px; font-weight: 500; }
      .quantity-btn {
        --mdc-icon-button-size: 36px;
      }
      .quantity-btn-placeholder {
        width: 36px;
      }

      /* Warning */
      .warning {
        padding: 12px;
        background: var(--error-color);
        color: var(--text-primary-color);
        border-radius: var(--ha-card-border-radius, 4px);
      }
    `;
    this.appendChild(style);
  }

  getCardSize() { return 1; }
}

customElements.define("shopping-list-card", ShoppingListCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type:        "shopping-list-card",
  name:        "Shopping List Card",
  preview:     true,
  description: "A card to manage items on a shopping list."
});
