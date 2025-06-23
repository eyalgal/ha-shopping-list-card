// Version 22: 100% Mushroom look via composition + badge slot

class ShoppingListCard extends HTMLElement {
  setConfig(config) {
    if (!config.title)     throw Error("You must define a title");
    if (!config.todo_list) throw Error("You must define todo_list");
    this._config = config;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    this._render();
  }

  async _render() {
    // 1) Fetch & detect state/qty
    const listId = this._config.todo_list;
    let items = [];
    try {
      const resp = await this._hass.callWS({
        type: "todo/item/list",
        entity_id: listId
      });
      items = resp.items.map(i => i.summary);
    } catch {/*ignore*/}
    const name = this._config.subtitle
      ? `${this._config.title} - ${this._config.subtitle}`
      : this._config.title;
    const rx = new RegExp(`^${name}(?: \\((\\d+)\\))?$`, "i");
    let isOn=false, matched, qty=0;
    for (const s of items) {
      const m = s.match(rx);
      if (m) { isOn=true; matched=s; qty= m[1]?+m[1]:1; break; }
    }

    // 2) Build the base mushroom card
    const icon = isOn ? "mdi:check" : "mdi:plus";
    const card = document.createElement("mushroom-template-card");
    card.setConfig({
      type:           "custom:mushroom-template-card",
      primary:        this._config.title,
      secondary:      this._config.subtitle,
      icon,
      icon_color:     isOn
                       ? "rgb(var(--rgb-green-color))"
                       : "rgb(var(--rgb-disabled-color))",
      icon_color_off: "rgb(var(--rgb-disabled-color))",
      tap_action: {
        action:       "call-service",
        service:      isOn ? "todo.remove_item" : "todo.add_item",
        service_data: {
          entity_id: listId,
          item:      isOn ? matched : name
        }
      }
    });
    card.hass = this._hass;

    // 3) If quantity enabled & item on list => add badge slot controls
    if (isOn && this._config.enable_quantity) {
      const badge = document.createElement("div");
      badge.slot = "badge";
      badge.innerHTML = `
        <ha-icon-button
          class="qty-btn"
          data-action="decrement"
          ><ha-icon icon="mdi:minus"></ha-icon>
        </ha-icon-button>
        <span class="qty">${qty}</span>
        <ha-icon-button
          class="qty-btn"
          data-action="increment"
          ><ha-icon icon="mdi:plus"></ha-icon>
        </ha-icon-button>
      `;
      // wire increment/decrement
      badge.querySelectorAll(".qty-btn").forEach(btn => {
        btn.addEventListener("click", ev => {
          ev.stopPropagation();
          const action = btn.dataset.action;
          const newQty = action==="increment" ? qty+1 : qty-1;
          this._hass.callService("todo", "update_item", {
            entity_id: listId,
            item: matched,
            rename: newQty>1 ? `${name} (${newQty})` : name
          }).then(() => this._render());
        });
      });
      card.appendChild(badge);
    }

    // 4) render
    this.innerHTML = "";
    this.appendChild(card);
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
