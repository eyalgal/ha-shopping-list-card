class ShoppingListCatalogEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  setConfig(config) {
    this._config = { ...config };
    if (this._rendered) this._updateValues();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._rendered) this._render();
    this.shadowRoot.querySelectorAll('ha-entity-picker').forEach(picker => { picker.hass = hass; });
  }

  _render() {
    const field = !customElements.get('ha-textfield') && customElements.get('ha-input') ? 'ha-input' : 'ha-textfield';
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; min-width: 0; }
        .catalog-form { display: flex; flex-direction: column; gap: 12px; }
        ha-expansion-panel { border: 1px solid var(--divider-color); border-radius: 8px; --expansion-panel-summary-padding: 0 16px; --expansion-panel-content-padding: 0; }
        .catalog-panel { display: grid; gap: 16px; padding: 0 16px 16px; }
        ha-entity-picker, ha-textfield, ha-input, ha-select { display: block; width: 100%; min-width: 0; }
        .catalog-fields { display: flex; gap: 12px; flex-wrap: wrap; }
        .catalog-fields > * { flex: 1 1 120px; min-width: 0; }
        .catalog-toggle { display: flex; align-items: center; gap: 12px; font-size: 14px; color: var(--primary-text-color); }
        .catalog-toggle ha-switch { flex-shrink: 0; }
      </style>
      <div class="catalog-form">
        <ha-expansion-panel header="Catalog" outlined expanded>
          <div class="catalog-panel">
            <ha-entity-picker id="catalog_entity" label="Catalog sensor" required></ha-entity-picker>
            <${field} id="catalog_attribute" label="Catalog attribute (optional)"></${field}>
            <ha-entity-picker id="todo_list" label="To-do list" required></ha-entity-picker>
            <div class="catalog-fields">
              <${field} id="title" label="Title" placeholder="Shopping"></${field}>
              <${field} id="columns" label="Maximum columns" type="number" min="1" max="6"></${field}>
            </div>
          </div>
        </ha-expansion-panel>
        <ha-expansion-panel header="Product defaults" outlined>
          <div class="catalog-panel">
            <ha-select id="layout" label="Layout" naturalMenuWidth fixedMenuPosition>
              <mwc-list-item value="vertical">Vertical</mwc-list-item>
              <mwc-list-item value="horizontal">Horizontal</mwc-list-item>
            </ha-select>
            <${field} id="image_base" label="Image base path" placeholder="/local/images/shopping-list/"></${field}>
            <${field} id="list_prefix" label="List prefix (optional)"></${field}>
            <label class="catalog-toggle"><ha-switch id="enable_quantity"></ha-switch><span>Quantity controls</span></label>
            <div class="catalog-fields">
              <${field} id="quantity_step" label="Quantity step" type="number" min="1"></${field}>
              <${field} id="quantity_max" label="Quantity maximum" type="number" min="1"></${field}>
            </div>
            <label class="catalog-toggle"><ha-switch id="keep_at_zero"></ha-switch><span>Keep items at zero</span></label>
          </div>
        </ha-expansion-panel>
      </div>
    `;
    for (const [id, domain] of [['catalog_entity', 'sensor'], ['todo_list', 'todo']]) {
      const picker = this.shadowRoot.getElementById(id);
      picker.includeDomains = [domain];
      picker.allowCustomEntity = false;
    }
    const layout = this.shadowRoot.getElementById('layout');
    layout.options = [{ value: 'vertical', label: 'Vertical' }, { value: 'horizontal', label: 'Horizontal' }];
    for (const control of this.shadowRoot.querySelectorAll('[id]')) {
      const changed = event => {
        event.stopPropagation();
        let value = event.detail?.value;
        if (control.id === 'layout' && value == null && typeof event.detail?.index === 'number') {
          value = ['vertical', 'horizontal'][event.detail.index];
        }
        if (control.localName === 'ha-switch') value = control.checked;
        this._change(control.id, value ?? control.value);
      };
      for (const event of ['input', 'change', 'value-changed']) control.addEventListener(event, changed);
      if (control.id === 'layout') control.addEventListener('selected', changed);
    }
    this._rendered = true;
    this._updateValues();
  }

  _updateValues() {
    if (!this._config) return;
    const config = this._config;
    const options = config.item_options || {};
    const values = {
      catalog_entity: config.catalog_entity || '', catalog_attribute: config.catalog_attribute || '',
      todo_list: config.todo_list || '', title: config.title || '', columns: config.columns ?? 4,
      layout: options.layout || 'vertical', image_base: options.image_base || '', list_prefix: options.list_prefix || '',
      quantity_step: options.quantity_step ?? 1, quantity_max: options.quantity_max ?? '',
    };
    for (const [id, value] of Object.entries(values)) {
      const control = this.shadowRoot.getElementById(id);
      if (String(control.value ?? '') !== String(value)) control.value = String(value);
    }
    this.shadowRoot.getElementById('enable_quantity').checked = options.enable_quantity !== false;
    this.shadowRoot.getElementById('keep_at_zero').checked = options.remove_zero === false;
  }

  _change(field, value) {
    if (!this._config || value == null) return;
    const config = { ...this._config };
    const defaults = ['layout', 'image_base', 'list_prefix', 'enable_quantity', 'quantity_step', 'quantity_max', 'keep_at_zero'];
    const target = defaults.includes(field) ? { ...(config.item_options || {}) } : config;
    if (defaults.includes(field)) config.item_options = target;
    const key = field === 'keep_at_zero' ? 'remove_zero' : field;
    let next = value;
    if (['columns', 'quantity_step', 'quantity_max'].includes(field)) {
      next = value === '' ? undefined : Number(value);
      if (next !== undefined && (!Number.isInteger(next) || next < 1 || (field === 'columns' && next > 6))) return;
    } else if (field === 'enable_quantity') next = value ? undefined : false;
    else if (field === 'keep_at_zero') next = value ? false : undefined;
    else if (field === 'layout') {
      if (value !== 'vertical' && value !== 'horizontal') return;
      next = value === 'vertical' ? undefined : value;
    } else if (typeof value === 'string') next = value.trim() || undefined;
    if (next === undefined) delete target[key];
    else target[key] = next;
    if (config.item_options && !Object.keys(config.item_options).length) delete config.item_options;
    if (JSON.stringify(config) === JSON.stringify(this._config)) return;
    this._config = config;
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config }, bubbles: true, composed: true }));
  }
}

if (!customElements.get('shopping-list-catalog-card-editor')) {
  customElements.define('shopping-list-catalog-card-editor', ShoppingListCatalogEditor);
}