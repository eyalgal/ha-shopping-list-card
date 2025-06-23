// shopping-list-card.js
// Version 26: exact Mushroom CSS fixes for icon, text wrapping, and colors

console.log("Shopping List Card: File loaded. Version 26.");

class ShoppingListCard extends HTMLElement {
  constructor() {
    super();
    this._isUpdating = false;
    this._lastUpdated = null;
    this._styleAdded = false;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;

    const st = hass.states[this._config.todo_list];
    if (st && st.last_updated !== this._lastUpdated) {
      this._lastUpdated = st.last_updated;
      if (!this.content) {
        // light-DOM wrapper so our CSS applies
        this.innerHTML = `<div class="slc-card"><div class="card-content"></div></div>`;
        this.content = this.querySelector('.card-content');
        this._attachStyles();
      }
      this._render();
    }
  }

  setConfig(config) {
    if (!config.title)      throw new Error('You must define a title.');
    if (!config.todo_list)  throw new Error('You must define a todo_list entity_id.');
    this._config = config;
  }

  _escape(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async _render() {
    this._isUpdating = false;
    const row = this.content.querySelector('.card-container');
    if (row) row.classList.remove('is-updating');

    if (!this._config || !this._hass) return;
    const state = this._hass.states[this._config.todo_list];
    if (!state) {
      this.content.innerHTML = `<div class="warning">Entity not found: ${this._config.todo_list}</div>`;
      return;
    }

    // build full name
    const fullName = this._config.subtitle
      ? `${this._config.title} - ${this._config.subtitle}`
      : this._config.title;

    // fetch items
    let summaries = [];
    try {
      const res = await this._hass.callWS({
        type: 'todo/item/list',
        entity_id: this._config.todo_list,
      });
      summaries = res.items.map(i => i.summary);
    } catch (e) {
      console.error('Shopping List Card: fetch error', e);
      this.content.innerHTML = `<div class="warning">Error fetching items.</div>`;
      return;
    }

    // detect on-list & qty
    const rx = new RegExp(`^${this._escape(fullName)}(?: \\((\\d+)\\))?$`, 'i');
    let isOn = false, qty = 0, matched;
    for (const s of summaries) {
      const m = s.match(rx);
      if (m) { isOn = true; matched = s; qty = m[1] ? +m[1] : 1; break; }
    }

    // plus/check icon & qty controls
    const icon = isOn ? 'mdi:check' : 'mdi:plus';
    let qtyHTML = '';
    if (isOn && this._config.enable_quantity) {
      const dec = qty > 1
        ? `<ha-icon-button class="quantity-btn" data-action="decrement"><ha-icon icon="mdi:minus"></ha-icon></ha-icon-button>`
        : `<div class="quantity-btn-placeholder"></div>`;
      qtyHTML = `
        <div class="quantity-controls">
          ${dec}
          <span class="quantity">${qty}</span>
          <ha-icon-button class="quantity-btn" data-action="increment"><ha-icon icon="mdi:plus"></ha-icon></ha-icon-button>
        </div>
      `;
    }

    // colours
    const shapeColor = isOn
      ? 'rgba(var(--rgb-green-color), 0.2)'
      : 'rgba(var(--rgb-disabled-color), 0.12)';
    const iconColor = isOn
      ? 'rgb(var(--rgb-green-color))'
      : 'rgb(var(--rgb-disabled-color))';

    // render
    this.content.innerHTML = `
      <div class="card-container">
        <div class="shape-icon" style="--shape-color: ${shapeColor}; --icon-color: ${iconColor};">
          <ha-icon icon="${icon}"></ha-icon>
        </div>
        <div class="info-container">
          <div class="primary">${this._config.title}</div>
          ${ this._config.subtitle ? `<div class="secondary">${this._config.subtitle}</div>` : '' }
        </div>
        ${qtyHTML}
      </div>
    `;

    // wire interactions
    this.content.querySelectorAll('.quantity-btn').forEach(btn =>
      btn.addEventListener('click', ev => {
        ev.stopPropagation();
        this._handleTap(ev, isOn, matched, qty, fullName);
      })
    );
    this.content.querySelector('.card-container')
      .addEventListener('click', ev => this._handleTap(ev, isOn, matched, qty, fullName));
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
        console.error('Shopping List Card: service call failed', e);
        this._isUpdating = false;
        this.content.querySelector('.card-container').classList.remove('is-updating');
      }
    } else {
      this._isUpdating = false;
      this.content.querySelector('.card-container').classList.remove('is-updating');
    }
  }

  _addItem(item) {
    return this._hass.callService('todo', 'add_item', {
      entity_id: this._config.todo_list,
      item,
    });
  }
  _removeItem(item) {
    if (!item) return Promise.resolve();
    return this._hass.callService('todo', 'remove_item', {
      entity_id: this._config.todo_list,
      item,
    });
  }
  _updateQuantity(oldItem, newQty, fullName) {
    const rename = newQty > 1 ? `${fullName} (${newQty})` : fullName;
    return this._hass.callService('todo', 'update_item', {
      entity_id: this._config.todo_list,
      item: oldItem,
      rename,
    });
  }

  _attachStyles() {
    if (this._styleAdded) return;
    this._styleAdded = true;

    const style = document.createElement('style');
    style.textContent = `
      /* card wrapper */
      .slc-card {
        border-radius: var(--ha-card-border-radius, 8px);
        background:     var(--card-background-color);
        box-shadow:     var(--ha-card-box-shadow);
        overflow:       hidden;
        font-family:    var(--ha-user-font-family, var(--font-family));
      }
      .card-content { padding: 0; }

      /* row & hover */
      .card-container {
        display:        flex;
        align-items:    center;
        padding:        16px;
        gap:            16px;
        cursor:         pointer;
        transition:     background-color 0.2s;
      }
      .card-container:hover {
        background-color: var(--hover-background-color);
      }
      .card-container.is-updating {
        opacity:         0.5;
        pointer-events:  none;
      }

      /* icon circle & size */
      .shape-icon {
        width:            40px;
        height:           40px;
        border-radius:    50%;
        background-color: var(--shape-color) !important;
        display:          flex;
        align-items:      center;
        justify-content:  center;
        flex-shrink:      0;
      }
      .shape-icon ha-icon {
        color:            var(--icon-color) !important;
        width:            24px;
        height:           24px;
      }

      /* text container */
      .info-container {
        flex:             1;
        display:          flex;
        flex-direction:   column;
        justify-content:  center;
      }
      .primary {
        font-size:        16px;
        font-weight:      500;
        line-height:      1.2;
        color:            var(--primary-text-color);
        white-space:      normal;
      }
      .secondary {
        font-size:        14px;
        font-weight:      400;
        line-height:      1.2;
        color:            var(--secondary-text-color);
        white-space:      normal;
      }

      /* quantity controls */
      .quantity-controls {
        display:        flex;
        align-items:    center;
        gap:            8px;
      }
      .quantity {
        font-size:      16px;
        font-weight:    500;
      }
      .quantity-btn {
        --mdc-icon-button-size: 36px;
      }
      .quantity-btn-placeholder {
        width:          36px;
      }

      /* warning */
      .warning {
        padding:        12px;
        background:     var(--error-color);
        color:          var(--text-primary-color);
        border-radius:  var(--ha-card-border-radius, 8px);
      }
    `;
    this.appendChild(style);
  }

  getCardSize() {
    return 1;
  }
}

customElements.define('shopping-list-card', ShoppingListCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type:        'shopping-list-card',
  name:        'Shopping List Card',
  preview:     true,
  description: 'A card to manage items on a shopping list.'
});
