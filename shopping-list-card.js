// shopping-list-card.js
// Version 20: composed with <mushroom-template-card> for 100% of Mushroom’s look.

console.log("Shopping List Card: File loaded. Version 20");

class ShoppingListCard extends HTMLElement {
  setConfig(config) {
    if (!config.title)     throw Error("You must define a title");
    if (!config.todo_list) throw Error("You must define todo_list");
    this._config = config;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    this._renderTemplateCard();
  }

  async _renderTemplateCard() {
    // ---- 1) Compute state + summary list ----
    const listId = this._config.todo_list;
    let items = [];
    try {
      const resp = await this._hass.callWS({
        type: "todo/item/list",
        entity_id: listId
      });
      items = resp.items.map(i => i.summary);
    } catch (e) {
      console.error("Shopping List Card:", e);
    }

    const name = this._config.subtitle
      ? `${this._config.title} - ${this._config.subtitle}`
      : this._config.title;
    const rx = new RegExp(`^${name}(?: \\((\\d+)\\))?$`, "i");

    let isOn = false, matched, qty = 0;
    for (const s of items) {
      const m = s.match(rx);
      if (m) {
        isOn = true;
        matched = s;
        qty = m[1] ? +m[1] : 1;
        break;
      }
    }

    // ---- 2) Decide icon + service data ----
    const icon = isOn ? "mdi:check" : "mdi:plus";
    const svc   = isOn ? "todo.remove_item" : "todo.add_item";
    const data  = isOn
      ? { entity_id: listId, item: matched }
      : { entity_id: listId, item: name };

    // ---- 3) Build the mushroom-template-card config ----
    const cardConfig = {
      type: "custom:mushroom-template-card",
      primary:   this._config.title,
      secondary: this._config.subtitle || undefined,
      icon,
      icon_color:    isOn
        ? "rgb(var(--rgb-green-color))"
        : "rgb(var(--rgb-disabled-color))",
      icon_color_off: "rgb(var(--rgb-disabled-color))",
      tap_action: {
        action:       "call-service",
        service:      svc,
        service_data: data
      }
    };

    // ---- 4) Render it ----
    this.innerHTML = "";
    const tpl = document.createElement("mushroom-template-card");
    tpl.setConfig(cardConfig);
    tpl.hass = this._hass;
    this.appendChild(tpl);
  }
}

customElements.define("shopping-list-card", ShoppingListCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type:        "shopping-list-card",
  name:        "Shopping List Card",
  preview:     true,
  description: "Manage your todo list with Mushroom styling"
});
