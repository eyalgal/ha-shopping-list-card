/*
 * Shopping List Card
 *
 * A Home Assistant Lovelace card to manage items on a to-do list with a
 * clean, modern interface and a visual editor.
 *
 * Author: eyalgal
 * License: MIT
 * * Note: This card requires a to-do entity to function properly.
 * For more information, visit: https://github.com/eyalgal/ha-shopping-list-card
 */

// ── Editor ───────────────────────────────────────────────────────────────────

class ShoppingListCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._rendered = false;
    this._hasInitialized = false;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._rendered) this._render();
  }

  setConfig(config) {
    this._config = config;
    if (this._rendered) this._updateFormValues();
  }

  _render() {
    if (!this.shadowRoot || !this._hass) return;

    // Check if there are any todo entities
    const todoEntities = Object.keys(this._hass.states).filter(entityId =>
      entityId.startsWith('todo.')
    );
    const hasTodoEntities = todoEntities.length > 0;

    this.shadowRoot.innerHTML = `
      <style>
        .row { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
        .switch-row { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
        ha-textfield, ha-entity-picker, ha-icon-picker { flex-grow: 1; }
        .picker-row { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
        input[type="color"] {
          width: 40px;
          height: 40px;
          padding: 0;
          border: 1px solid var(--divider-color, #888);
          border-radius: 4px;
          cursor: pointer;
          background: none;
        }
        .info-box {
          background: var(--info-color, #039be5);
          color: white;
          padding: 12px;
          border-radius: 4px;
          margin-bottom: 16px;
          font-size: 14px;
        }
        .info-box a {
          color: white;
          text-decoration: underline;
        }
      </style>

      ${!hasTodoEntities ? `
        <div class="info-box">
          <strong>Note:</strong> No to-do entities found. This card requires a to-do entity to function.
          <a href="https://github.com/eyalgal/ha-shopping-list-card" target="_blank">View documentation</a>
        </div>
      ` : ''}

      <div class="row">
        <ha-entity-picker id="todo_list" label="To-Do List Entity (Required)" required></ha-entity-picker>
      </div>
      <div class="row">
        <ha-textfield id="title" label="Title (Required)" required></ha-textfield>
        <ha-textfield id="subtitle" label="Subtitle (Optional)"></ha-textfield>
      </div>
      <div class="row">
        <ha-textfield id="image" label="Image URL (Optional)" placeholder="/local/shopping/milk.png or https://..."></ha-textfield>
      </div>
      <div class="switch-row">
        <ha-switch id="enable_quantity"></ha-switch>
        <span style="font-weight:500; flex-grow: 1;">Enable Quantity</span>
      </div>
      <div class="switch-row">
        <ha-switch id="vertical_layout"></ha-switch>
        <span style="font-weight:500; flex-grow: 1;">Use Vertical Layout</span>
      </div>
      <div class="picker-row">
        <ha-icon-picker id="off_icon" label="Off Icon"></ha-icon-picker>
        <ha-textfield id="off_color" label="Off Color (name or hex)"></ha-textfield>
        <input type="color" id="off_color_picker" title="Pick off-state color" />
      </div>
      <div class="picker-row">
        <ha-icon-picker id="on_icon" label="On Icon"></ha-icon-picker>
        <ha-textfield id="on_color" label="On Color (name or hex)"></ha-textfield>
        <input type="color" id="on_color_picker" title="Pick on-state color" />
      </div>
      <div class="switch-row">
        <ha-switch id="colorize_background"></ha-switch>
        <span style="font-weight:500; flex-grow: 1;">Colorize card background when "On"</span>
      </div>
    `;

    // Setup pickers
    const ep = this.shadowRoot.querySelector('#todo_list');
    ep.hass = this._hass;
    ep.includeDomains = ['todo'];
    ep.allowCustomEntity = false;

    ['off_icon', 'on_icon'].forEach(id => {
      this.shadowRoot.querySelector(`#${id}`).hass = this._hass;
    });

    // Add all event listeners
    this.shadowRoot.querySelectorAll('ha-textfield, ha-switch, ha-entity-picker, ha-icon-picker').forEach(el => {
        el.addEventListener('input', () => this._handleConfigChanged());
        el.addEventListener('change', () => this._handleConfigChanged());
        el.addEventListener('value-changed', () => this._handleConfigChanged());
    });

    ['off','on'].forEach(type => {
      const tf = this.shadowRoot.querySelector(`#${type}_color`);
      const cp = this.shadowRoot.querySelector(`#${type}_color_picker`);
      cp.addEventListener('input', () => {
        tf.value = cp.value;
        this._handleConfigChanged();
      });
      tf.addEventListener('input', () => {
        const hex = this._getEditorHex(tf.value);
        if (hex) cp.value = hex;
        this._handleConfigChanged();
      });
    });

    this._rendered = true;
    if (this._config) this._updateFormValues();
  }

  _getEditorHex(val) {
    if (!val) return '#000000';
    if (val.startsWith('#')) return val;
    const hex = ShoppingListCard.COLOR_MAP[val.toLowerCase()];
    return hex || '#000000';
  }

  _updateFormValues() {
    const s = this.shadowRoot;

    // If no todo_list is configured, try to find the first available todo entity
    let todoEntity = this._config.todo_list;
    let shouldAutoPopulate = false;

    if (!todoEntity && this._hass && !this._hasInitialized) {
      // Only auto-populate on first load, not when user explicitly removes it
      const todoEntities = Object.keys(this._hass.states).filter(entityId =>
        entityId.startsWith('todo.')
      );
      if (todoEntities.length > 0) {
        todoEntity = todoEntities[0];
        shouldAutoPopulate = true;
      }
      this._hasInitialized = true;
    }

    s.querySelector('#title').value = this._config.title || '';
    s.querySelector('#subtitle').value = this._config.subtitle || '';
    s.querySelector('#image').value = this._config.image || '';
    s.querySelector('#todo_list').value = this._config.todo_list || '';
    s.querySelector('#enable_quantity').checked = !!this._config.enable_quantity;
    s.querySelector('#colorize_background').checked = this._config.colorize_background !== false;
    s.querySelector('#vertical_layout').checked = this._config.layout === 'vertical';

    // Only trigger config change if we're auto-populating
    if (shouldAutoPopulate && todoEntity) {
      s.querySelector('#todo_list').value = todoEntity;
      // Delay to ensure UI is ready
      setTimeout(() => this._handleConfigChanged(), 100);
    }

    ['off','on'].forEach(type => {
      s.querySelector(`#${type}_icon`).value = this._config[`${type}_icon`] || ShoppingListCard[`DEFAULT_${type.toUpperCase()}_ICON`];
      const col = this._config[`${type}_color`] || ShoppingListCard[`DEFAULT_${type.toUpperCase()}_COLOR`];
      s.querySelector(`#${type}_color`).value = col;
      s.querySelector(`#${type}_color_picker`).value = this._getEditorHex(col);
    });
  }

  _handleConfigChanged() {
    const s = this.shadowRoot;
    // Start with a copy of the existing config to preserve unknown keys
    const newConfig = { ...this._config };

    // Update values from the form
    newConfig.title = s.querySelector('#title').value;
    newConfig.subtitle = s.querySelector('#subtitle').value || undefined;
    newConfig.image = s.querySelector('#image').value || undefined;
    newConfig.todo_list = s.querySelector('#todo_list').value;

    // Handle boolean switches, only saving non-default values
    const enableQuantity = s.querySelector('#enable_quantity').checked;
    if (enableQuantity) { // Default is false, so we only need to save if true
      newConfig.enable_quantity = true;
    } else {
      delete newConfig.enable_quantity;
    }

    const colorizeBackground = s.querySelector('#colorize_background').checked;
    if (colorizeBackground) { // New default is true, so we can delete the key
      delete newConfig.colorize_background;
    } else {
      // Only save if the user explicitly sets it to false
      newConfig.colorize_background = false;
    }

    const verticalLayout = s.querySelector('#vertical_layout').checked;
    if (verticalLayout) {
      newConfig.layout = 'vertical';
    } else {
      delete newConfig.layout; // Default is horizontal
    }

    ['off','on'].forEach(type => {
      const icon = s.querySelector(`#${type}_icon`).value;
      if (icon === ShoppingListCard[`DEFAULT_${type.toUpperCase()}_ICON`]) {
        delete newConfig[`${type}_icon`];
      } else {
        newConfig[`${type}_icon`] = icon;
      }

      const col = s.querySelector(`#${type}_color`).value;
      if (col === ShoppingListCard[`DEFAULT_${type.toUpperCase()}_COLOR`]) {
        delete newConfig[`${type}_color`];
      } else {
        newConfig[`${type}_color`] = col;
      }
    });

    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: newConfig }, bubbles: true, composed: true }));
  }
}
customElements.define('shopping-list-card-editor', ShoppingListCardEditor);

// ── Card ─────────────────────────────────────────────────────────────────────

class ShoppingListCard extends HTMLElement {
  static DEFAULT_ON_ICON    = 'mdi:check';
  static DEFAULT_OFF_ICON   = 'mdi:plus';
  static DEFAULT_ON_COLOR   = 'green';
  static DEFAULT_OFF_COLOR  = 'grey';
  static COLOR_MAP = {
    red: '#F44336', pink: '#E91E63', purple: '#9C27B0',
    'deep-purple': '#673AB7', indigo: '#3F51B5',
    blue: '#2196F3', 'light-blue': '#03A9F4',
    cyan: '#00BCD4', teal: '#009688', green: '#4CAF50',
    lime: '#CDDC39', yellow: '#FFEB3B', amber: '#FFC107',
    orange: '#FF9800', brown: '#795548', grey: '#9E9E9E',
    'blue-grey': '#607D8B',
  };

  constructor() {
    super();
    this._isUpdating = false;
    this._lastUpdated = null;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    const st = hass.states[this._config.todo_list];
    if (!st || st.last_updated === this._lastUpdated) return;
    this._lastUpdated = st.last_updated;

    if (!this.content) {
      this.innerHTML = `<ha-card><div class="card-content"></div></ha-card>`;
      this.content = this.querySelector('div.card-content');
      this._attachStyles();
    }
    this._render();
  }

  setConfig(config) {
    if (!config.title)      throw new Error('You must define a title.');
    if (!config.todo_list) throw new Error('You must define a todo_list entity_id.');
    this._config = config;
    if (this._hass) {
      this._lastUpdated = null;
      this._render();
    }
  }

  static getConfigElement() { return document.createElement('shopping-list-card-editor'); }
  static getStubConfig() {
    return {
      type: 'custom:shopping-list-card',
      title: 'New Item',
      todo_list: '' // Add empty string to pass validation, editor will populate
    };
  }

  _escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  _getColorValue(val) {
    if (!val) return null;
    if (val.startsWith('#')) return val;
    return ShoppingListCard.COLOR_MAP[val.toLowerCase()] || val;
  }

  _hexToRgb(hex) {
    const m = hex.replace('#','').match(/^(.{2})(.{2})(.{2})$/);
    return m ? { r: parseInt(m[1],16), g: parseInt(m[2],16), b: parseInt(m[3],16) } : null;
  }

  _toRgba(hex, a) {
    const c = this._hexToRgb(hex);
    return c ? `rgba(${c.r}, ${c.g}, ${c.b}, ${a})` : hex;
  }

  async _render() {
    this._isUpdating = false;
    const container = this.content.querySelector('.card-container');
    if (container) container.classList.remove('is-updating');
    if (!this._config || !this._hass) return;

    const state = this._hass.states[this._config.todo_list];
    if (!state) {
      this.content.innerHTML = `<div class="warning">Entity not found: ${this._config.todo_list}</div>`;
      return;
    }

    const fullName = this._config.subtitle
      ? `${this._config.title} - ${this._config.subtitle}`
      : this._config.title;

    let summaries = [];
    try {
      const res = await this._hass.callWS({
        type: 'todo/item/list',
        entity_id: this._config.todo_list,
      });
      summaries = res.items
        .filter(item => item.status === 'needs_action')
        .map(item => item.summary);
    } catch (e) {
      console.error('Error fetching items', e);
      this.content.innerHTML = `<div class="warning">Error fetching items.</div>`;
      return;
    }

    const rx = new RegExp(`^${this._escapeRegExp(fullName)}(?: \\((\\d+)\\))?$`, 'i');
    let isOn = false, qty = 0, matched = null;
    for (const s of summaries) {
      const m = s.match(rx);
      if (m) { isOn = true; matched = s; qty = m[1] ? +m[1] : 1; break; }
    }

    const onIcon    = this._config.on_icon    || ShoppingListCard.DEFAULT_ON_ICON;
    const offIcon   = this._config.off_icon   || ShoppingListCard.DEFAULT_OFF_ICON;
    const onColorN  = this._config.on_color   || ShoppingListCard.DEFAULT_ON_COLOR;
    const offColorN = this._config.off_color || ShoppingListCard.DEFAULT_OFF_COLOR;
    const onHex     = this._getColorValue(onColorN)  || '#4CAF50';
    const offHex    = this._getColorValue(offColorN) || '#808080';

    const icon    = isOn ? onIcon : offIcon;
    const bg      = isOn ? this._toRgba(onHex, 0.2) : this._toRgba(offHex, 0.2);
    const fg      = isOn ? onHex : offHex;

    let cardBgStyle = '';
    if (isOn && this._config.colorize_background !== false) {
      cardBgStyle = `style="background-color: ${this._toRgba(onHex, 0.1)};"`;
    }

    const isVertical = this._config.layout === 'vertical';
    const layoutClass = isVertical ? 'vertical-layout' : '';

    let mainContent = '';
    let qtyControls = '';
    let topBlock = '';

    if (isVertical) {
        let quantityBadge = '';
        if (isOn && this._config.enable_quantity) {
            quantityBadge = `<span class="quantity-badge">${qty}</span>`;
        }

        let iconElement;
        if (this._config.image) {
            iconElement = `<div class="image-wrapper vertical-image">
                             <img src="${this._config.image}" alt="${this._config.title}" crossorigin="anonymous" onerror="console.error('Failed to load image:', '${this._config.image}'); this.style.display='none'; this.parentElement.classList.add('image-error');" />
                             ${quantityBadge}
                             <div class="icon-wrapper vertical-icon" style="background:${bg}; color:${fg};">
                               <ha-icon icon="${icon}"></ha-icon>
                             </div>
                           </div>`;
        } else {
            iconElement = `<div class="icon-wrapper vertical-icon" style="background:${bg}; color:${fg};">
                             <ha-icon icon="${icon}"></ha-icon>
                             ${quantityBadge}
                           </div>`;
        }

        if (isOn && this._config.enable_quantity) {
            topBlock = `<div class="vertical-icon-container">
                                ${qty > 1 ? `<div class="quantity-btn" data-action="decrement"><ha-icon icon="mdi:minus"></ha-icon></div>` : `<div class="quantity-btn-placeholder"></div>`}
                                ${iconElement}
                                <div class="quantity-btn" data-action="increment"><ha-icon icon="mdi:plus"></ha-icon></div>
                             </div>`;
        } else {
            topBlock = iconElement;
        }
    } else { // Horizontal layout
        if (this._config.image) {
            mainContent = `<div class="image-wrapper">
                             <img src="${this._config.image}" alt="${this._config.title}" crossorigin="anonymous" onerror="console.error('Failed to load image:', '${this._config.image}'); this.style.display='none'; this.parentElement.classList.add('image-error');" />
                             <div class="icon-wrapper" style="background:${bg}; color:${fg};">
                               <ha-icon icon="${icon}"></ha-icon>
                             </div>
                           </div>`;
        } else {
            mainContent = `<div class="icon-wrapper" style="background:${bg}; color:${fg};">
                             <ha-icon icon="${icon}"></ha-icon>
                           </div>`;
        }

        if (isOn && this._config.enable_quantity) {
            qtyControls = `<div class="quantity-controls">
                                ${qty > 1 ? `<div class="quantity-btn" data-action="decrement"><ha-icon icon="mdi:minus"></ha-icon></div>` : ''}
                                <span class="quantity">${qty}</span>
                                <div class="quantity-btn" data-action="increment"><ha-icon icon="mdi:plus"></ha-icon></div>
                             </div>`;
        }
    }

    this.content.innerHTML = `
      <div class="card-container ${isOn?'is-on':'is-off'} ${layoutClass}" ${cardBgStyle}>
        ${isVertical ? `<div class="vertical-top-block">${topBlock}</div>` : mainContent}
        <div class="info-container">
          <div class="primary">${this._config.title}</div>
          ${this._config.subtitle?`<div class="secondary">${this._config.subtitle}</div>`:''}
        </div>
        ${qtyControls}
      </div>
    `;

    this.content.querySelector('.card-container')
      .onclick = ev => this._handleTap(ev, isOn, matched, qty, fullName);
  }

  async _handleTap(ev, isOn, matched, qty, fullName) {
    if (this._isUpdating) return;
    ev.stopPropagation();
    const action = ev.target.closest('.quantity-btn')?.dataset.action;

    this._isUpdating = true;
    this.content.querySelector('.card-container').classList.add('is-updating');

    let call;
    if (action === 'increment') {
      call = this._updateQuantity(matched, qty+1, fullName);
    } else if (action === 'decrement') {
      if (qty>1) call = this._updateQuantity(matched, qty-1, fullName);
    } else {
      if (isOn) {
        if (!this._config.enable_quantity || qty===1) call = this._removeItem(matched);
      } else {
        call = this._addItem(fullName);
      }
    }

    if (call) {
      try {
        await call;
        this._lastUpdated = null;
        await this._render();
      } catch (e) {
        console.error('Service call failed', e);
      }
    }
    this._isUpdating = false;
    this.content.querySelector('.card-container')?.classList.remove('is-updating');
  }

  _addItem(name) {
    return this._hass.callService('todo','add_item',{ entity_id: this._config.todo_list, item: name });
  }

  _removeItem(item) {
    return item
      ? this._hass.callService('todo','remove_item',{ entity_id: this._config.todo_list, item })
      : Promise.resolve();
  }

  _updateQuantity(oldItem,newQty,fullName) {
    const newName = newQty>1 ? `${fullName} (${newQty})` : fullName;
    return this._hass.callService('todo','update_item',{
      entity_id: this._config.todo_list,
      item: oldItem,
      rename: newName,
    });
  }

  _attachStyles() {
    if (this.querySelector('style')) return;
    const s = document.createElement('style');
    s.textContent = `
      ha-card { border-radius: var(--ha-card-border-radius,12px); background: var(--card-background-color); box-shadow: var(--ha-card-box-shadow); overflow:hidden; }
      .card-content { padding:0 !important; }
      .card-container { display:flex; align-items:center; padding:10px 12px; gap:10px; cursor:pointer; transition:background-color .2s; box-sizing: border-box; }
      .card-container:hover { background: var(--secondary-background-color) }

      /* Vertical Layout */
      .card-container.vertical-layout { display: block; height: 120px; position: relative; }
      .vertical-top-block { position: absolute; top: 18px; left: 16px; right: 16px; display: flex; justify-content: center; }
      .vertical-layout .info-container { position: absolute; bottom: 12px; left: 16px; right: 16px; height: 40px; display: flex; flex-direction: column; justify-content: center; }

      .vertical-icon-container { display: flex; align-items: center; justify-content: center; gap: 8px; }

      .icon-wrapper { display:flex; align-items:center; justify-content:center; width:36px; height:36px; border-radius:50%; flex-shrink:0; position: relative; }
      .image-wrapper { position:relative; width:36px; height:36px; flex-shrink:0 }
      .image-wrapper img { width:100%; height:100%; object-fit:cover; border-radius:50% }
      .image-wrapper .icon-wrapper { position:absolute; top:0; left:0; width:100%; height:100%; display:none; }
      .image-wrapper.image-error .icon-wrapper { display:flex; }

      .icon-wrapper.vertical-icon { width: 48px; height: 48px; }
      .icon-wrapper.vertical-icon ha-icon { --mdc-icon-size: 28px; }

      .image-wrapper.vertical-image { width: auto; height: auto; max-height: 48px; position: relative; }
      .image-wrapper.vertical-image img { object-fit: contain; border-radius: 4px; width: auto; height: auto; max-width: 100%; max-height: 48px; }
      .image-wrapper.vertical-image.image-error { width: 48px; height: 48px; }
      .image-wrapper.vertical-image.image-error .icon-wrapper { position: static; }

      .info-container { flex-grow:1; overflow:hidden; min-width:0; }
      .primary { font-size:14px; font-weight:500; line-height:20px; color:var(--primary-text-color); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .secondary { font-size:12px; font-weight:400; line-height:16px; color:var(--secondary-text-color); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .vertical-layout .primary, .vertical-layout .secondary { text-align: center; }

      /* Quantity Controls */
      .quantity-controls { display:flex; align-items:center; gap:4px; flex-shrink:0 }
      .quantity { font-size:14px; font-weight:500; min-width:20px; text-align:center }
      .quantity-btn { width:24px; height:24px; background:rgba(128,128,128,0.2); border-radius:5px; display:flex; align-items:center; justify-content:center; transition: background-color 0.2s; }
      .quantity-btn:hover { background:rgba(128,128,128,0.4); }
      .quantity-btn ha-icon { --mdc-icon-size: 20px; }
      .quantity-badge { position: absolute; top: -4px; right: -4px; background-color: var(--primary-color); color: white; border-radius: 50%; width: 18px; height: 18px; font-size: 11px; display: flex; align-items: center; justify-content: center; font-weight: 500; border: 2px solid var(--card-background-color); }
      .quantity-btn-placeholder { width: 24px; height: 24px; flex-shrink: 0; }

      .warning { padding:12px; background:var(--error-color); color:var(--text-primary-color); border-radius:var(--ha-card-border-radius,12px) }
    `;
    this.appendChild(s);
  }

  getCardSize() {
    if (this._config && this._config.layout === 'vertical') {
      return 3; // A fixed height of 120px usually corresponds to 3 default rows
    }
    return 1;
  }
}
customElements.define('shopping-list-card', ShoppingListCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'shopping-list-card',
  name: 'Shopping List Card',
  preview: true,
  description: 'A card to manage items on a shopping list.',
});
