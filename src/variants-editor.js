class ShoppingListVariantsEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._entries = [];
    this._nextId = 1;
    this._sort = 'none';
    this._textField = !customElements.get('ha-textfield') && customElements.get('ha-input')
      ? 'ha-input' : 'ha-textfield';
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; min-width: 0; container-type: inline-size; }
        * { box-sizing: border-box; }
        .variant-row { padding: 8px 0; border-bottom: 1px solid var(--divider-color, #ddd); }
        .variant-main { display: grid; grid-template-columns: 32px minmax(80px, 1fr) auto; align-items: center; gap: 8px; }
        .variant-preview { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; color: var(--secondary-text-color); }
        .variant-preview img { width: 32px; height: 32px; object-fit: contain; border-radius: 4px; }
        [hidden] { display: none !important; }
        .variant-name { width: 100%; min-width: 0; height: 40px; padding: 8px; font: inherit; font-size: 14px; color: var(--primary-text-color); background: var(--input-fill-color, rgba(127,127,127,.08)); border: 1px solid var(--divider-color, #aaa); border-radius: 4px; }
        .variant-name[aria-invalid="true"] { border-color: var(--error-color, #db4437); }
        .variant-tools { display: flex; gap: 2px; }
        button { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; width: 34px; height: 36px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: var(--primary-text-color); cursor: pointer; }
        button:hover:not(:disabled) { background: var(--secondary-background-color, rgba(127,127,127,.12)); }
        button:disabled { opacity: .35; cursor: default; }
        button:focus-visible, input:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 1px; }
        ha-icon { --mdc-icon-size: 20px; }
        .variant-media { display: grid; gap: 12px; padding: 12px 0 4px 40px; min-width: 0; }
        ha-textfield, ha-input, ha-picture-upload, ha-icon-picker { display: block; width: 100%; min-width: 0; }
        .variant-error { color: var(--error-color, #db4437); font-size: 12px; line-height: 1.5; padding: 4px 0 0 40px; overflow-wrap: anywhere; }
        .add-variant { width: auto; gap: 6px; padding: 0 8px; margin-top: 8px; font: inherit; font-size: 14px; color: var(--primary-color); }
        @container (max-width: 360px) {
          .variant-main { grid-template-columns: 32px minmax(0, 1fr); }
          .variant-tools { grid-column: 2; justify-self: end; }
          .variant-media { padding-left: 0; }
        }
      </style>
      <div class="variant-list" role="list" aria-label="Variants"></div>
      <button type="button" class="add-variant"><ha-icon icon="mdi:plus"></ha-icon>Add variant</button>
    `;
    this._list = this.shadowRoot.querySelector('.variant-list');
    this.shadowRoot.querySelector('.add-variant').addEventListener('click', () => {
      const entry = this._entry('');
      this._entries.push(entry);
      this._renderRows();
      entry.element.querySelector('[data-field="name"]').focus();
      this._validate();
    });
  }

  set hass(hass) {
    this._hass = hass;
    this.shadowRoot.querySelectorAll('ha-icon-picker, ha-picture-upload').forEach(control => {
      control.hass = hass;
    });
  }

  set value(value) {
    const signature = JSON.stringify(value);
    if (signature === this._signature) return;
    this._signature = signature;
    this._value = value;
    const entries = typeof value === 'string'
      ? value.split(/[,\n]/).map(name => name.trim()).filter(Boolean)
      : Array.isArray(value) ? value : [];
    this._entries = entries.map(entry => this._entry(entry));
    this._renderRows();
    this._validate();
  }

  get value() { return this._value; }

  set sort(value) {
    this._sort = value === 'asc' || value === 'desc' ? value : 'none';
    this._updateOrderButtons();
  }

  _entry(value) {
    const object = value !== null && typeof value === 'object';
    return {
      id: this._nextId++,
      object,
      data: object ? { ...value, name: String(value.name ?? '') } : { name: String(value ?? '') },
    };
  }

  _createRow(entry) {
    const row = document.createElement('div');
    row.className = 'variant-row';
    row.setAttribute('role', 'listitem');
    row.dataset.rowId = String(entry.id);
    row.innerHTML = `
      <div class="variant-main">
        <span class="variant-preview" aria-hidden="true"><img alt="" hidden><ha-icon icon="mdi:tag-outline"></ha-icon></span>
        <input class="variant-name" data-field="name" type="text" required aria-label="Variant name" placeholder="Variant name">
        <div class="variant-tools">
          <button type="button" data-action="up" aria-label="Move up" title="Move up"><ha-icon icon="mdi:arrow-up"></ha-icon></button>
          <button type="button" data-action="down" aria-label="Move down" title="Move down"><ha-icon icon="mdi:arrow-down"></ha-icon></button>
          <button type="button" data-action="media" aria-label="Image and icon" title="Image and icon" aria-expanded="false" aria-controls="media-${entry.id}"><ha-icon icon="mdi:chevron-down"></ha-icon></button>
          <button type="button" data-action="remove" aria-label="Remove variant" title="Remove variant"><ha-icon icon="mdi:trash-can-outline"></ha-icon></button>
        </div>
      </div>
      <div class="variant-error" id="error-${entry.id}" role="alert" hidden></div>
      <div class="variant-media" id="media-${entry.id}" hidden>
        <ha-picture-upload data-field="upload"></ha-picture-upload>
        <${this._textField} data-field="image" label="Image URL" placeholder="/local/... or https://..."></${this._textField}>
        <ha-icon-picker data-field="icon" label="Icon"></ha-icon-picker>
      </div>
    `;
    entry.element = row;
    for (const field of ['name', 'image', 'icon']) {
      const control = row.querySelector(`[data-field="${field}"]`);
      control.value = entry.data[field] || '';
      if (field === 'icon') control.hass = this._hass;
      const change = event => {
        event.stopPropagation();
        this._changeField(entry, field, event.detail?.value ?? control.value ?? '');
      };
      for (const event of ['input', 'change', 'value-changed']) control.addEventListener(event, change);
    }
    const name = row.querySelector('[data-field="name"]');
    name.setAttribute('aria-describedby', `error-${entry.id}`);
    const upload = row.querySelector('[data-field="upload"]');
    upload.hass = this._hass;
    upload.original = false;
    upload.crop = undefined;
    upload.value = entry.data.image || '';
    upload.addEventListener('change', event => {
      event.stopPropagation();
      this._changeField(entry, 'image', event.detail?.value ?? upload.value ?? '');
    });
    row.querySelector('img').addEventListener('error', () => {
      row.querySelector('img').hidden = true;
      row.querySelector('.variant-preview ha-icon').hidden = false;
    });
    for (const button of row.querySelectorAll('[data-action]')) {
      button.addEventListener('click', event => {
        event.stopPropagation();
        if (!this._entries.includes(entry)) return;
        const action = button.dataset.action;
        if (action === 'media') {
          const panel = row.querySelector('.variant-media');
          panel.hidden = !panel.hidden;
          button.setAttribute('aria-expanded', String(!panel.hidden));
          button.querySelector('ha-icon').setAttribute('icon', panel.hidden ? 'mdi:chevron-down' : 'mdi:chevron-up');
          return;
        }
        const index = this._entries.indexOf(entry);
        if (action === 'remove') this._entries.splice(index, 1);
        else {
          if (this._sort !== 'none') return;
          const next = index + (action === 'up' ? -1 : 1);
          if (next < 0 || next >= this._entries.length) return;
          this._entries.splice(index, 1);
          this._entries.splice(next, 0, entry);
        }
        this._renderRows();
        this._publish();
        if (action === 'remove') {
          const next = this._entries[Math.min(index, this._entries.length - 1)];
          (next?.element.querySelector('[data-field="name"]') || this.shadowRoot.querySelector('.add-variant')).focus();
        } else button.focus();
      });
    }
    this._updatePreview(entry);
    return row;
  }

  _changeField(entry, field, value) {
    if (!this._entries.includes(entry)) return;
    const text = String(value);
    if ((entry.data[field] || '') === text) return;
    if (field !== 'name' && !text) delete entry.data[field];
    else entry.data[field] = text;
    if (field === 'image') {
      const input = entry.element.querySelector('[data-field="image"]');
      const upload = entry.element.querySelector('[data-field="upload"]');
      if (input.value !== text) input.value = text;
      if (upload.value !== text) upload.value = text;
    }
    if (field !== 'name') this._updatePreview(entry);
    this._publish();
  }

  _updatePreview(entry) {
    const image = entry.element.querySelector('.variant-preview img');
    const icon = entry.element.querySelector('.variant-preview ha-icon');
    const url = entry.data.image || '';
    if (url && image.getAttribute('src') !== url) image.setAttribute('src', url);
    if (!url) image.removeAttribute('src');
    image.hidden = !url;
    icon.hidden = !!url;
    icon.setAttribute('icon', entry.data.icon || 'mdi:tag-outline');
  }

  _renderRows() {
    const current = new Set(this._entries.map(entry => entry.element || this._createRow(entry)));
    for (const row of [...this._list.children]) if (!current.has(row)) row.remove();
    this._entries.forEach((entry, index) => {
      if (this._list.children[index] !== entry.element) {
        this._list.insertBefore(entry.element, this._list.children[index] || null);
      }
    });
    this._updateOrderButtons();
  }

  _updateOrderButtons() {
    this._entries.forEach((entry, index) => {
      entry.element.querySelector('[data-action="up"]').disabled = this._sort !== 'none' || index === 0;
      entry.element.querySelector('[data-action="down"]').disabled = this._sort !== 'none' || index === this._entries.length - 1;
    });
  }

  _validate() {
    const names = this._entries.map(entry => entry.data.name.trim().toLowerCase());
    let valid = true;
    this._entries.forEach((entry, index) => {
      const message = !names[index] ? 'Enter a variant name.'
        : names.indexOf(names[index]) !== names.lastIndexOf(names[index]) ? 'Variant names must be unique.' : '';
      const error = entry.element.querySelector('.variant-error');
      error.textContent = message;
      error.hidden = !message;
      const input = entry.element.querySelector('[data-field="name"]');
      input.setAttribute('aria-invalid', String(!!message));
      input.setCustomValidity(message);
      if (message) valid = false;
    });
    return valid;
  }

  _publish() {
    if (!this._validate()) return;
    const value = this._entries.map(entry => {
      const data = { ...entry.data, name: entry.data.name.trim() };
      return entry.object || Object.keys(data).length > 1 ? data : data.name;
    });
    const signature = JSON.stringify(value);
    if (signature === this._signature) return;
    this._value = value;
    this._signature = signature;
    this.dispatchEvent(new CustomEvent('value-changed', { detail: { value }, bubbles: true, composed: true }));
  }
}

if (!customElements.get('shopping-list-variants-editor')) {
  customElements.define('shopping-list-variants-editor', ShoppingListVariantsEditor);
}