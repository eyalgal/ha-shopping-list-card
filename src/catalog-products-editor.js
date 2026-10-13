import { productDefaults } from './catalog-model.js';

export const COMPANION_DOMAIN = 'shopping_list_catalog';

export function isCompanionCatalog(hass, entityId) {
  return hass?.entities?.[entityId]?.platform === COMPANION_DOMAIN;
}

const icon = name => {
  const element = document.createElement('ha-icon');
  element.setAttribute('icon', name);
  return element;
};

function button(label, iconName, className = '', text = false) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  if (iconName) element.append(icon(iconName));
  if (text) element.append(label);
  else {
    element.setAttribute('aria-label', label);
    element.title = label;
  }
  return element;
}

function variantCount(types) {
  const entries = typeof types === 'string' ? types.split(/[,\n]/) : Array.isArray(types) ? types : [];
  return entries.filter(entry => String(typeof entry === 'string' ? entry : entry?.name ?? '').trim()).length;
}

class ShoppingListCatalogProducts extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._nextId = 1;
    this._categories = [];
    this._view = null;
    // Product forms emit config-changed; it must not reach the card editor.
    for (const type of ['config-changed', 'value-changed']) this.addEventListener(type, event => event.stopPropagation());
  }

  set hass(hass) {
    this._hass = hass;
    const editor = this.shadowRoot.querySelector('shopping-list-card-editor');
    if (editor) editor.hass = hass;
  }

  /** Load a companion catalog. config is the card config, used for product defaults. */
  async open(entityId, config) {
    this._entityId = entityId;
    this._defaults = productDefaults(config || {});
    this._view = null;
    this._status = { level: 'info', message: 'Loading products...' };
    this._render();
    await this._load();
  }

  get dirty() {
    return this._loaded && this._signature() !== this._savedSignature;
  }

  async _load() {
    this._loaded = false;
    try {
      const result = await this._hass.callWS({ type: `${COMPANION_DOMAIN}/get`, entity_id: this._entityId });
      this._title = result.title;
      this._path = result.path;
      this._revision = result.revision;
      if (result.error) {
        this._categories = [];
        this._status = { level: 'error', message: `${result.error} Fix the file, then reopen the editor.` };
      } else {
        this._categories = Object.entries(result.catalog || {}).map(([name, products]) => this._category(name, products));
        this._loaded = true;
        this._savedSignature = this._signature();
        this._status = null;
      }
    } catch (error) {
      this._status = { level: 'error', message: error?.message || 'The catalog could not be loaded.' };
    }
    this._view = null;
    this._render();
  }

  _category(name, products = []) {
    return { id: this._nextId++, name, products: products.map(data => ({ id: this._nextId++, data })) };
  }

  _catalog() {
    return Object.fromEntries(this._categories.map(category => [category.name.trim(), category.products.map(product => product.data)]));
  }

  _signature() {
    return JSON.stringify(this._categories.map(category => [category.name.trim(), category.products.map(product => product.data)]));
  }

  _problems() {
    const problems = new Map();
    const names = this._categories.map(category => category.name.trim());
    this._categories.forEach((category, index) => {
      const name = names[index];
      if (!name) problems.set(category.id, 'Enter a category name.');
      else if (names.indexOf(name) !== index) problems.set(category.id, 'Category names must be unique.');
      for (const product of category.products) {
        if (typeof product.data.title !== 'string' || !product.data.title.trim()) problems.set(product.id, 'Enter a title.');
      }
    });
    return problems;
  }

  _render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; min-width: 0; container-type: inline-size; }
        * { box-sizing: border-box; }
        [hidden] { display: none !important; }
        .products-header { display: flex; align-items: center; gap: 8px; min-height: 40px; margin-bottom: 8px; }
        .products-title { flex: 1; min-width: 0; font-size: 16px; font-weight: 500; color: var(--primary-text-color); overflow-wrap: anywhere; }
        .products-path { margin: 0 0 12px; font-size: 12px; color: var(--secondary-text-color); overflow-wrap: anywhere; }
        ha-alert { display: block; margin-bottom: 12px; }
        .category { border: 1px solid var(--divider-color); border-radius: 8px; padding: 8px 8px 4px 12px; margin-bottom: 12px; }
        .category-head, .product { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px; }
        .product { grid-template-columns: 32px minmax(0, 1fr) auto; padding: 4px 0; border-top: 1px solid var(--divider-color); }
        .category-head { padding-bottom: 4px; }
        input.category-name, select { width: 100%; min-width: 0; height: 40px; padding: 8px; font: inherit; font-size: 14px; font-weight: 500; color: var(--primary-text-color); background: var(--input-fill-color, rgba(127,127,127,.08)); border: 1px solid var(--divider-color, #aaa); border-radius: 4px; }
        select { font-weight: 400; }
        [aria-invalid="true"] { border-color: var(--error-color, #db4437); }
        .problem { color: var(--error-color, #db4437); font-size: 12px; padding: 2px 0 4px; }
        .tools { display: flex; gap: 2px; }
        button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; flex-shrink: 0; min-width: 34px; height: 36px; padding: 0 6px; border: 0; border-radius: 4px; background: transparent; color: var(--primary-text-color); font: inherit; font-size: 14px; cursor: pointer; }
        button:hover:not(:disabled) { background: var(--secondary-background-color, rgba(127,127,127,.12)); }
        button:disabled { opacity: .35; cursor: default; }
        button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 1px; }
        ha-icon { --mdc-icon-size: 20px; }
        .product-open { justify-content: flex-start; height: auto; min-height: 40px; padding: 4px 6px; text-align: start; }
        .product-text { display: flex; flex-direction: column; min-width: 0; }
        .product-name, .product-meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .product-meta { font-size: 12px; color: var(--secondary-text-color); }
        .product-preview { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; color: var(--secondary-text-color); }
        .product-preview img { width: 32px; height: 32px; object-fit: contain; border-radius: 4px; }
        .link { color: var(--primary-color); padding: 0 8px; }
        .danger { color: var(--error-color, #db4437); }
        .product-category { display: grid; gap: 4px; margin-bottom: 12px; font-size: 13px; color: var(--secondary-text-color); }
        .footer { position: sticky; bottom: 0; display: flex; justify-content: flex-end; align-items: center; gap: 8px; padding: 12px 0 4px; margin-top: 8px; background: var(--card-background-color, var(--primary-background-color)); border-top: 1px solid var(--divider-color); }
        .footer-message { flex: 1; min-width: 0; font-size: 13px; color: var(--secondary-text-color); }
        .save { padding: 0 16px; background: var(--primary-color); color: var(--text-primary-color, #fff); font-weight: 500; }
        .save:hover:not(:disabled) { background: var(--primary-color); filter: brightness(1.08); }
        @container (max-width: 360px) {
          .product { grid-template-columns: 32px minmax(0, 1fr); }
          .product .tools { grid-column: 2; justify-self: end; }
        }
      </style>
      <div class="products-header"></div>
      <p class="products-path" hidden></p>
      <ha-alert role="status" aria-live="polite" hidden></ha-alert>
      <div class="products-body"></div>
      <div class="footer" hidden>
        <span class="footer-message" role="status" aria-live="polite"></span>
        <button type="button" class="discard">Discard changes</button>
        <button type="button" class="save">Save products</button>
      </div>
    `;
    const header = this.shadowRoot.querySelector('.products-header');
    const back = button(this._view ? 'Products' : 'Card settings', 'mdi:arrow-left', 'back', true);
    back.addEventListener('click', () => (this._view ? this._showList() : this._close()));
    const title = document.createElement('span');
    title.className = 'products-title';
    title.textContent = this._view ? 'Edit product' : `Products${this._title ? `: ${this._title}` : ''}`;
    header.append(back, title);
    if (this._path && !this._view) {
      const path = this.shadowRoot.querySelector('.products-path');
      path.textContent = `Saved to ${this._path} in your configuration folder.`;
      path.hidden = false;
    }
    this.shadowRoot.querySelector('.discard').addEventListener('click', () => this._discard());
    this.shadowRoot.querySelector('.save').addEventListener('click', () => this._save());
    if (this._loaded) {
      if (this._view) this._renderProduct();
      else this._renderList();
      this.shadowRoot.querySelector('.footer').hidden = false;
    }
    this._renderStatus();
  }

  _renderList() {
    const body = this.shadowRoot.querySelector('.products-body');
    const problems = this._problems();
    this._categories.forEach((category, index) => {
      const section = document.createElement('section');
      section.className = 'category';
      section.dataset.category = String(category.id);
      const head = document.createElement('div');
      head.className = 'category-head';
      const name = document.createElement('input');
      name.className = 'category-name';
      name.type = 'text';
      name.value = category.name;
      name.placeholder = 'Category name';
      name.setAttribute('aria-label', 'Category name');
      name.addEventListener('input', () => {
        category.name = name.value;
        this._updateProblems();
      });
      const tools = document.createElement('div');
      tools.className = 'tools';
      tools.append(...this._orderButtons(this._categories, index, 'category'));
      const remove = button('Delete category', 'mdi:trash-can-outline', 'delete-category');
      remove.addEventListener('click', () => {
        const count = category.products.length;
        if (count && !window.confirm(`Delete "${category.name.trim() || 'this category'}" and its ${count} ${count === 1 ? 'product' : 'products'}?`)) return;
        this._categories.splice(this._categories.indexOf(category), 1);
        this._rerender();
      });
      tools.append(remove);
      head.append(name, tools);
      const problem = document.createElement('div');
      problem.className = 'problem';
      problem.dataset.problemFor = String(category.id);
      section.append(head, problem);
      category.products.forEach((product, productIndex) => section.append(this._productRow(category, product, productIndex)));
      const add = button('Add product', 'mdi:plus', 'link add-product', true);
      add.addEventListener('click', () => {
        const product = { id: this._nextId++, data: { title: '' } };
        category.products.push(product);
        this._showProduct(product.id);
      });
      section.append(add);
      body.append(section);
    });
    if (!this._categories.length) {
      const empty = document.createElement('p');
      empty.className = 'products-path';
      empty.textContent = 'No categories yet.';
      body.append(empty);
    }
    const addCategory = button('Add category', 'mdi:folder-plus-outline', 'link add-category', true);
    addCategory.addEventListener('click', () => {
      this._categories.push(this._category(''));
      this._rerender();
      const inputs = this.shadowRoot.querySelectorAll('input.category-name');
      inputs[inputs.length - 1]?.focus();
    });
    body.append(addCategory);
    this._updateProblems(problems);
  }

  _productRow(category, product, index) {
    const row = document.createElement('div');
    row.className = 'product';
    row.dataset.product = String(product.id);
    const preview = document.createElement('span');
    preview.className = 'product-preview';
    preview.setAttribute('aria-hidden', 'true');
    const data = { ...this._defaults, ...product.data };
    if (typeof data.image === 'string' && data.image) {
      const image = document.createElement('img');
      image.alt = '';
      image.src = data.image;
      image.addEventListener('error', () => image.replaceWith(icon(data.off_icon || 'mdi:tag-outline')));
      preview.append(image);
    } else preview.append(icon(data.off_icon || 'mdi:tag-outline'));
    const open = button('', null, 'product-open', true);
    const text = document.createElement('span');
    text.className = 'product-text';
    const name = document.createElement('span');
    name.className = 'product-name';
    name.textContent = String(product.data.title ?? '').trim() || 'Untitled product';
    const meta = document.createElement('span');
    meta.className = 'product-meta';
    const variants = variantCount(product.data.types);
    meta.textContent = [product.data.subtitle, variants ? `${variants} ${variants === 1 ? 'variant' : 'variants'}` : '']
      .filter(Boolean).join(' \u00b7 ');
    text.append(name, meta);
    open.append(text);
    open.setAttribute('aria-label', `Edit ${name.textContent}`);
    open.addEventListener('click', () => this._showProduct(product.id));
    const tools = document.createElement('div');
    tools.className = 'tools';
    tools.append(...this._orderButtons(category.products, index, 'product'));
    const remove = button('Delete product', 'mdi:trash-can-outline', 'delete-product');
    remove.addEventListener('click', () => {
      category.products.splice(category.products.indexOf(product), 1);
      this._rerender();
    });
    tools.append(remove);
    row.append(preview, open, tools);
    const problem = document.createElement('div');
    problem.className = 'problem';
    problem.dataset.problemFor = String(product.id);
    problem.style.gridColumn = '2 / -1';
    row.append(problem);
    return row;
  }

  _orderButtons(list, index, kind) {
    return [['up', -1, 'mdi:arrow-up'], ['down', 1, 'mdi:arrow-down']].map(([direction, offset, iconName]) => {
      const control = button(`Move ${kind} ${direction}`, iconName, `move-${direction}`);
      control.disabled = index + offset < 0 || index + offset >= list.length;
      control.addEventListener('click', () => {
        const [entry] = list.splice(index, 1);
        list.splice(index + offset, 0, entry);
        this._rerender();
        this.shadowRoot.querySelector(`[data-${kind}="${entry.id}"] .move-${direction}:not(:disabled)`)?.focus();
      });
      return control;
    });
  }

  _renderProduct() {
    const category = this._categories.find(entry => entry.products.some(product => product.id === this._view));
    const product = category?.products.find(entry => entry.id === this._view);
    if (!product) return this._showList();
    const body = this.shadowRoot.querySelector('.products-body');
    const label = document.createElement('label');
    label.className = 'product-category';
    label.append('Category');
    const select = document.createElement('select');
    select.className = 'category-select';
    for (const entry of this._categories) {
      const option = document.createElement('option');
      option.value = String(entry.id);
      option.textContent = entry.name.trim() || 'Unnamed category';
      select.append(option);
    }
    select.addEventListener('change', () => {
      const current = this._categories.find(entry => entry.products.includes(product));
      const target = this._categories.find(entry => String(entry.id) === select.value);
      if (!current || !target || current === target) return;
      current.products.splice(current.products.indexOf(product), 1);
      target.products.push(product);
      this._updateFooter();
    });
    label.append(select);
    const editor = document.createElement('shopping-list-card-editor');
    editor.productDefaults = this._defaults;
    editor.setConfig(product.data);
    editor.hass = this._hass;
    editor.addEventListener('config-changed', event => {
      event.stopPropagation();
      product.data = event.detail.config;
      this._updateFooter();
    });
    const remove = button('Delete product', 'mdi:trash-can-outline', 'danger delete-product', true);
    remove.addEventListener('click', () => {
      const current = this._categories.find(entry => entry.products.includes(product));
      current?.products.splice(current.products.indexOf(product), 1);
      this._showList();
    });
    body.append(label, editor, remove);
    select.value = String(category.id);
    this._updateFooter();
  }

  _showProduct(id) {
    this._view = id;
    this._render();
    const editor = this.shadowRoot.querySelector('shopping-list-card-editor');
    editor?.shadowRoot?.querySelector('#title')?.focus();
  }

  _showList() {
    const id = this._view;
    this._view = null;
    this._render();
    this.shadowRoot.querySelector(`[data-product="${id}"] .product-open`)?.focus();
  }

  _rerender() {
    this._render();
  }

  _updateProblems(problems = this._problems()) {
    for (const element of this.shadowRoot.querySelectorAll('[data-problem-for]')) {
      const message = problems.get(Number(element.dataset.problemFor)) || '';
      element.textContent = message;
      element.hidden = !message;
    }
    for (const section of this.shadowRoot.querySelectorAll('section.category')) {
      section.querySelector('input.category-name')
        .setAttribute('aria-invalid', String(problems.has(Number(section.dataset.category))));
    }
    this._updateFooter(problems);
  }

  _updateFooter(problems = this._problems()) {
    const footer = this.shadowRoot.querySelector('.footer');
    if (!footer || !this._loaded) return;
    const dirty = this.dirty;
    const message = footer.querySelector('.footer-message');
    const save = footer.querySelector('.save');
    message.textContent = this._saving ? 'Saving...'
      : problems.size ? `Fix ${problems.size} ${problems.size === 1 ? 'problem' : 'problems'} before saving.`
        : dirty ? 'Unsaved changes' : this._savedAt ? 'All changes saved' : '';
    save.disabled = this._saving || !dirty || problems.size > 0;
    footer.querySelector('.discard').disabled = this._saving || !dirty;
  }

  _renderStatus() {
    const alert = this.shadowRoot.querySelector('ha-alert');
    alert.hidden = !this._status;
    if (!this._status) return;
    alert.setAttribute('alert-type', this._status.level);
    alert.textContent = this._status.message;
    if (this._status.reload) {
      const reload = button('Reload', 'mdi:refresh', 'link reload', true);
      reload.addEventListener('click', () => this._load());
      alert.append(document.createElement('br'), reload);
    }
  }

  async _save() {
    if (!this.dirty || this._saving || this._problems().size) return;
    this._saving = true;
    this._updateFooter();
    const signature = this._signature();
    try {
      const result = await this._hass.callWS({
        type: `${COMPANION_DOMAIN}/save`, entity_id: this._entityId, catalog: this._catalog(), revision: this._revision,
      });
      this._revision = result.revision;
      this._savedSignature = signature;
      this._savedAt = Date.now();
      this._status = null;
    } catch (error) {
      this._status = error?.code === 'conflict'
        ? { level: 'error', message: 'The catalog was changed somewhere else after you opened it. Reload to get the latest version; your unsaved changes here will be lost.', reload: true }
        : { level: 'error', message: error?.message || 'The catalog could not be saved.' };
    }
    this._saving = false;
    this._renderStatus();
    this._updateFooter();
  }

  _discard() {
    if (!this.dirty || !window.confirm('Discard unsaved product changes?')) return;
    this._load();
  }

  _close() {
    if (this.dirty && !window.confirm('Discard unsaved product changes?')) return;
    this.dispatchEvent(new CustomEvent('catalog-products-closed'));
  }
}

if (!customElements.get('shopping-list-catalog-products')) {
  customElements.define('shopping-list-catalog-products', ShoppingListCatalogProducts);
}
