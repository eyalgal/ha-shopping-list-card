import { getTodoStore } from './todo-store.js';
import { productOnList, readCatalog, searchText } from './catalog-model.js';
import './catalog-editor.js';

class ShoppingListCatalogCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._groups = [];
    this._sections = new Map();
    this._products = new Map();
    this._category = null;
    this._query = '';
    this._onList = false;
    this._store = null;
    this._unsubscribe = null;
    this._snapshot = null;
    this._sourceError = null;
    this._sourceSignature = null;
    this._sourceEntity = null;
    this._needsSource = true;
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; min-width: 0; container-type: inline-size; color: var(--primary-text-color); }
        * { box-sizing: border-box; }
        [hidden] { display: none !important; }
        .catalog-header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
        .catalog-title { flex: 1; margin: 0; min-width: 0; font-size: 20px; line-height: 1.3; font-weight: 500; overflow-wrap: anywhere; }
        .catalog-counter { color: var(--secondary-text-color); font-size: 12px; white-space: nowrap; }
        button { font: inherit; color: inherit; cursor: pointer; }
        button:focus-visible, input:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }
        .catalog-icon-button { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; padding: 0; border: 0; border-radius: 4px; background: transparent; flex-shrink: 0; }
        .catalog-icon-button:hover { background: var(--secondary-background-color); }
        .catalog-toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
        .catalog-search { display: flex; flex: 1 1 180px; align-items: center; min-width: 0; height: 44px; padding-inline: 10px 4px; gap: 8px; border: 1px solid var(--divider-color, #aaa); border-radius: 6px; background: var(--card-background-color); }
        .catalog-search ha-icon { flex-shrink: 0; color: var(--secondary-text-color); --mdc-icon-size: 20px; }
        .catalog-search input { min-width: 0; width: 100%; padding: 8px 0; border: 0; outline: 0; background: transparent; color: var(--primary-text-color); font: inherit; font-size: 14px; }
        .catalog-search:focus-within { outline: 2px solid var(--primary-color); outline-offset: 1px; }
        .catalog-search input::-webkit-search-cancel-button { -webkit-appearance: none; }
        .catalog-on-list { display: inline-flex; align-items: center; gap: 8px; min-height: 40px; font-size: 14px; cursor: pointer; white-space: nowrap; }
        .catalog-on-list input { width: 18px; height: 18px; accent-color: var(--primary-color); }
        .catalog-tabs { display: flex; gap: 2px; overflow-x: auto; margin: 12px 0 0; border-bottom: 1px solid var(--divider-color); scrollbar-width: thin; }
        .catalog-tab { display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; min-height: 44px; padding: 8px 12px; border: 0; border-bottom: 2px solid transparent; background: transparent; font-size: 14px; color: var(--secondary-text-color); white-space: nowrap; }
        .catalog-tab[aria-selected="true"] { color: var(--primary-color); border-bottom-color: var(--primary-color); }
        .catalog-tab-count { font-size: 12px; opacity: .8; }
        .catalog-section { margin: 18px 0 0; }
        .catalog-category-heading { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
        .catalog-category-title { margin: 0; min-width: 0; font-size: 16px; font-weight: 500; line-height: 1.4; overflow-wrap: anywhere; }
        .catalog-category-count { color: var(--secondary-text-color); font-size: 12px; }
        .catalog-grid { display: grid; grid-template-columns: repeat(var(--catalog-columns, 4), minmax(0, 1fr)); gap: 8px; align-items: start; }
        .catalog-grid > shopping-list-card { display: block; min-width: 0; }
        .catalog-grid > shopping-list-card[hidden] { display: none !important; }
        :host([data-sync-state]:not([data-sync-state="ready"])) shopping-list-card .list-status { display: none; }
        .catalog-status:not(:empty) { margin-top: 12px; overflow-wrap: anywhere; }
        .catalog-empty { padding: 24px 0; margin: 0; color: var(--secondary-text-color); font-size: 14px; }
        @container (max-width: 900px) { .catalog-grid { grid-template-columns: repeat(var(--catalog-medium-columns, 3), minmax(0, 1fr)); } }
        @container (max-width: 560px) { .catalog-grid { grid-template-columns: repeat(var(--catalog-mobile-columns, 2), minmax(0, 1fr)); } }
        @container (max-width: 300px) { .catalog-grid { grid-template-columns: minmax(0, 1fr); } .catalog-counter { display: none; } }
      </style>
      <div class="catalog-header">
        <h2 class="catalog-title"></h2>
        <span class="catalog-counter" aria-live="polite"></span>
        <button class="catalog-icon-button catalog-open-list" type="button" aria-label="Open shopping list" title="Open shopping list"><ha-icon icon="mdi:format-list-checks"></ha-icon></button>
      </div>
      <div class="catalog-toolbar">
        <label class="catalog-search"><ha-icon icon="mdi:magnify"></ha-icon><input type="search" aria-label="Search catalog" placeholder="Search products" autocomplete="off"><button class="catalog-icon-button catalog-clear-search" type="button" aria-label="Clear search" title="Clear search" hidden><ha-icon icon="mdi:close"></ha-icon></button></label>
        <label class="catalog-on-list"><input type="checkbox">On list</label>
      </div>
      <div class="catalog-tabs" role="tablist" aria-label="Product categories"></div>
      <div class="catalog-status" role="status" aria-live="polite"></div>
      <div class="catalog-content" id="catalog-content" role="tabpanel"></div>
      <p class="catalog-empty" role="status" hidden></p>
    `;
    this._content = this.shadowRoot.querySelector('.catalog-content');
    this._tabs = this.shadowRoot.querySelector('.catalog-tabs');
    this._status = this.shadowRoot.querySelector('.catalog-status');
    this._search = this.shadowRoot.querySelector('input[type="search"]');
    this._search.addEventListener('input', () => {
      this._query = this._search.value;
      this._applyFilters();
    });
    this.shadowRoot.querySelector('.catalog-clear-search').addEventListener('click', () => {
      this._query = '';
      this._search.value = '';
      this._applyFilters();
      this._search.focus();
    });
    this.shadowRoot.querySelector('.catalog-on-list input').addEventListener('change', event => {
      this._onList = event.target.checked;
      this._applyFilters();
    });
    this.shadowRoot.querySelector('.catalog-open-list').addEventListener('click', () => {
      if (!this._config) return;
      this.dispatchEvent(new CustomEvent('hass-more-info', {
        detail: { entityId: this._config.todo_list }, bubbles: true, composed: true,
      }));
    });
  }

  setConfig(config) {
    if (typeof config.catalog_entity !== 'string' || !/^sensor\.[a-z0-9_]+$/.test(config.catalog_entity)) {
      throw new Error('Select a sensor entity for the catalog.');
    }
    if (typeof config.todo_list !== 'string' || !/^todo\.[a-z0-9_]+$/.test(config.todo_list)) {
      throw new Error('Select a to-do list entity.');
    }
    if (config.catalog_attribute != null && typeof config.catalog_attribute !== 'string') {
      throw new Error('The catalog attribute must be a name.');
    }
    if (config.item_options != null && (typeof config.item_options !== 'object' || Array.isArray(config.item_options))) {
      throw new Error('Item options must be an object.');
    }
    const columns = config.columns ?? 4;
    if (!Number.isInteger(columns) || columns < 1 || columns > 6) throw new Error('Columns must be an integer from 1 to 6.');
    if (this._config?.catalog_entity !== config.catalog_entity || this._config?.catalog_attribute !== config.catalog_attribute) this._category = null;
    this._config = { ...config };
    this._needsSource = true;
    this.style.setProperty('--catalog-columns', String(columns));
    this.style.setProperty('--catalog-medium-columns', String(Math.min(columns, 3)));
    this.style.setProperty('--catalog-mobile-columns', String(Math.min(columns, 2)));
    this.shadowRoot.querySelector('.catalog-title').textContent = config.title || 'Shopping';
    this._update();
  }

  set hass(hass) {
    this._hass = hass;
    this._update();
  }

  connectedCallback() { this._update(); }

  disconnectedCallback() {
    const unsubscribe = this._unsubscribe;
    this._unsubscribe = null;
    this._store = null;
    this._snapshot = null;
    unsubscribe?.();
  }

  _update() {
    if (!this._config || !this._hass) return;
    if (this.isConnected) this._ensureSubscription();
    const entity = this._hass.states?.[this._config.catalog_entity];
    if (this._needsSource || entity !== this._sourceEntity) {
      this._needsSource = false;
      this._sourceEntity = entity;
      try {
        const groups = readCatalog(this._hass, this._config);
        const signature = JSON.stringify(groups);
        this._sourceError = null;
        if (signature !== this._sourceSignature) {
          this._sourceSignature = signature;
          this._reconcile(groups);
        }
      } catch (error) {
        this._sourceError = error.message;
        this._sourceSignature = null;
        this._reconcile([]);
      }
    }
    for (const product of this._products.values()) product.card.hass = this._hass;
    this._renderStatus();
    this._applyFilters();
  }

  _ensureSubscription() {
    if (this._store?.entityId === this._config.todo_list && this._store.connection === this._hass.connection && this._unsubscribe) {
      this._store.updateHass(this._hass);
      return;
    }
    this.disconnectedCallback();
    const store = getTodoStore(this._hass, this._config.todo_list);
    this._store = store;
    this._unsubscribe = store.subscribe(snapshot => {
      if (this._store !== store) return;
      this._snapshot = snapshot;
      this._renderStatus();
      this._applyFilters();
    });
  }

  _reconcile(groups) {
    this._groups = groups;
    if (this._category !== null && !groups.some(group => group.name === this._category)) this._category = null;
    const keepProducts = new Set();
    const keepSections = new Set();
    groups.forEach((group, groupIndex) => {
      keepSections.add(group.name);
      let section = this._sections.get(group.name);
      if (!section) {
        const element = document.createElement('section');
        element.className = 'catalog-section';
        element.innerHTML = '<div class="catalog-category-heading"><h3 class="catalog-category-title"></h3><span class="catalog-category-count"></span></div><div class="catalog-grid"></div>';
        element.querySelector('h3').textContent = group.name;
        section = { element, grid: element.querySelector('.catalog-grid'), count: element.querySelector('.catalog-category-count') };
        this._sections.set(group.name, section);
      }
      if (this._content.children[groupIndex] !== section.element) this._content.insertBefore(section.element, this._content.children[groupIndex] || null);
      group.products.forEach((product, index) => {
        keepProducts.add(product.key);
        let record = this._products.get(product.key);
        if (!record) {
          record = { card: document.createElement('shopping-list-card'), signature: null };
          this._products.set(product.key, record);
        }
        record.product = product;
        const signature = JSON.stringify(product.config);
        if (record.signature !== signature) {
          record.card.setConfig(product.config);
          record.signature = signature;
        }
        record.card.hass = this._hass;
        if (section.grid.children[index] !== record.card) section.grid.insertBefore(record.card, section.grid.children[index] || null);
      });
    });
    for (const [key, record] of this._products) {
      if (!keepProducts.has(key)) { record.card.remove(); this._products.delete(key); }
    }
    for (const [name, section] of this._sections) {
      if (!keepSections.has(name)) { section.element.remove(); this._sections.delete(name); }
    }
    this._renderTabs();
  }

  _renderTabs() {
    const categories = [{ name: null, title: 'All', count: this._products.size }, ...this._groups.map(group => ({ name: group.name, title: group.name, count: group.products.length }))];
    const signature = JSON.stringify(categories);
    if (signature === this._tabSignature) return;
    this._tabSignature = signature;
    this._tabs.replaceChildren();
    categories.forEach((category, index) => {
      const button = document.createElement('button');
      button.className = 'catalog-tab';
      button.type = 'button';
      button.id = `catalog-tab-${index}`;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', 'catalog-content');
      button._category = category.name;
      const title = document.createElement('span');
      title.textContent = category.title;
      const count = document.createElement('span');
      count.className = 'catalog-tab-count';
      count.textContent = String(category.count);
      button.append(title, count);
      button.addEventListener('click', () => { this._category = category.name; this._applyFilters(); });
      button.addEventListener('keydown', event => {
        const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
        if (!keys.includes(event.key)) return;
        event.preventDefault();
        const buttons = [...this._tabs.children];
        const direction = event.key === 'ArrowLeft' ? -1 : 1;
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
          : (buttons.indexOf(button) + direction + buttons.length) % buttons.length;
        buttons[next].click();
        buttons[next].focus();
      });
      this._tabs.append(button);
    });
  }

  _applyFilters() {
    const terms = searchText(this._query).trim().split(/\s+/).filter(Boolean);
    const items = this._snapshot?.items;
    let visible = 0;
    for (const group of this._groups) {
      let count = 0;
      for (const product of group.products) {
        const record = this._products.get(product.key);
        const matches = (this._category === null || this._category === group.name)
          && terms.every(term => product.search.includes(term))
          && (!this._onList || productOnList(product, items));
        if (!matches && !record.card.hidden) record.card._clearHolds?.();
        record.card.hidden = !matches;
        record.card.inert = !matches;
        if (matches) count++;
      }
      const section = this._sections.get(group.name);
      section.element.hidden = count === 0;
      section.count.textContent = String(count);
      visible += count;
    }
    for (const tab of this._tabs.children) {
      const selected = tab._category === this._category;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected) this._content.setAttribute('aria-labelledby', tab.id);
    }
    this.shadowRoot.querySelector('.catalog-counter').textContent = `${visible} / ${this._products.size}`;
    this.shadowRoot.querySelector('.catalog-clear-search').hidden = !this._query;
    const empty = this.shadowRoot.querySelector('.catalog-empty');
    empty.hidden = visible > 0 || !!this._sourceError || !this._hass
      || (this._onList && items === null);
    empty.textContent = !this._products.size ? 'The product catalog is empty.'
      : this._onList ? 'No catalog products match the selected list filters.' : 'No products match your search.';
  }

  _renderStatus() {
    const status = this._snapshot?.status || 'loading';
    this.setAttribute('data-sync-state', status);
    const message = this._sourceError || this._snapshot?.error || (status === 'loading' ? 'Loading shopping list...' : '');
    const key = `${status}|${message}|${!!this._sourceError}`;
    if (key === this._statusKey) return;
    this._statusKey = key;
    this._status.replaceChildren();
    if (!message) return;
    const alert = document.createElement('ha-alert');
    alert.setAttribute('alert-type', this._sourceError || status === 'error' ? 'error' : status === 'loading' ? 'info' : 'warning');
    alert.textContent = message;
    if (!this._sourceError && status !== 'loading') {
      const refresh = document.createElement('button');
      refresh.className = 'catalog-icon-button';
      refresh.type = 'button';
      refresh.setAttribute('aria-label', 'Refresh shopping list');
      refresh.title = 'Refresh shopping list';
      refresh.innerHTML = '<ha-icon icon="mdi:refresh"></ha-icon>';
      refresh.addEventListener('click', () => { void this._store?.refresh().catch(() => {}); });
      alert.append(refresh);
    }
    this._status.append(alert);
  }

  getCardSize() {
    return Math.max(3, 2 + this._groups.reduce((rows, group) => rows + 1 + Math.ceil(group.products.length / (this._config?.columns || 4)) * 2, 0));
  }

  getLayoutOptions() { return { grid_rows: 'auto', grid_columns: 12, grid_min_columns: 4 }; }

  static getConfigElement() { return document.createElement('shopping-list-catalog-card-editor'); }

  static getStubConfig(hass) {
    const entities = Object.entries(hass?.states || {});
    const catalog = entities.find(([entityId, state]) => entityId.startsWith('sensor.')
      && Object.values(state.attributes || {}).some(value => Array.isArray(value) && value.some(entry => typeof entry?.title === 'string')));
    return {
      type: 'custom:shopping-list-catalog-card',
      catalog_entity: catalog?.[0] || '',
      todo_list: entities.find(([entityId]) => entityId.startsWith('todo.'))?.[0] || '',
    };
  }
}

if (!customElements.get('shopping-list-catalog-card')) {
  customElements.define('shopping-list-catalog-card', ShoppingListCatalogCard);
}
window.customCards = window.customCards || [];
if (!window.customCards.some(card => card.type === 'shopping-list-catalog-card')) {
  window.customCards.push({
    type: 'shopping-list-catalog-card', name: 'Shopping Catalog', preview: true,
    description: 'A shared product catalog with categories, search, and shopping-list controls.',
  });
}