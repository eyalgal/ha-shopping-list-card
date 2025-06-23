// A custom card for Home Assistant's Lovelace UI to manage a shopping list.
// Version 14: Final fix for icon styling using the correct Mushroom CSS variables.

console.log("Shopping List Card: File loaded. Version 14.");

class ShoppingListCard extends HTMLElement {
  constructor() {
    super();
    this._isUpdating = false;
    this._lastUpdated = null;
  }

  // set hass is called by Home Assistant whenever the state changes.
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

  // setConfig is called once when the card is configured.
  setConfig(config) {
    if (!config.title) throw new Error("You must define a title.");
    if (!config.todo_list) throw new Error("You must define a todo_list entity_id.");
    this._config = config;
  }

  _escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async _render() {
    if (!this._config || !this._hass) return;

    this._isUpdating = false;
    
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

    const escapedItemName = this._escapeRegExp(fullItemName);
    const itemRegex = new RegExp(`^${escapedItemName}(?: \\((\\d+)\\))?$`, 'i');
    
    let isOnList = false;
    let quantity = 0;
    let matchedItem = null;

    for (const summary of todoSummaries) {
      if (typeof summary !== 'string') continue;
      const match = summary.match(itemRegex);
      if (match) {
        isOnList = true;
        matchedItem = summary;
        quantity = match[1] ? parseInt(match[1], 10) : 1;
        break;
      }
    }
    
    const icon = isOnList ? "mdi:check" : "mdi:plus";
    const iconColorName = isOnList ? "green" : "disabled";

    let quantityControls = '';
    if (isOnList && this._config.enable_quantity) {
        const decrementButton = quantity > 1 
            ? `<ha-icon-button class="quantity-btn" data-action="decrement"><ha-icon icon="mdi:minus"></ha-icon></ha-icon-button>`
            : `<div class="quantity-btn-placeholder"></div>`; 

        quantityControls = `
            <div class="quantity-controls">
                ${decrementButton}
                <span class="quantity">${quantity}</span>
                <ha-icon-button class="quantity-btn" data-action="increment"><ha-icon icon="mdi:plus"></ha-icon></ha-icon-button>
            </div>
        `;
    }

    this.content.innerHTML = `
        <div class="card-container ${this._isUpdating ? 'is-updating' : ''}">
            <mushroom-shape-icon slot="icon">
                <ha-icon icon="${icon}"></ha-icon>
            </mushroom-shape-icon>
            <div class="info-container">
                <div class="primary">${this._config.title}</div>
                ${this._config.subtitle ? `<div class="secondary">${this._config.subtitle}</div>` : ''}
            </div>
            ${quantityControls}
        </div>
    `;
    
    const iconElement = this.content.querySelector('mushroom-shape-icon');
    if (iconElement) {
        // V14 FIX: Use the correct Mushroom variable format (e.g., --rgb-green) by removing the '-color' suffix.
        iconElement.style.setProperty('--icon-color', `rgb(var(--rgb-${iconColorName}))`);
        iconElement.style.setProperty('--shape-color', `rgba(var(--rgb-${iconColorName}), 0.2)`);
    }

    this.content.querySelector('.card-container').onclick = (ev) => this._handleTap(ev, isOnList, matchedItem, quantity, fullItemName);
  }

  _handleTap(ev, isOnList, matchedItem, quantity, fullItemName) {
    if (this._isUpdating) return; 
    
    ev.stopPropagation(); 
    const action = ev.target.closest('.quantity-btn')?.dataset.action;

    this._isUpdating = true;
    this.content.querySelector('.card-container').classList.add('is-updating');

    if (action === 'increment') {
      this._updateQuantity(matchedItem, quantity + 1, fullItemName);
    } else if (action === 'decrement') {
      if (quantity > 1) this._updateQuantity(matchedItem, quantity - 1, fullItemName);
    } else {
      if (isOnList) {
        if (!this._config.enable_quantity || quantity === 1) {
          this._removeItem(matchedItem);
        }
      } else {
        this._addItem(fullItemName);
      }
    }
  }

  _addItem(itemName) {
      this._hass.callService("todo", "add_item", { entity_id: this._config.todo_list, item: itemName });
  }

  _removeItem(item) {
    if (!item) return;
    this._hass.callService("todo", "remove_item", { entity_id: this._config.todo_list, item: item });
  }

  _updateQuantity(oldItem, newQuantity, fullItemName) {
      const newItemName = newQuantity > 1 ? `${fullItemName} (${newQuantity})` : fullItemName;
      this._hass.callService("todo", "update_item", { entity_id: this._config.todo_list, item: oldItem, rename: newItemName });
  }

  _attachStyles() {
    if (this.querySelector("style")) return; 
    const style = document.createElement('style');
    style.textContent = `
        ha-card { border-radius: 12px; border-width: 0; }
        .card-content { padding: 0 !important; }
        .card-container { display: flex; align-items: center; padding: 12px; cursor: pointer; transition: opacity 0.3s ease-in-out; }
        .card-container.is-updating { opacity: 0.5; pointer-events: none; }
        mushroom-shape-icon { flex-shrink: 0; }
        .info-container { flex-grow: 1; line-height: 1.4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-left: 12px; }
        .primary { font-weight: 500; }
        .secondary { font-size: 0.9em; color: var(--secondary-text-color); }
        .quantity-controls { display: flex; align-items: center; margin-left: 8px; }
        .quantity { margin: 0 4px; font-weight: 500; font-size: 1.1em; text-align: center; }
        .quantity-btn { color: var(--secondary-text-color); --mdc-icon-button-size: 36px; }
        .quantity-btn-placeholder { width: 36px; }
        .warning { padding: 12px; background-color: var(--error-color); color: var(--text-primary-color); border-radius: var(--ha-card-border-radius, 4px); }
    `;
    this.appendChild(style);
  }

  getCardSize() { return 1; }
}

customElements.define("shopping-list-card", ShoppingListCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "shopping-list-card",
  name: "Shopping List Card",
  preview: true,
  description: "A card to manage items on a shopping list.",
});
