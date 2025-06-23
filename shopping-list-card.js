// shopping-list-card.js
// Version 21: compose <mushroom-template-card> + quantity controls

console.log("Shopping List Card: File loaded. Version 21");

class ShoppingListCard extends HTMLElement {
  constructor() {
    super();
    this._config = null;
    this._hass = null;
    this._isUpdating = false;
    this._lastUpdated = null;
    this._styleAdded = false;
  }

  setConfig(config) {
    if (!config.title)     throw Error("You must define a title");
    if (!config.todo_list) throw Error("You must define a todo_list");
    this._config = config;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    this._render();
  }

  async _render() {
    const listId = this._config.todo_list;
    const state = this._hass.states[listId];
    if (!state) {
      this.innerHTML = `<div class="warning">Entity not found: ${listId}</div>`;
      return;
    }
    // only re-render on actual updates
    if (state.last_updated === this._lastUpdated && !this._isUpdating) return;
    this._lastUpdated = state.last_updated;

    // 1) fetch the existing items
    let summaries = [];
    try {
      const resp = await this._hass.callWS({
        type: "todo/item/list",
        entity_id: listId
      });
      summaries = resp.items.map(i => i.summary);
    } catch (e) {
      console.error("Shopping List Card:", e);
    }

    // 2) figure out if our item is on the list + its qty
    const fullName = this._config.subtitle
      ? `${this._config.title} - ${this._config.subtitle}`
      : this._config.title;
    const rx = new RegExp(`^${this._escape(fullName)}(?: \\((\\d+)\\))?$`, "i");
    let isOn = false, qty = 0, matched = null;
    for (const s of summaries) {
      const m = s.match(rx);
      if (m) {
        isOn = true;
        matched = s;
        qty = m[1] ? +m[1] : 1;
        break;
      }
    }

    // 3) build the qty HTML (if enabled)
    let qtyHTML = "";
    if (isOn && this._config.enable_quantity) {
      const dec = qty > 1
        ? `<ha-icon-button class="quantity-btn" data-action="decrement">
             <ha-icon icon="mdi:minus"></ha-icon>
           </ha-icon-button>`
        : `<div class="quantity-btn-placeholder"></div>`;
      qtyHTML = `
        <div class="quantity-controls">
          ${dec}
          <span class="quantity">${qty}</span>
          <ha-icon-button class="quantity-btn" data-action="increment">
            <ha-icon icon="mdi:plus"></ha-icon>
          </ha-icon-button>
        </div>
      `;
    }

    // 4) decide icon + colours
    const icon = isOn ? "mdi:check" : "mdi:plus";
    const iconColor = isOn
      ? "rgb(var(--rgb-green-color))"
      : "rgb(var(--rgb-disabled-color))";

    // 5) prepare the mushroom-template-card config
    const tplConfig = {
      type:            "custom:mushroom-template-card",
      primary:         this._config.title,
      secondary:       this._config.subtitle || undefined,
      icon,
      icon_color:      iconColor,
      icon_color_off:  iconColor,
      tap_action:      { action: "none" }   // we’ll handle taps ourselves
    };

    // 6) render
    this.innerHTML = "";
    if (!this._styleAdded) this._addStyles();

    const wrapper = document.createElement("div");
    wrapper.className = "shopping-list-wrapper";

    // — insert the mushroom-template-card
    const tpl = document.createElement("mushroom-template-card");
    tpl.setConfig(tplConfig);
    tpl.hass = this._hass;
    wrapper.appendChild(tpl);

    // — append qty controls if any
    if (qtyHTML) {
      const container = document.createElement("div");
      container.innerHTML = qtyHTML;
      // wire the +/- buttons
      container.querySelectorAll(".quantity-btn").forEach(btn => {
        btn.addEventListener("click", ev => {
          ev.stopPropagation(); 
          this._onQtyClick(ev.currentTarget.dataset.action, matched, qty, fullName);
        });
      });
      wrapper.appendChild(container.firstElementChild);
    }

    // — wire the main tap (add/remove)
    tpl.addEventListener("click", () => {
      this._onMainClick(isOn, matched, fullName);
    });

    this.appendChild(wrapper);
  }

  // handle add/remove
  async _onMainClick(isOn, matched, fullName) {
    if (this._isUpdating) return;
    this._isUpdating = true;
    const svc  = isOn ? "todo.remove_item" : "todo.add_item";
    const data = {
      entity_id: this._config.todo_list,
      item:      isOn ? matched : fullName
    };
    try {
      await this._hass.callService("todo", svc, data);
      this._lastUpdated = null;
      this._render();
    } catch (e) {
      console.error(e);
      this._isUpdating = false;
    }
  }

  // handle +/-
  async _onQtyClick(action, matched, qty, fullName) {
    if (this._isUpdating) return;
    this._isUpdating = true;
    const newQty = action === "increment" ? qty + 1 : qty - 1;
    const rename = newQty > 1 ? `${fullName} (${newQty})` : fullName;
    try {
      await this._hass.callService("todo", "update_item", {
        entity_id: this._config.todo_list,
        item:      matched,
        rename
      });
      this._lastUpdated = null;
      this._render();
    } catch (e) {
      console.error(e);
      this._isUpdating = false;
    }
  }

  _escape(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  _addStyles() {
    this._styleAdded = true;
    const style = document.createElement("style");
    style.textContent = `
      .shopping-list-wrapper {
        display: flex;
        align-items: center;
        background: var(--card-background-color);
        border-radius: var(--ha-card-border-radius, 4px);
        overflow: hidden;
      }
      .shopping-list-wrapper mushroom-template-card {
        flex: 1;
      }
      .quantity-controls {
        display: flex;
        align-items: center;
        padding-right: 12px;
      }
      .quantity-btn {
        --mdc-icon-button-size: 36px;
      }
      .quantity-btn-placeholder {
        width: 36px;
      }
      .quantity {
        margin: 0 4px;
        font-weight: 500;
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
  type:        "shopping-list-card",
  name:        "Shopping List Card",
  preview:     true,
  description: "Manage your todo list with Mushroom styling + quantity controls"
});
