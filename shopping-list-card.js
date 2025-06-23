// A custom card for Home Assistant's Lovelace UI to manage a shopping list.
// This card is designed to look and feel like a Mushroom card.
// Version 3: Major bug fixes and logic overhaul.

class ShoppingListCard extends HTMLElement {
  // set hass is called by Home Assistant whenever the state changes.
  set hass(hass) {
    this._hass = hass;
    if (!this.content) {
      this.innerHTML = `<ha-card><div class="card-content"></div></ha-card>`;
      this.content = this.querySelector("div.card-content");
      this._attachStyles();
    }
    this._render();
  }

  // setConfig is called once when the card is configured.
  setConfig(config) {
    if (!config.title) throw new Error("You must define a title.");
    if (!config.todo_list) throw new Error("You must define a todo_list entity_id.");
    this._config = config;
  }

  // Helper function to escape special characters for use in a Regular Expression.
  _escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // _render is the main function to update the card's display.
  _render() {
    if (!this._config || !this._hass) return;

    const todoEntityId = this._config.todo_list;
    const state = this._hass.states[todoEntityId];

    if (!state) {
        this.content.innerHTML = `<div class="warning">Entity not found: ${todoEntityId}</div>`;
        return;
    }

    const fullItemName = this._config.subtitle 
        ? `${this._config.title} - ${this._config.subtitle}` 
        : this._config.title;

    // V3 FIX: Use the modern 'items' attribute which is an array of objects, 
    // and fall back to the old 'item' attribute (array of strings) for older HA versions.
    // This is the most critical fix.
    const todoSummaries = (state.attributes.items?.map(i => i.summary)) || state.attributes.item || [];

    const escapedItemName = this._escapeRegExp(fullItemName);
    const itemRegex = new RegExp(`^${escapedItemName}(?: \\((\\d+)\\))?$`, 'i');
    
    let isOnList = false;
    let quantity = 0;
    let matchedItem = null;

    for (const summary of todoSummaries) {
        const match = summary.match(itemRegex);
        if (match) {
            isOnList = true;
            matchedItem = summary;
            quantity = match[1] ? parseInt(match[1], 10) : 1; // If no number, quantity is 1.
            break;
        }
    }

    const icon = isOnList ? "mdi:check" : "mdi:plus";
    const iconColor = isOnList ? "green" : "grey";

    let quantityControls = '';
    // V3 FIX: Show quantity controls when item is on the list.
    if (isOnList && this._config.enable_quantity) {
        quantityControls = `
            <div class="quantity-controls">
                <ha-icon-button class="quantity-btn" data-action="decrement">
                    <ha-icon icon="mdi:minus"></ha-icon>
                </ha-icon-button>
                <span class="quantity">${quantity}</span>
                <ha-icon-button class="quantity-btn" data-action="increment">
                    <ha-icon icon="mdi:plus"></ha-icon>
                </ha-icon-button>
            </div>
        `;
    }

    // This is the HTML structure of our card.
    this.content.innerHTML = `
        <div class="card-container">
            <div class="icon-container" style="background-color: rgba(var(--rgb-${iconColor}-color), 0.1); color: var(--${iconColor}-color);">
                <ha-icon icon="${icon}"></ha-icon>
            </div>
            <div class="info-container">
                <div class="primary">${this._config.title}</div>
                ${this._config.subtitle ? `<div class="secondary">${this._config.subtitle}</div>` : ''}
            </div>
            ${quantityControls}
        </div>
    `;

    // Add event listeners for the various actions.
    this.content.querySelector('.card-container').onclick = (ev) => this._handleTap(ev, isOnList, matchedItem, quantity, fullItemName);
  }

  _handleTap(ev, isOnList, matchedItem, quantity, fullItemName) {
    ev.stopPropagation(); 
    const action = ev.target.closest('.quantity-btn')?.dataset.action;

    if (action === 'increment') {
        this._updateQuantity(matchedItem, quantity + 1, fullItemName);
    } else if (action === 'decrement') {
        // V3 FIX: Decrementing from 2 goes to 1 (base name), from 1 removes the item.
        if (quantity > 1) {
            this._updateQuantity(matchedItem, quantity - 1, fullItemName);
        } else {
            this._removeItem(matchedItem);
        }
    } else {
        // If not a quantity button, handle the main tap action.
        if (isOnList) {
            // V3 UX CHANGE: If quantity is enabled, main tap does nothing to prevent accidental removal.
            if (!this._config.enable_quantity) {
                this._removeItem(matchedItem);
            }
        } else {
            this._addItem(fullItemName);
        }
    }
  }

  // Calls the todo.add_item service.
  _addItem(itemName) {
      // V3 FIX: Always add the base name. Quantity is handled by updates.
      this._hass.callService("todo", "add_item", {
          entity_id: this._config.todo_list,
          item: itemName,
      });
  }

  // Calls the todo.remove_item service.
  _removeItem(item) {
    this._hass.callService("todo", "remove_item", {
      entity_id: this._config.todo_list,
      item: item,
    });
  }

  // Calls the todo.update_item service to change the quantity.
  _updateQuantity(oldItem, newQuantity, fullItemName) {
      // V3 FIX: If new quantity is 1, rename to base name. Otherwise, add (x).
      const newItemName = newQuantity > 1
          ? `${fullItemName} (${newQuantity})`
          : fullItemName;

      this._hass.callService("todo", "update_item", {
          entity_id: this._config.todo_list,
          item: oldItem,
          rename: newItemName
      });
  }

  // Attaches the CSS styles to the card.
  _attachStyles() {
    if (this.querySelector("style")) return; 

    const style = document.createElement('style');
    style.textContent = `
        ha-card {
            border-radius: 12px;
        }
        .card-content { padding: 0 !important; }
        .card-container {
            display: flex;
            align-items: center;
            padding: 12px;
            cursor: pointer;
        }
        .icon-container {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            margin-right: 12px;
            flex-shrink: 0;
        }
        .info-container {
            flex-grow: 1;
            line-height: 1.4;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .primary { font-weight: 500; }
        .secondary { font-size: 0.9em; color: var(--secondary-text-color); }
        .quantity-controls {
            display: flex;
            align-items: center;
            margin-left: 8px;
        }
        .quantity {
            margin: 0 4px;
            font-weight: 500;
            font-size: 1.1em;
        }
        .quantity-btn {
            color: var(--secondary-text-color);
            --mdc-icon-button-size: 36px;
        }
        .warning {
            padding: 12px;
            background-color: var(--error-color);
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
  type: "shopping-list-card",
  name: "Shopping List Card",
  preview: true,
  description: "A card to manage items on a shopping list.",
});
