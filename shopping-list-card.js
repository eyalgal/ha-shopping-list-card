// A custom card for Home Assistant's Lovelace UI to manage a shopping list.
// This card is designed to look and feel like a Mushroom card.

class ShoppingListCard extends HTMLElement {
  // The 'hass' object is the core of the Home Assistant frontend state.
  // It's passed down to the card whenever the state changes.
  set hass(hass) {
    this._hass = hass;
    if (!this.content) {
      // Initialize the card's basic structure once.
      this.innerHTML = `
        <ha-card>
          <div class="card-content"></div>
        </ha-card>
      `;
      this.content = this.querySelector("div.card-content");
      this._attachStyles();
    }
    // Re-render the card's content whenever the state changes.
    this._render();
  }

  // setConfig is called by Lovelace when the card is first configured.
  setConfig(config) {
    if (!config.title) {
      throw new Error("You need to define a title for the item.");
    }
    if (!config.todo_list) {
      throw new Error("You need to define a todo_list entity_id.");
    }
    this._config = config;
  }

  // Helper function to escape special regex characters from a string.
  _escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // _render is our main function to update the card's display.
  _render() {
    if (!this._config || !this._hass) {
      return;
    }

    const todoEntityId = this._config.todo_list;
    const state = this._hass.states[todoEntityId];

    if (!state) {
        this.content.innerHTML = `<div class="warning">Entity not found: ${todoEntityId}</div>`;
        return;
    }

    // V2 CHANGE: Construct the full item name from title and subtitle.
    // This is the core fix for matching items on the list.
    const fullItemName = this._config.subtitle 
        ? `${this._config.title} - ${this._config.subtitle}` 
        : this._config.title;
    
    const fullItemNameLower = fullItemName.toLowerCase();
    
    // Extract the list of to-do items from the entity's attributes.
    const todoItems = state.attributes.item || [];

    // V2 CHANGE: Create a more robust regex.
    // It's case-insensitive and handles special characters in the item name.
    const escapedItemName = this._escapeRegExp(fullItemNameLower);
    const itemRegex = new RegExp(`^${escapedItemName}(?: \\((\\d+)\\))?$`, 'i');
    
    let isOnList = false;
    let quantity = 1;
    let matchedItem = null;

    // Loop through the items on the to-do list to find a match.
    for (const item of todoItems) {
        const match = item.match(itemRegex);
        if (match) {
            isOnList = true;
            // The first capturing group in the regex is the quantity, if present.
            if (match[1]) {
                quantity = parseInt(match[1], 10);
            }
            matchedItem = item; // Keep the original casing for removal/updates.
            break;
        }
    }

    // Determine the icon and color based on whether the item is on the list.
    const icon = isOnList ? "mdi:check" : "mdi:plus";
    const iconColor = isOnList ? "green" : "grey";

    let quantityControls = '';
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
            <div class="icon-container" style="background-color: var(--${iconColor}-color-rgb, 0, 128, 0, 0.2); color: var(--${iconColor}-color);">
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
    // Stop the event from bubbling up and causing unintended side effects.
    ev.stopPropagation(); 
    const action = ev.target.closest('.quantity-btn')?.dataset.action;

    if (action === 'increment') {
        this._updateQuantity(matchedItem, quantity + 1, fullItemName);
    } else if (action === 'decrement') {
        // If quantity is 1, decrementing removes it. Otherwise, just lower the count.
        if (quantity <= 1) {
            this._removeItem(matchedItem);
        } else {
            this._updateQuantity(matchedItem, quantity - 1, fullItemName);
        }
    } else {
        // If the click was not on a quantity button, toggle the item.
        if (isOnList) {
            this._removeItem(matchedItem);
        } else {
            this._addItem(fullItemName);
        }
    }
  }

  // Calls the todo.add_item service.
  _addItem(itemName) {
      // V2 CHANGE: If quantity is enabled, add with "(1)" initially.
      const itemToAdd = this._config.enable_quantity ? `${itemName} (1)` : itemName;
      this._hass.callService("todo", "add_item", {
          entity_id: this._config.todo_list,
          item: itemToAdd,
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
      const newItemName = `${fullItemName} (${newQuantity})`;
      this._hass.callService("todo", "update_item", {
          entity_id: this._config.todo_list,
          item: oldItem,
          rename: newItemName
      });
  }

  // Attaches the CSS styles to the card.
  _attachStyles() {
    if (this.querySelector("style")) return; // Styles already attached

    const style = document.createElement('style');
    style.textContent = `
        .card-content {
            padding: 0;
        }
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
        .primary {
            font-weight: 500;
        }
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

  // Returns the height of the card for Lovelace layout purposes.
  getCardSize() {
    return 1;
  }
}

// Register the custom element with the browser.
customElements.define("shopping-list-card", ShoppingListCard);

// Add the card to the list of custom cards for the Lovelace panel.
window.customCards = window.customCards || [];
window.customCards.push({
  type: "shopping-list-card",
  name: "Shopping List Card",
  preview: true,
  description: "A card to manage items on a shopping list.",
});
