import { CARD_DEFAULTS } from './card-defaults.js';
import './variants-editor.js';
import './catalog-editor.js';

class ShoppingListCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._rendered = false;
    this._hasInitialized = false;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._rendered) { this._render(); return; }
    if (this._catalogEditor) {
      this._catalogEditor.hass = hass;
      return;
    }
    this.shadowRoot.querySelectorAll(
      'ha-entity-picker, ha-icon-picker, ha-picture-upload, shopping-list-variants-editor'
    ).forEach(el => { el.hass = hass; });
  }

  setConfig(config) {
    const previousMode = this._config?.mode || 'single';
    this._config = { ...config };
    if (!this._rendered) return;
    if (previousMode !== (config.mode || 'single')) this._render();
    else if (this._catalogEditor) this._catalogEditor.setConfig(this._config);
    else this._updateFormValues();
  }

  _render() {
    if (!this.shadowRoot || !this._hass) return;
    if (this._config?.mode === 'catalog') {
      this._renderCatalog();
      return;
    }
    this._catalogEditor = null;

    const todoEntities = Object.keys(this._hass.states).filter(id => id.startsWith('todo.'));
    const hasTodoEntities = todoEntities.length > 0;

    // HA 2026.x removed `ha-textfield` (replaced by web-awesome based
    // `ha-input`). Prefer the legacy element when it is still registered for
    // backward compatibility, otherwise fall back to `ha-input`. Both expose a
    // `.value` property and emit native input/change events, and both ignore
    // each other's helper attribute (`helper` vs `hint`), so we set both.
    const TF = (!customElements.get('ha-textfield') && customElements.get('ha-input'))
      ? 'ha-input' : 'ha-textfield';

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        .card-config { display: flex; flex-direction: column; gap: 12px; }
        ha-expansion-panel {
          --expansion-panel-summary-padding: 0 16px;
          --expansion-panel-content-padding: 0;
          border: 1px solid var(--divider-color);
          border-radius: 8px;
          background: var(--card-background-color);
          overflow: hidden;
        }
        .panel-body {
          padding: 0 16px 16px 16px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .row { display: flex; gap: 12px; }
        .row > * { flex: 1; min-width: 0; }
        ha-textfield,
        ha-input,
        ha-entity-picker,
        ha-icon-picker,
        ha-select,
        ha-picture-upload { width: 100%; display: block; }
        .toggle-row {
          display: flex; align-items: center; gap: 16px;
          padding: 4px 0;
          cursor: pointer;
          user-select: none;
        }
        .toggle-row ha-switch { flex-shrink: 0; }
        .toggle-text { display: flex; flex-direction: column; flex: 1; min-width: 0; }
        .toggle-title {
          font-size: 14px; font-weight: 500;
          color: var(--primary-text-color);
        }
        .toggle-desc {
          font-size: 12px; line-height: 1.4;
          color: var(--secondary-text-color); margin-top: 2px;
        }
        .color-group { display: flex; flex-direction: column; gap: 8px; }
        .color-group-label {
          font-size: 13px; font-weight: 500;
          color: var(--secondary-text-color);
          text-transform: uppercase; letter-spacing: 0.04em;
          margin-bottom: -4px;
        }
        .color-row {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 8px; align-items: center;
        }
        .swatch {
          width: 40px; height: 40px; padding: 0;
          border: 1px solid var(--divider-color);
          border-radius: 6px; cursor: pointer; background: none;
          flex-shrink: 0;
        }
        .hint {
          font-size: 12px; line-height: 1.4;
          color: var(--secondary-text-color);
        }
        .hint code {
          background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.08);
          padding: 1px 4px; border-radius: 3px;
          font-size: 11px;
        }
        .info-box {
          background: var(--warning-color);
          color: var(--primary-background-color);
          padding: 10px 14px; border-radius: 8px;
          font-size: 13px; line-height: 1.5;
        }
        .info-box a { color: inherit; text-decoration: underline; }
        .image-fallback {
          display: flex; flex-direction: column; gap: 6px;
        }
        .types-field { display: flex; flex-direction: column; gap: 6px; }
        .types-label {
          font-size: 13px; font-weight: 500;
          color: var(--secondary-text-color);
        }
      </style>

      <div class="card-config">
        ${!hasTodoEntities ? `
          <div class="info-box">
            <strong>No to-do lists found.</strong>
            You need a to-do entity before this card will work.
            <a href="https://www.home-assistant.io/integrations/todo/" target="_blank" rel="noopener">Learn more</a>
          </div>
        ` : ''}

        <ha-expansion-panel outlined expanded header="Content" data-panel="content">
          <div class="panel-body">
            <ha-entity-picker id="todo_list" label="To-do list entity" required></ha-entity-picker>
            <div class="row">
              <${TF} id="title" label="Title" required></${TF}>
              <${TF} id="subtitle" label="Subtitle"></${TF}>
            </div>
            <div class="types-field">
              <span class="types-label">Variants</span>
              <shopping-list-variants-editor id="types"></shopping-list-variants-editor>
            </div>
            <ha-select id="types_sort" label="Sort types" naturalMenuWidth fixedMenuPosition>
              <mwc-list-item value="none">As listed</mwc-list-item>
              <mwc-list-item value="asc">Alphabetical (A-Z)</mwc-list-item>
              <mwc-list-item value="desc">Alphabetical (Z-A)</mwc-list-item>
            </ha-select>
            <ha-picture-upload id="image_upload"></ha-picture-upload>
            <div class="image-fallback">
              <${TF} id="image" label="Image URL (optional)" placeholder="/local/... or https://..."></${TF}>
              <${TF} id="image_base" label="Image base path (optional)" placeholder="/local/images/shopping-list/"></${TF}>
              <div class="hint">Upload an image above or paste a URL. Or set a base path and the card will try <code>title.png</code> in several variants (dash, underscore, space, joined) from the title.</div>
            </div>
            <${TF} id="list_prefix" label="List prefix (optional)" placeholder="e.g. Dairy" helper="Stored in the list as 'Prefix - Title' for category sorting; display is unchanged." hint="Stored in the list as 'Prefix - Title' for category sorting; display is unchanged."></${TF}>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined header="Layout &amp; Display" data-panel="layout">
          <div class="panel-body">
            <ha-select id="layout" label="Layout" naturalMenuWidth fixedMenuPosition>
              <mwc-list-item value="horizontal">Horizontal</mwc-list-item>
              <mwc-list-item value="vertical">Vertical</mwc-list-item>
            </ha-select>
            <label class="toggle-row">
              <ha-switch id="show_name"></ha-switch>
              <div class="toggle-text">
                <span class="toggle-title">Show title and subtitle</span>
                <span class="toggle-desc">Turn off for an icon-only card.</span>
              </div>
            </label>
            <label class="toggle-row">
              <ha-switch id="colorize_background"></ha-switch>
              <div class="toggle-text">
                <span class="toggle-title">Tint background when on</span>
                <span class="toggle-desc">Subtle wash of the on-color across the card.</span>
              </div>
            </label>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined header="Icons &amp; Colors" data-panel="icons">
          <div class="panel-body">
            <div class="color-group">
              <span class="color-group-label">Off state</span>
              <ha-icon-picker id="off_icon" label="Off icon"></ha-icon-picker>
              <div class="color-row">
                <${TF} id="off_color" label="Off color"></${TF}>
                <input type="color" class="swatch" id="off_color_picker" title="Pick off color" />
              </div>
            </div>
            <div class="color-group">
              <span class="color-group-label">On state</span>
              <ha-icon-picker id="on_icon" label="On icon"></ha-icon-picker>
              <div class="color-row">
                <${TF} id="on_color" label="On color"></${TF}>
                <input type="color" class="swatch" id="on_color_picker" title="Pick on color" />
              </div>
            </div>
            <div class="hint">
              Use an HA color name (<code>red</code>, <code>blue</code>, <code>green</code>...) to follow the theme, or a <code>#hex</code> value.
            </div>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined header="Behavior" data-panel="behavior">
          <div class="panel-body">
            <label class="toggle-row">
              <ha-switch id="enable_quantity"></ha-switch>
              <div class="toggle-text">
                <span class="toggle-title">Enable quantity</span>
                <span class="toggle-desc">Show + / - buttons to track how many of this item you need.</span>
              </div>
            </label>
            <div class="row">
              <${TF} id="quantity_step" label="Quantity step" type="number" min="1" max="99" helper="How much +/- adjusts" hint="How much +/- adjusts"></${TF}>
              <${TF} id="quantity_max" label="Quantity max" type="number" min="1" max="999" helper="Optional cap" hint="Optional cap"></${TF}>
            </div>
            <label class="toggle-row">
              <ha-switch id="keep_at_zero"></ha-switch>
              <div class="toggle-text">
                <span class="toggle-title">Keep item at zero</span>
                <span class="toggle-desc">Keep the item as "Name (0)" instead of deleting it, and always show the quantity in parentheses.</span>
              </div>
            </label>
            <ha-select id="hold_action" label="Hold action" naturalMenuWidth fixedMenuPosition>
              <mwc-list-item value="default">Remove item (default)</mwc-list-item>
              <mwc-list-item value="more-info">Open more-info</mwc-list-item>
              <mwc-list-item value="none">None</mwc-list-item>
            </ha-select>
            <label class="toggle-row">
              <ha-switch id="haptic"></ha-switch>
              <div class="toggle-text">
                <span class="toggle-title">Haptic feedback</span>
                <span class="toggle-desc">Short vibration on tap and hold (mobile only).</span>
              </div>
            </label>
          </div>
        </ha-expansion-panel>
      </div>
    `;

    this._renderModeSelector();

    // Wire hass-consuming components
    const ep = this.shadowRoot.querySelector('#todo_list');
    ep.hass = this._hass;
    ep.includeDomains = ['todo'];
    ep.allowCustomEntity = false;
    this.shadowRoot.querySelectorAll('ha-icon-picker').forEach(el => { el.hass = this._hass; });

    // Trigger lazy-loading of ha-picture-upload if HA hasn't loaded it yet.
    this._ensurePictureUploadLoaded();
    const pu = this.shadowRoot.querySelector('#image_upload');
    if (pu) {
      pu.hass = this._hass;
      pu.original = false;
      pu.crop = undefined;
      pu.addEventListener('change', () => {
        if (this.shadowRoot.querySelector('#image_upload') !== pu) return;
        const tf = this.shadowRoot.querySelector('#image');
        tf.value = pu.value || '';
        this._handleConfigChanged();
      });
    }

    // Field change listeners (non-select)
    this.shadowRoot.querySelectorAll(
      'ha-textfield, ha-input, ha-switch, ha-entity-picker, ha-icon-picker'
    ).forEach(el => {
      const handler = () => this._handleConfigChanged();
      el.addEventListener('input', handler);
      el.addEventListener('change', handler);
      el.addEventListener('value-changed', handler);
    });

    const typesEl = this.shadowRoot.querySelector('#types');
    typesEl.hass = this._hass;
    typesEl.addEventListener('value-changed', event => {
      event.stopPropagation();
      if (this.shadowRoot.querySelector('#types') !== typesEl) return;
      const config = { ...this._config };
      if (event.detail.value.length) config.types = event.detail.value;
      else delete config.types;
      this._emitConfig(config);
    });

    // ha-select needs special handling. In HA 2026.x, ha-select was rewritten
    // to use ha-dropdown internally and IGNORES slotted <mwc-list-item>
    // children - it only renders from the `.options` property. Older HA uses
    // slotted children and fires `selected` with ev.detail.index (not value).
    // We set `.options` for the new component and keep the children for the
    // old one, then normalize the event shape.
    const SELECT_OPTIONS = {
      layout: [
        { value: 'horizontal', label: 'Horizontal' },
        { value: 'vertical', label: 'Vertical' },
      ],
      hold_action: [
        { value: 'default', label: 'Remove item (default)' },
        { value: 'more-info', label: 'Open more-info' },
        { value: 'none', label: 'None' },
      ],
      types_sort: [
        { value: 'none', label: 'As listed' },
        { value: 'asc', label: 'Alphabetical (A-Z)' },
        { value: 'desc', label: 'Alphabetical (Z-A)' },
      ],
    };
    this.shadowRoot.querySelectorAll('ha-select').forEach(el => {
      const opts = SELECT_OPTIONS[el.id];
      if (opts) {
        try { el.options = opts; } catch (_) {}
      }
      const capture = (ev) => {
        ev.stopPropagation();
        let v = ev?.detail?.value;
        // Older mwc-select fires `selected` with ev.detail.index. Map it.
        if ((v == null || v === '') && ev?.detail && typeof ev.detail.index === 'number' && opts) {
          v = opts[ev.detail.index]?.value;
        }
        // Final fallback: whatever the element itself reports.
        if (v == null || v === '') v = el.value;
        if (typeof v === 'string' && v !== '') {
          el._slcValue = v;
          try { if (el.value !== v) el.value = v; } catch (_) {}
        }
        this._handleConfigChanged();
      };
      el.addEventListener('selected', capture);
      el.addEventListener('change', capture);
      el.addEventListener('closed', (e) => e.stopPropagation());
    });

    // Color swatch <-> textfield sync
    ['off', 'on'].forEach(type => {
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

  _renderCatalog() {
    this.shadowRoot.innerHTML = '<style>:host { display: block; min-width: 0; } shopping-list-catalog-editor { display: block; min-width: 0; }</style>';
    const editor = document.createElement('shopping-list-catalog-editor');
    this._catalogEditor = editor;
    editor.setConfig(this._config);
    editor.hass = this._hass;
    editor.addEventListener('config-changed', event => {
      event.stopPropagation();
      if (this._catalogEditor !== editor) return;
      this._emitConfig({ ...event.detail.config, type: 'custom:shopping-list-card', mode: 'catalog' });
    });
    this.shadowRoot.append(editor);
    this._renderModeSelector();
    this._rendered = true;
  }

  _renderModeSelector() {
    const container = document.createElement('div');
    container.innerHTML = `
      <style>
        .card-mode { min-width: 0; padding: 0; margin: 0 0 16px; border: 0; }
        .card-mode legend { padding: 0 0 8px; color: var(--primary-text-color); font-size: 14px; font-weight: 500; }
        .card-mode-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px; padding: 2px; border: 1px solid var(--divider-color, #aaa); border-radius: 6px; background: var(--secondary-background-color); }
        .card-mode label { position: relative; cursor: pointer; min-width: 0; }
        .card-mode input { position: absolute; width: 1px; height: 1px; opacity: 0; }
        .card-mode span { display: flex; align-items: center; justify-content: center; height: 40px; border-radius: 4px; font-size: 14px; color: var(--primary-text-color); }
        .card-mode input:checked + span { background: var(--primary-color, #03a9f4); color: var(--text-primary-color, #fff); }
        .card-mode input:focus-visible + span { outline: 2px solid var(--primary-color); outline-offset: 2px; }
      </style>
      <fieldset class="card-mode">
        <legend>Card mode</legend>
        <div class="card-mode-options">
          <label><input type="radio" name="card-mode" value="single"><span>Single</span></label>
          <label><input type="radio" name="card-mode" value="catalog"><span>Catalog</span></label>
        </div>
      </fieldset>
    `;
    const mode = this._config?.mode || 'single';
    for (const radio of container.querySelectorAll('input')) {
      radio.checked = radio.value === mode;
      radio.addEventListener('change', () => {
        if (radio.checked) this._changeMode(radio.value);
      });
    }
    this.shadowRoot.prepend(container);
  }

  _changeMode(mode) {
    if (mode === (this._config?.mode || 'single')) return;
    const config = { ...this._config, type: 'custom:shopping-list-card', mode };
    if (mode === 'catalog') {
      const defaults = customElements.get('shopping-list-catalog').getStubConfig(this._hass);
      if (!config.catalog_entity && defaults.catalog_entity) config.catalog_entity = defaults.catalog_entity;
      if (!config.todo_list && defaults.todo_list) config.todo_list = defaults.todo_list;
    }
    this.setConfig(config);
    this._emitConfig(config);
    this.shadowRoot.querySelector(`.card-mode input[value="${mode}"]`).focus();
  }

  /**
   * Force-load ha-picture-upload by creating a hidden ha-form whose schema
   * uses the image-upload media selector. HA lazy-loads ha-picture-upload
   * the first time that selector is rendered, after which the browser will
   * upgrade our existing <ha-picture-upload> placeholder.
   */
  _ensurePictureUploadLoaded() {
    if (customElements.get('ha-picture-upload')) return;
    try {
      const loader = document.createElement('ha-form');
      loader.style.display = 'none';
      loader.schema = [{
        name: 'image',
        selector: { media: { accept: ['image/*'], image_upload: true, clearable: true, hide_content_type: true } },
      }];
      loader.data = {};
      loader.hass = this._hass;
      this.shadowRoot.appendChild(loader);
      customElements.whenDefined('ha-picture-upload').then(() => {
        const pu = this.shadowRoot.querySelector('#image_upload');
        if (pu) {
          pu.hass = this._hass;
          if (this._config?.image) pu.value = this._config.image;
        }
        const types = this.shadowRoot.querySelector('#types');
        if (types) types.hass = this._hass;
      }).catch(() => {});
      setTimeout(() => loader.remove(), 0);
    } catch (_) { /* ignore */ }
  }

  /** Robust ha-select value reader. Prefers the value captured from the
   *  `selected`/`change` event (stashed on the element as _slcValue) because
   *  mwc-select in newer HA sometimes fires `selected` before updating its
   *  own .value. Falls back to .value, then to the selected item's value. */
  _selectVal(id) {
    const el = this.shadowRoot.querySelector('#' + id);
    if (!el) return '';
    if (typeof el._slcValue === 'string' && el._slcValue !== '') return el._slcValue;
    if (typeof el.value === 'string' && el.value !== '') return el.value;
    const sel = el.selected;
    if (sel && typeof sel.value === 'string' && sel.value !== '') return sel.value;
    return '';
  }

  _getEditorHex(val) {
    if (!val) return '#000000';
    if (val.startsWith('#')) return val;
    const hex = CARD_DEFAULTS.COLOR_MAP[val.toLowerCase()];
    return hex || '#000000';
  }

  _updateFormValues() {
    const s = this.shadowRoot;
    const c = this._config;

    let todoEntity = c.todo_list;
    let shouldAutoPopulate = false;
    if (!todoEntity && this._hass && !this._hasInitialized) {
      const todoEntities = Object.keys(this._hass.states).filter(id => id.startsWith('todo.'));
      if (todoEntities.length > 0) { todoEntity = todoEntities[0]; shouldAutoPopulate = true; }
      this._hasInitialized = true;
    }

    s.querySelector('#title').value = c.title || '';
    s.querySelector('#subtitle').value = c.subtitle || '';
    const typesEl = s.querySelector('#types');
    typesEl.value = c.types;
    typesEl.sort = c.types_sort;
    const sortEl = s.querySelector('#types_sort');
    if (sortEl) {
      const sortVal = (c.types_sort === 'asc' || c.types_sort === 'desc') ? c.types_sort : 'none';
      sortEl.value = sortVal;
      sortEl._slcValue = sortVal;
    }
    s.querySelector('#image').value = c.image || '';
    s.querySelector('#image_base').value = c.image_base || '';
    s.querySelector('#list_prefix').value = c.list_prefix || '';
    const pu = s.querySelector('#image_upload');
    if (pu) pu.value = c.image || '';
    s.querySelector('#todo_list').value = c.todo_list || '';
    s.querySelector('#enable_quantity').checked = !!c.enable_quantity;
    s.querySelector('#keep_at_zero').checked = c.remove_zero === false;
    s.querySelector('#colorize_background').checked = c.colorize_background !== false;
    s.querySelector('#show_name').checked = c.show_name !== false;
    const layoutVal = c.layout === 'vertical' ? 'vertical' : 'horizontal';
    const layoutEl = s.querySelector('#layout');
    layoutEl.value = layoutVal;
    layoutEl._slcValue = layoutVal;
    s.querySelector('#haptic').checked = !!c.haptic;
    const holdVal = (c.hold_action?.action) || 'default';
    const holdEl = s.querySelector('#hold_action');
    holdEl.value = holdVal;
    holdEl._slcValue = holdVal;
    s.querySelector('#quantity_step').value = c.quantity_step != null ? c.quantity_step : '';
    s.querySelector('#quantity_max').value = c.quantity_max != null ? c.quantity_max : '';

    if (shouldAutoPopulate && todoEntity) {
      s.querySelector('#todo_list').value = todoEntity;
      setTimeout(() => this._handleConfigChanged(), 100);
    }

    ['off','on'].forEach(type => {
      s.querySelector(`#${type}_icon`).value = c[`${type}_icon`] || CARD_DEFAULTS[`DEFAULT_${type.toUpperCase()}_ICON`];
      const col = c[`${type}_color`] || CARD_DEFAULTS[`DEFAULT_${type.toUpperCase()}_COLOR`];
      s.querySelector(`#${type}_color`).value = col;
      s.querySelector(`#${type}_color_picker`).value = this._getEditorHex(col);
    });
  }

  _handleConfigChanged() {
    if (this._config?.mode === 'catalog') return;
    const s = this.shadowRoot;
    const n = { ...this._config };

    n.title = s.querySelector('#title').value;
    const sub = s.querySelector('#subtitle').value;
    if (sub) n.subtitle = sub; else delete n.subtitle;
    const sortVal = this._selectVal('types_sort');
    if (sortVal === 'asc' || sortVal === 'desc') n.types_sort = sortVal; else delete n.types_sort;
    s.querySelector('#types').sort = sortVal;
    const img = s.querySelector('#image').value;
    if (img) n.image = img; else delete n.image;
    const imgBase = s.querySelector('#image_base').value.trim();
    if (imgBase) n.image_base = imgBase; else delete n.image_base;
    const prefix = s.querySelector('#list_prefix').value.trim();
    if (prefix) n.list_prefix = prefix; else delete n.list_prefix;
    n.todo_list = s.querySelector('#todo_list').value;

    const enableQty = s.querySelector('#enable_quantity').checked;
    if (enableQty) n.enable_quantity = true; else delete n.enable_quantity;

    // `remove_zero` defaults to true (delete at zero); only persist the opt-out.
    const keepAtZero = s.querySelector('#keep_at_zero').checked;
    if (keepAtZero) n.remove_zero = false; else delete n.remove_zero;

    const colorBg = s.querySelector('#colorize_background').checked;
    if (colorBg) delete n.colorize_background; else n.colorize_background = false;

    const showName = s.querySelector('#show_name').checked;
    if (showName) delete n.show_name; else n.show_name = false;

    const haptic = s.querySelector('#haptic').checked;
    if (haptic) n.haptic = true; else delete n.haptic;

    const layoutVal = this._selectVal('layout');
    if (layoutVal === 'vertical') n.layout = 'vertical'; else delete n.layout;

    const holdVal = this._selectVal('hold_action') || 'default';
    if (holdVal === 'default') delete n.hold_action;
    else n.hold_action = { action: holdVal };

    const stepRaw = s.querySelector('#quantity_step').value;
    const stepNum = parseInt(stepRaw, 10);
    if (stepRaw && !isNaN(stepNum) && stepNum > 1) n.quantity_step = stepNum;
    else delete n.quantity_step;

    const maxRaw = s.querySelector('#quantity_max').value;
    const maxNum = parseInt(maxRaw, 10);
    if (maxRaw && !isNaN(maxNum) && maxNum > 0) n.quantity_max = maxNum;
    else delete n.quantity_max;

    ['off','on'].forEach(type => {
      const icon = s.querySelector(`#${type}_icon`).value;
      if (icon === CARD_DEFAULTS[`DEFAULT_${type.toUpperCase()}_ICON`]) delete n[`${type}_icon`];
      else n[`${type}_icon`] = icon;

      const col = s.querySelector(`#${type}_color`).value;
      if (col === CARD_DEFAULTS[`DEFAULT_${type.toUpperCase()}_COLOR`]) delete n[`${type}_color`];
      else n[`${type}_color`] = col;
    });

    this._emitConfig(n);
  }

  _emitConfig(config) {
    this._config = config;
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config }, bubbles: true, composed: true }));
  }
}
if (!customElements.get('shopping-list-card-editor')) {
  customElements.define('shopping-list-card-editor', ShoppingListCardEditor);
}
