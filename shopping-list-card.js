// A custom card for Home Assistant's Lovelace UI to manage a shopping list.
// This card is designed to look and feel like a Mushroom card.

class ShoppingListCard extends HTMLElement {
  // The 'hass' object is the core of the Home Assistant frontend state.
  // It's passed down to the card whenever the state changes.
  set hass(hass) {
    this._hass = hass;
    if (!this.content) {
      this.innerHTML = `
        <ha-card>
          <div class="card-content"></div>
        </ha-card>
      `;
      this.content = this.querySelector("div");
    }
    this._render();
  }

  // setConfig is called by Lovelace when the card is first configured.
  // It receives the configuration from your ui-lovelace.yaml.
  setConfig(config) {
    if (!config.title) {
      throw new Error("You need to define a title for the item.");
    }
    if (!config.todo_list) {
      throw new Error("You need to define a todo_list entity_id.");
    }
    this._config = config;
    this._attachStyles();
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

    // Extract the list of to-do items from the entity's attributes.
    // In HA, to-do list items are stored in the 'items' attribute.
    const todoItems = state.attributes.items || [];
    const lowerCaseTodoItems = todoItems.map(item => item.toLowerCase());
    const itemNameLower = this._config.title.toLowerCase();

    // Regex to find the item and an optional quantity like "(3)".
    const itemRegex = new RegExp(`^${itemNameLower}(?: \\((\\d+)\\))?$`);
    
    let isOnList = false;
    let quantity = 1;
    let matchedItem = null;

    // We loop through the items to find a match.
    for (const item of todoItems) {
        const match = item.toLowerCase().match(itemRegex);
        if (match) {
            isOnList = true;
            // The first capturing group in the regex is the quantity.
            if (match[1]) {
                quantity = parseInt(match[1], 10);
            }
            matchedItem = item; // Keep the original casing.
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
            <div class="icon-container" style="color: ${iconColor};">
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
    this.querySelector('.card-container').onclick = (ev) => this._handleTap(ev, isOnList, matchedItem, quantity);
  }

  _handleTap(ev, isOnList, matchedItem, quantity) {
    const action = ev.target.closest('.quantity-btn')?.dataset.action;

    if (action === 'increment') {
        this._updateQuantity(matchedItem, quantity + 1);
    } else if (action === 'decrement') {
        if (quantity > 1) {
            this._updateQuantity(matchedItem, quantity - 1);
        } else {
            this._removeItem(matchedItem);
        }
    } else {
        // If the click was not on a quantity button, toggle the item.
        if (isOnList) {
            this._removeItem(matchedItem);
        } else {
            this._addItem();
        }
    }
  }

  // Calls the todo.add_item service.
  _addItem() {
    this._hass.callService("todo", "add_item", {
      entity_id: this._config.todo_list,
      item: this._config.title,
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
  _updateQuantity(oldItem, newQuantity) {
      const newItemName = `${this._config.title} (${newQuantity})`;
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
            background-color: rgba(127, 127, 127, 0.1);
            margin-right: 12px;
            flex-shrink: 0;
        }
        .info-container {
            flex-grow: 1;
            line-height: 1.4;
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
            background-color: var(--red-color);
            color: var(--text-primary-color-dark);
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
  preview: true, // Optional - shows a preview in the card picker
  description: "A card to manage items on a shopping list.",
});
