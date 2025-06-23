// A custom card for Home Assistant's Lovelace UI to manage a shopping list.
// This card is designed to look and feel like a Mushroom card.
// Version 6: Added a global console log to test if the file is being loaded at all.

console.log("Shopping List Card: File loaded. Version 6.");

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
    if (this._config.debug) {
      console.log("Shopping List Card: Config Loaded", this._config);
    }
  }

  // Helper to escape special characters for use in a Regular Expression.
  _escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // _render is the main function to update the card's display.
  _render() {
    if (!this._config || !this._hass) return;

    const todoEntityId = this._config.todo_list;
    const state = this._hass.states[todoEntityId];
    const isDebug = this._config.debug;

    if (isDebug) console.log(`Shopping List Card: --- START RENDER (${this._config.title}) ---`);

    if (!state) {
        this.content.innerHTML = `<div class="warning">Entity not found: ${todoEntityId}</div>`;
        if (isDebug) console.error(`Shopping List Card: Entity ${todoEntityId} not found in hass.states.`);
        return;
    }
    
    if (isDebug) console.log("Shopping List Card: State object for", todoEntityId, JSON.parse(JSON.stringify(state)));

    const fullItemName = this._config.subtitle 
        ? `${this._config.title} - ${this._config.subtitle}` 
        : this._config.title;
    
    if (isDebug) console.log("Shopping List Card: Constructed full item name to search for:", `"${fullItemName}"`);

    // V5 FIX: Definitive item detection logic.
    let todoSummaries = [];
    if (state.attributes && Array.isArray(state.attributes.items)) {
        // Modern HA: `items` is an array of objects with a `summary` key.
        todoSummaries = state.attributes.items.map(item => item.summary).filter(Boolean);
        if (isDebug) console.log("Shopping List Card: Found modern 'items' attribute. Summaries:", todoSummaries);
    } else if (state.attributes && Array.isArray(state.attributes.item)) {
        // Legacy HA: `item` is an array of strings.
        todoSummaries = state.attributes.item;
        if (isDebug) console.log("Shopping List Card: Found legacy 'item' attribute. Summaries:", todoSummaries);
    } else {
        if (isDebug) console.warn("Shopping List Card: Could not find 'items' or 'item' array in entity attributes.");
    }

    const escapedItemName = this._escapeRegExp(fullItemName);
    const itemRegex = new RegExp(`^${escapedItemName}(?: \\((\\d+)\\))?$`, 'i');
    
    let isOnList = false;
    let quantity = 0;
    let matchedItem = null;

    if (isDebug) console.log("Shopping List Card: Starting search with regex:", itemRegex);
    for (const summary of todoSummaries) {
        if (typeof summary !== 'string') {
            if (isDebug) console.log(`Shopping List Card: Skipping non-string item in list:`, summary);
            continue;
        }
        const match = summary.match(itemRegex);
        if (match) {
            if (isDebug) console.log(`Shopping List Card: SUCCESS! Found match for "${fullItemName}" in list item "${summary}"`);
            isOnList = true;
            matchedItem = summary;
            quantity = match[1] ? parseInt(match[1], 10) : 1;
            break;
        }
    }
    
    if (!isOnList && isDebug) console.log(`Shopping List Card: FAILED to find match for "${fullItemName}" in list.`);

    const icon = isOnList ? "mdi:check" : "mdi:plus";
    // V5 FIX: Reverted to 'grey' as it's more reliable than 'disabled' for color.
    const iconColor = isOnList ? "green" : "grey";

    let quantityControls = '';
    if (isOnList && this._config.enable_quantity) {
        quantityControls = `
            <div class="quantity-controls">
                <ha-icon-button class="quantity-btn" data-action="decrement"><ha-icon icon="mdi:minus"></ha-icon></ha-icon-button>
                <span class="quantity">${quantity}</span>
                <ha-icon-button class="quantity-btn" data-action="increment"><ha-icon icon="mdi:plus"></ha-icon></ha-icon-button>
            </div>
        `;
    }

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

    this.content.querySelector('.card-container').onclick = (ev) => this._handleTap(ev, isOnList, matchedItem, quantity, fullItemName);
    if (isDebug) console.log("Shopping List Card: --- END RENDER ---");
  }

  _handleTap(ev, isOnList, matchedItem, quantity, fullItemName) {
    ev.stopPropagation(); 
    const action = ev.target.closest('.quantity-btn')?.dataset.action;

    if (action === 'increment') this._updateQuantity(matchedItem, quantity + 1, fullItemName);
    else if (action === 'decrement') {
        if (quantity > 1) this._updateQuantity(matchedItem, quantity - 1, fullItemName);
        else this._removeItem(matchedItem);
    } else {
        if (isOnList) {
            if (!this._config.enable_quantity) this._removeItem(matchedItem);
        } else this._addItem(fullItemName);
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
        .card-container { display: flex; align-items: center; padding: 12px; cursor: pointer; }
        .icon-container { display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 50%; margin-right: 12px; flex-shrink: 0; }
        .info-container { flex-grow: 1; line-height: 1.4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .primary { font-weight: 500; }
        .secondary { font-size: 0.9em; color: var(--secondary-text-color); }
        .quantity-controls { display: flex; align-items: center; margin-left: 8px; }
        .quantity { margin: 0 4px; font-weight: 500; font-size: 1.1em; }
        .quantity-btn { color: var(--secondary-text-color); --mdc-icon-button-size: 36px; }
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
