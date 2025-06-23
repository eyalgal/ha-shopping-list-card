// shopping-list-card.js
// Version 22: 100% Mushroom look by composing <mushroom-template-card>

console.log("Shopping List Card: File loaded. Version 22");

class ShoppingListCard extends HTMLElement {
  setConfig(cfg) {
    if (!cfg.title)     throw Error("You must define a title");
    if (!cfg.todo_list) throw Error("You must define todo_list");
    this.config = cfg;
  }

  set hass(hass) {
    this.hass = hass;
    if (!this.config) return;
    this._render();
  }

  async _render() {
    const { title, subtitle, todo_list, enable_quantity } = this.config;
    const listId = todo_list;

    // 1) Fetch items
    let items = [];
    try {
      const resp = await this.hass.callWS({
        type: "todo/item/list",
        entity_id: listId
      });
      items = resp.items.map(i => i.summary);
    } catch (e) { console.error(e); }

    // 2) Detect on-list & qty
    const name = subtitle ? `${title} - ${subtitle}` : title;
    const rx   = new RegExp(`^${name}(?: \\((\\d+)\\))?$`, "i");
    let isOn=false, matched, qty=0;
    for (const s of items) {
      const m = s.match(rx);
      if (m) { isOn=true; matched=s; qty=m[1]?+m[1]:1; break; }
    }

    // 3) Build the Mushroom card
    const card = document.createElement("mushroom-template-card");
    card.setConfig({
      type:           "custom:mushroom-template-card",
      primary:        title,
      secondary:      subtitle,
      icon:           isOn ? "mdi:check" : "mdi:plus",
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
    card.hass = this.hass;

    // 4) If quantity enabled, inject into badge slot
    if (isOn && enable_quantity) {
      const badge = document.createElement("div");
      badge.slot = "badge";
      badge.innerHTML = `
        <ha-icon-button data-action="decrement"><ha-icon icon="mdi:minus"></ha-icon></ha-icon-button>
        <span class="qty">${qty}</span>
        <ha-icon-button data-action="increment"><ha-icon icon="mdi:plus"></ha-icon></ha-icon-button>
      `;
      badge.querySelectorAll("ha-icon-button").forEach(btn => {
        btn.addEventListener("click", e => {
          e.stopPropagation();
          const delta = btn.dataset.action === "increment" ? 1 : -1;
          const newQty = qty + delta;
          this.hass.callService("todo", "update_item", {
            entity_id: listId,
            item:      matched,
            rename:    newQty>1 ? `${name} (${newQty})` : name
          }).then(() => this._render());
        });
      });
      card.appendChild(badge);
    }

    // 5) Render
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
  description: "Manage your todo list with Mushroom styling + quantity controls"
});
