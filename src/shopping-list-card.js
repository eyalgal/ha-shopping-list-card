/*
 * Shopping List Card
 *
 * A Home Assistant Lovelace card to manage items on a to-do list with a
 * clean, modern interface and a visual editor.
 *
 * Author: eyalgal
 * License: MIT
 * Version: 2.2.0
 *
 * Note: This card requires a to-do entity to function properly.
 * For more information, visit: https://github.com/eyalgal/ha-shopping-list-card
 */

import { buildName, keepZero, matchItem, planItemAction } from './item-model.js';
import { getTodoStore } from './todo-store.js';
import { CARD_DEFAULTS } from './card-defaults.js';
import { CARD_STYLES } from './card-styles.js';
import './editor.js';
import './catalog-card.js';

const CARD_VERSION = '2.2.0';

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Card ─────────────────────────────────────────────────────────────────────

class ShoppingListCard extends HTMLElement {
  static DEFAULT_ON_ICON    = CARD_DEFAULTS.DEFAULT_ON_ICON;
  static DEFAULT_OFF_ICON   = CARD_DEFAULTS.DEFAULT_OFF_ICON;
  static DEFAULT_ON_COLOR   = CARD_DEFAULTS.DEFAULT_ON_COLOR;
  static DEFAULT_OFF_COLOR  = CARD_DEFAULTS.DEFAULT_OFF_COLOR;
  static COLOR_MAP = CARD_DEFAULTS.COLOR_MAP;

  constructor() {
    super();
    this._isUpdating = false;
    this._items = null;
    this._unsubscribe = null;
    this._store = null;
    this._syncState = null;
    this._actionError = null;
    this._configVersion = 0;
    this._lastRenderKey = null;
    this._expanded = false;
    this._holdCleanups = new Set();
    this._suppressClick = false;
    this._clickResetTimer = null;
    this.addEventListener('click', event => {
      if (!this._suppressClick) return;
      this._suppressClick = false;
      clearTimeout(this._clickResetTimer);
      this._clickResetTimer = null;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
  }

  set hass(hass) {
    this._hass = hass;
    if (this._config && this.isConnected) this._ensureSubscription();
  }

  setConfig(config) {
    if (typeof config.title !== 'string' || !config.title.trim()) throw new Error('You must define a title.');
    if (typeof config.todo_list !== 'string' || !config.todo_list.startsWith('todo.')) {
      throw new Error('You must define a todo_list entity_id.');
    }
    const prev = this._config;
    this._clearHolds();
    this._config = { ...config };
    this._configVersion++;
    this._actionError = null;
    this._isUpdating = false;
    this._lastRenderKey = null;
    if (prev && prev.todo_list !== config.todo_list) {
      this._items = null;
      this._teardownSubscription();
    }
    if (this._hass && this.isConnected) {
      this._ensureSubscription();
      this._render();
    }
  }

  connectedCallback() {
    if (this._hass && this._config) this._ensureSubscription();
  }

  disconnectedCallback() {
    this._clearHolds();
    clearTimeout(this._clickResetTimer);
    this._clickResetTimer = null;
    this._suppressClick = false;
    this._teardownSubscription();
    this._configVersion++;
    this._isUpdating = false;
  }

  _ensureSubscription() {
    if (!this._hass || !this._config?.todo_list) return;
    if (this._store?.entityId === this._config.todo_list
      && this._store.connection === this._hass.connection && this._unsubscribe) {
      this._store.updateHass(this._hass);
      return;
    }
    this._teardownSubscription();
    this._items = null;
    const store = getTodoStore(this._hass, this._config.todo_list);
    this._store = store;
    this._unsubscribe = store.subscribe(snapshot => {
      if (this._store !== store) return;
      this._syncState = snapshot;
      this._items = snapshot.items;
      this._render();
    });
  }

  _teardownSubscription() {
    const unsubscribe = this._unsubscribe;
    this._unsubscribe = null;
    this._store = null;
    this._syncState = null;
    unsubscribe?.();
  }

  static getConfigElement() { return document.createElement('shopping-list-card-editor'); }
  static getStubConfig() {
    return {
      type: 'custom:shopping-list-card',
      title: 'New Item',
      todo_list: '' // Add empty string to pass validation, editor will populate
    };
  }

  /** Build the todo item summary to match / write, honoring list_prefix. */
  _buildFullName() {
    return this._buildNameFor(this._config.subtitle);
  }

  /** Build a summary for a given subtitle/type, honoring list_prefix. */
  _buildNameFor(subtitle) {
    return buildName(this._config, subtitle);
  }

  /** Normalized list of configured types (variants). Each entry is an object
   *  `{ name, image?, icon? }`. Accepts plain strings or objects in config.
   *  Returns an empty array when no types are configured. */
  _getTypes() {
    let raw = this._config && this._config.types;
    // Accept a comma / newline separated string (handy when the list comes
    // from a JSON catalog, e.g. "Pink Lady, Granny Smith, Gala").
    if (typeof raw === 'string') {
      raw = raw.split(/[,\n]/).map(x => x.trim()).filter(Boolean);
    }
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const entry of raw) {
      if (typeof entry === 'string') {
        const name = entry.trim();
        if (name) out.push({ name });
      } else if (entry && typeof entry === 'object' && entry.name != null) {
        const name = String(entry.name).trim();
        if (name) out.push({ name, image: entry.image, icon: entry.icon });
      }
    }
    const sort = this._config && this._config.types_sort;
    if (sort === 'asc' || sort === 'desc') {
      const dir = sort === 'desc' ? -1 : 1;
      out.sort((a, b) => dir * a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    }
    return out;
  }

  /** When `remove_zero: false`, keep emptied items as `Name (0)` and always
   *  suffix the quantity. Requires quantity mode; defaults off (remove at 0). */
  _keepZero() {
    return keepZero(this._config);
  }

  /** Match a summary against the current items. `present` is whether it exists
   *  at all; `isOn` is whether it's active (a kept `Name (0)` is present but off). */
  _matchSummary(fullName) {
    return matchItem(this._items, fullName, this._config);
  }

  /** Resolve the on-state and stored name for a single type. */
  _typeState(typeName) {
    const fullName = this._buildNameFor(typeName);
    return { fullName, ...this._matchSummary(fullName) };
  }

  /** Resolve the effective image URL: explicit `image` wins, otherwise
   *  derive from `image_base` + slug(title) + '.png'. Returns the first
   *  candidate; use `_imageCandidates()` for the full fallback list. */
  _resolveImage() {
    const list = this._imageCandidates();
    return list[0] || '';
  }

  /** Ordered list of image URL candidates to try. When `image` is set it is
   *  the sole candidate. Otherwise, when `image_base` is set, we generate
   *  multiple slug variants of the title so a file named any of
   *  `ice-cream.png`, `ice_cream.png`, `ice cream.png`, or `icecream.png`
   *  is picked up automatically. */
  _imageCandidates() {
    const c = this._config;
    if (c.image) return [c.image];
    if (!c.image_base) return [];
    const base = c.image_base.endsWith('/') ? c.image_base : c.image_base + '/';
    const raw = String(c.title || '').toLowerCase().trim();
    if (!raw) return [];
    // Split on any non-letter/number run to get word tokens, preserving
    // Unicode letters/numbers only.
    const tokens = raw.split(/[^\p{Letter}\p{Number}]+/gu).filter(Boolean);
    if (!tokens.length) return [];
    const joiners = ['-', '_', ' ', ''];
    const seen = new Set();
    const out = [];
    for (const j of joiners) {
      const slug = tokens.join(j);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      out.push(`${base}${encodeURI(slug)}.png`);
    }
    return out;
  }

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

  /** Returns an RGB triplet string ("R, G, B" or a var() with hex fallback) or null. */
  _colorRgbTriplet(val) {
    if (!val) return null;
    if (val.startsWith('#')) {
      const c = this._hexToRgb(val);
      return c ? `${c.r}, ${c.g}, ${c.b}` : null;
    }
    const key = val.toLowerCase();
    const hex = ShoppingListCard.COLOR_MAP[key];
    if (!hex) return null;
    const rgb = this._hexToRgb(hex);
    if (!rgb) return `var(--rgb-${key})`;
    // Hex-triplet fallback so unknown/unset theme vars still render.
    return `var(--rgb-${key}, ${rgb.r}, ${rgb.g}, ${rgb.b})`;
  }

  /** Theme-aware rgba() string. Falls back to hex when unknown. */
  _rgbaFor(colorName, alpha) {
    const triplet = this._colorRgbTriplet(colorName);
    if (triplet) return `rgba(${triplet}, ${alpha})`;
    const hex = this._getColorValue(colorName);
    return hex ? this._toRgba(hex, alpha) : `rgba(128, 128, 128, ${alpha})`;
  }

  /** Theme-aware solid color string. */
  _solidFor(colorName) {
    const triplet = this._colorRgbTriplet(colorName);
    if (triplet) return `rgb(${triplet})`;
    return this._getColorValue(colorName) || '#808080';
  }

  _ensureShell() {
    if (this.content) return;
    this.innerHTML = `<ha-card><div class="list-status" role="status" aria-live="polite"></div><div class="card-content"></div></ha-card>`;
    this.content = this.querySelector('div.card-content');
    this._statusElement = this.querySelector('.list-status');
    this._attachStyles();
  }

  _renderStatus() {
    const status = this._syncState?.status || 'loading';
    const message = this._actionError || this._syncState?.error || (status === 'loading' ? 'Loading list...' : '');
    const severity = this._actionError || status === 'error' ? 'error' : status === 'loading' ? 'info' : 'warning';
    const key = `${severity}|${message}`;
    if (this._lastStatusKey === key) return;
    this._lastStatusKey = key;
    this._statusElement.innerHTML = message ? `<ha-alert alert-type="${severity}">${escapeHtml(message)}
      ${status !== 'loading' ? '<button class="refresh-list" type="button" title="Refresh list" aria-label="Refresh list"><ha-icon icon="mdi:refresh"></ha-icon></button>' : ''}
    </ha-alert>` : '';
    this._statusElement.querySelector('.refresh-list')?.addEventListener('click', async () => {
      const store = this._store;
      this._actionError = null;
      try { await store?.refresh(); }
      catch (error) { if (this._store === store) this._actionError = error.message || 'Could not refresh the list.'; }
      if (this._store === store) this._renderStatus();
    });
  }

  _applyBusyState() {
    const card = this.content?.querySelector('.card-container');
    if (!card) return;
    const names = [this._buildFullName(), ...this._getTypes().map(type => this._buildNameFor(type.name))];
    const busy = this._isUpdating || names.some(name => this._store?.pending.has(name.toLowerCase()));
    const unavailable = !this._store?.ready;
    card.classList.toggle('is-updating', busy);
    card.classList.toggle('is-unavailable', unavailable);
    card.setAttribute('aria-busy', String(busy));
    for (const control of [card, ...card.querySelectorAll('[role="button"]')]) {
      control.setAttribute('aria-disabled', String(busy || unavailable));
    }
  }

  _render() {
    this._ensureShell();
    this._renderStatus();
    this._applyBusyState();
    if (!this._config || !this._hass) return;

    if (this._items === null) {
      this._clearHolds();
      this.content.innerHTML = '';
      this._lastRenderKey = null;
      return;
    }

    const types = this._getTypes();
    if (types.length) { this._renderTypesMode(types); return; }

    const fullName = this._buildFullName();
    const { isOn, qty, matched, matchedUid, present } = this._matchSummary(fullName);

    // Memoize: skip the DOM rewrite when nothing visible (or interaction-relevant)
    // changed for this card. Config changes invalidate _lastRenderKey via setConfig().
    // This avoids rebuilding innerHTML on every WebSocket push that doesn't affect us
    // (e.g. a sibling item being added on a 50-card dashboard).
    const renderKey = `${isOn}|${qty}|${present ? 1 : 0}|${matchedUid || ''}|${matched || ''}`;
    if (this._lastRenderKey === renderKey) return;
    this._lastRenderKey = renderKey;

    const onIcon    = this._config.on_icon    || ShoppingListCard.DEFAULT_ON_ICON;
    const offIcon   = this._config.off_icon   || ShoppingListCard.DEFAULT_OFF_ICON;
    const onColorN  = this._config.on_color   || ShoppingListCard.DEFAULT_ON_COLOR;
    const offColorN = this._config.off_color || ShoppingListCard.DEFAULT_OFF_COLOR;
    const activeColor = isOn ? onColorN : offColorN;

    const icon    = escapeHtml(isOn ? onIcon : offIcon);
    const bg      = escapeHtml(this._rgbaFor(activeColor, 0.2));
    const fg      = escapeHtml(this._solidFor(activeColor));

    let cardBgStyle = '';
    if (isOn && this._config.colorize_background !== false) {
      cardBgStyle = `style="background-color: ${escapeHtml(this._rgbaFor(onColorN, 0.1))};"`;
    }

    const isVertical = this._config.layout === 'vertical';
    const layoutClass = isVertical ? 'vertical-layout' : '';
    const effectiveImage = this._resolveImage();

    let mainContent = '';
    let qtyControls = '';
    let topBlock = '';

    if (isVertical) {
        let quantityBadge = '';
        if (isOn && this._config.enable_quantity) {
            quantityBadge = `<span class="quantity-badge">${qty}</span>`;
        }

        const safeImage = escapeHtml(effectiveImage);
        const safeTitle = escapeHtml(this._config.title || '');
        const decBtn = `<div class="quantity-btn" role="button" tabindex="0" aria-label="Decrease quantity" data-action="decrement"><ha-icon icon="mdi:minus"></ha-icon></div>`;
        const incBtn = `<div class="quantity-btn" role="button" tabindex="0" aria-label="Increase quantity" data-action="increment"><ha-icon icon="mdi:plus"></ha-icon></div>`;

        let iconElement;
        if (effectiveImage) {
            iconElement = `<div class="image-wrapper vertical-image">
                             <img src="${safeImage}" alt="${safeTitle}" />
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
                                ${(this._keepZero() || qty > 1) ? decBtn : `<div class="quantity-btn-placeholder"></div>`}
                                ${iconElement}
                                ${incBtn}
                             </div>`;
        } else {
            topBlock = iconElement;
        }
    } else { // Horizontal layout
        const safeImage = escapeHtml(effectiveImage);
        const safeTitle = escapeHtml(this._config.title || '');
        const decBtn = `<div class="quantity-btn" role="button" tabindex="0" aria-label="Decrease quantity" data-action="decrement"><ha-icon icon="mdi:minus"></ha-icon></div>`;
        const incBtn = `<div class="quantity-btn" role="button" tabindex="0" aria-label="Increase quantity" data-action="increment"><ha-icon icon="mdi:plus"></ha-icon></div>`;

        if (effectiveImage) {
            mainContent = `<div class="image-wrapper">
                             <img src="${safeImage}" alt="${safeTitle}" />
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
                                ${(this._keepZero() || qty > 1) ? decBtn : ''}
                                <span class="quantity" aria-label="Quantity: ${qty}">${qty}</span>
                                ${incBtn}
                             </div>`;
        }
    }

    const ariaLabelParts = [this._config.title];
    if (this._config.subtitle) ariaLabelParts.push(this._config.subtitle);
    ariaLabelParts.push(isOn ? (this._config.enable_quantity ? `quantity ${qty}` : 'on list') : 'not on list');
    const ariaLabel = escapeHtml(ariaLabelParts.join(', '));

    const showName = this._config.show_name !== false;
    const nameBlock = showName
      ? `<div class="info-container">
          <div class="primary">${escapeHtml(this._config.title)}</div>
          ${this._config.subtitle?`<div class="secondary">${escapeHtml(this._config.subtitle)}</div>`:''}
        </div>`
      : '';
    const nameClass = showName ? '' : 'no-name';

    this._clearHolds();
    this.content.innerHTML = `
      <div class="card-container ${isOn?'is-on':'is-off'} ${layoutClass} ${nameClass}"
           role="button" tabindex="0" aria-pressed="${isOn ? 'true' : 'false'}" aria-label="${ariaLabel}"
           ${cardBgStyle}>
        ${isVertical ? `<div class="vertical-top-block">${topBlock}</div>` : mainContent}
        ${nameBlock}
        ${qtyControls}
      </div>
    `;

    const card = this.content.querySelector('.card-container');
    this._wireInteractions(card);
    this._wireImageError(card);
    this._applyBusyState();
  }

  /** Render the expandable "types" (variants) layout. The header is the bare
   *  title: tapping its body adds / removes the plain item, while the chevron
   *  expands the variant list. Each type row adds / removes / adjusts the
   *  quantity of `Title - Type` independently. */
  _renderTypesMode(types) {
    const onIcon    = this._config.on_icon    || ShoppingListCard.DEFAULT_ON_ICON;
    const offIcon   = this._config.off_icon   || ShoppingListCard.DEFAULT_OFF_ICON;
    const onColorN  = this._config.on_color   || ShoppingListCard.DEFAULT_ON_COLOR;
    const offColorN = this._config.off_color  || ShoppingListCard.DEFAULT_OFF_COLOR;

    // Each type renders as its own row ("Title - Type"). The header itself is
    // the bare title ("Apple"): tapping the header body adds / removes the
    // plain item, while the chevron expands the variant list. Tapping a row
    // toggles that specific variant independently.
    const states = types.map(t => ({
      label: t.name, subtitle: t.name, image: t.image, icon: t.icon,
      ...this._typeState(t.name),
    }));
    // Cache the subtitle per row index for tap handling.
    this._typeEntries = states.map(s => s.subtitle);
    const activeCount = states.filter(s => s.isOn).length;

    // Bare-item state drives the header's add / remove action. When a `subtitle`
    // is configured, the header item is stored as "Title - subtitle"; otherwise
    // it is the plain title.
    const baseSubtitle = this._config.subtitle || null;
    const bare = this._typeState(baseSubtitle);

    // Memoize on header + per-row states. Expansion is a pure CSS toggle applied
    // outside render, so it is intentionally excluded from the key.
    const renderKey = 'types|' + (bare.isOn ? 1 : 0) + ':' + bare.qty + ':' + (bare.present ? 1 : 0) + '|' + activeCount + '|' +
      states.map(s => `${s.label}:${s.isOn ? 1 : 0}:${s.qty}:${s.present ? 1 : 0}`).join('|');
    if (this._lastRenderKey === renderKey) { this._applyExpanded(); return; }
    this._lastRenderKey = renderKey;

    const headerOn = bare.isOn;
    const anyOn = bare.isOn || activeCount > 0;
    // The header icon reflects the whole group: it is in the selected state when
    // the bare item OR any variant is on the list.
    const headColor = anyOn ? onColorN : offColorN;
    const headBg = escapeHtml(this._rgbaFor(headColor, 0.2));
    const headFg = escapeHtml(this._solidFor(headColor));
    const headIcon = escapeHtml(anyOn ? onIcon : offIcon);
    const effectiveImage = this._resolveImage();
    const safeImage = escapeHtml(effectiveImage);
    const safeTitle = escapeHtml(this._config.title || '');
    const isVertical = this._config.layout === 'vertical';

    // Optional badge showing how many variants are currently on the list.
    const countBadge = activeCount > 0
      ? `<span class="quantity-badge">${activeCount}</span>` : '';

    let parentIcon;
    if (isVertical) {
      parentIcon = effectiveImage
        ? `<div class="image-wrapper vertical-image">
             <img src="${safeImage}" alt="${safeTitle}" />
             ${countBadge}
             <div class="icon-wrapper vertical-icon" style="background:${headBg}; color:${headFg};">
               <ha-icon icon="${headIcon}"></ha-icon>
             </div>
           </div>`
        : `<div class="icon-wrapper vertical-icon" style="background:${headBg}; color:${headFg};">
             <ha-icon icon="${headIcon}"></ha-icon>
             ${countBadge}
           </div>`;
    } else {
      parentIcon = effectiveImage
        ? `<div class="image-wrapper">
             <img src="${safeImage}" alt="${safeTitle}" />
             <div class="icon-wrapper" style="background:${headBg}; color:${headFg};">
               <ha-icon icon="${headIcon}"></ha-icon>
             </div>
           </div>`
        : `<div class="icon-wrapper" style="background:${headBg}; color:${headFg};">
             <ha-icon icon="${headIcon}"></ha-icon>
           </div>`;
    }

    // Parent secondary line: active selections, else the configured subtitle.
    const activeNames = states.filter(s => s.isOn)
      .map(s => s.qty > 1 ? `${s.label} (${s.qty})` : s.label).join(', ');
    const secondary = activeNames || this._config.subtitle || '';

    let cardBgStyle = '';
    if (anyOn && this._config.colorize_background !== false) {
      cardBgStyle = `style="background-color: ${escapeHtml(this._rgbaFor(onColorN, 0.1))};"`;
    }

    const enableQty = !!this._config.enable_quantity;
    const decBtn = `<div class="quantity-btn" role="button" tabindex="0" aria-label="Decrease quantity" data-action="decrement"><ha-icon icon="mdi:minus"></ha-icon></div>`;
    const incBtn = `<div class="quantity-btn" role="button" tabindex="0" aria-label="Increase quantity" data-action="increment"><ha-icon icon="mdi:plus"></ha-icon></div>`;

    const onSolid = escapeHtml(this._solidFor(onColorN));
    const rowsHtml = states.map((s, i) => {
      const thumb = s.image
        ? `<div class="type-thumb"><img src="${escapeHtml(s.image)}" alt=""><ha-icon class="type-image-fallback" icon="${escapeHtml(s.icon || offIcon)}"></ha-icon></div>`
        : s.icon ? `<div class="type-thumb"><ha-icon icon="${escapeHtml(s.icon)}"></ha-icon></div>` : '';
      let rightHtml;
      if (s.isOn && enableQty) {
        rightHtml = `<div class="type-qty">
            ${(this._keepZero() || s.qty > 1) ? decBtn : ''}
            <span class="quantity" aria-label="Quantity: ${s.qty}">${s.qty}</span>
            ${incBtn}
          </div>`;
      } else if (s.isOn) {
        // Active without quantity: a flat check indicator (not a toggle button).
        rightHtml = `<div class="type-indicator" style="color:${onSolid};"><ha-icon icon="mdi:check"></ha-icon></div>`;
      } else {
        // Inactive: a muted add affordance. Tapping the row adds the variant.
        rightHtml = `<div class="type-indicator type-add"><ha-icon icon="mdi:plus"></ha-icon></div>`;
      }
      const rowStyle = s.isOn ? ` style="background:${escapeHtml(this._rgbaFor(onColorN, 0.12))};"` : '';
      return `<div class="type-row ${s.isOn ? 'is-on' : 'is-off'}" data-type-index="${i}"${rowStyle}
                   role="button" tabindex="0" aria-pressed="${s.isOn ? 'true' : 'false'}"
                   aria-label="${escapeHtml(s.label)}">
                ${thumb}
                <div class="type-name">${escapeHtml(s.label)}</div>
                ${rightHtml}
              </div>`;
    }).join('');

    const headerLabel = escapeHtml([this._config.title, secondary].filter(Boolean).join(', '));

    // Vertical mirrors the normal vertical tile: icon top-center, text bottom,
    // chevron pinned bottom-right. Horizontal keeps the inline row.
    const headerInner = isVertical
      ? `<div class="vertical-top-block">${parentIcon}</div>
         <div class="info-container">
           <div class="primary">${safeTitle}</div>
           ${secondary ? `<div class="secondary">${escapeHtml(secondary)}</div>` : ''}
         </div>
         <ha-icon class="types-chevron" icon="mdi:chevron-down" role="button" tabindex="0"
                  aria-expanded="false" aria-controls="slc-types-list" aria-label="Toggle types"></ha-icon>`
      : `${parentIcon}
         <div class="info-container">
           <div class="primary">${safeTitle}</div>
           ${secondary ? `<div class="secondary">${escapeHtml(secondary)}</div>` : ''}
         </div>
         <ha-icon class="types-chevron" icon="mdi:chevron-down" role="button" tabindex="0"
                  aria-expanded="false" aria-controls="slc-types-list" aria-label="Toggle types"></ha-icon>`;

    this._clearHolds();
    this.content.innerHTML = `
      <div class="card-container types-mode ${isVertical ? 'vertical-layout' : ''} ${anyOn ? 'is-on' : 'is-off'}" ${cardBgStyle}>
        <div class="types-header ${isVertical ? 'vertical-header' : ''}" role="button" tabindex="0"
             aria-pressed="${headerOn ? 'true' : 'false'}" aria-label="${headerLabel}">
          ${headerInner}
        </div>
        <div class="types-list" id="slc-types-list" role="group">${rowsHtml}</div>
      </div>
    `;

    const card = this.content.querySelector('.card-container');
    this._wireTypesInteractions(card);
    this._wireImageError(card);
    this._applyExpanded();
    this._applyBusyState();
  }

  _applyExpanded() {
    const card = this.content?.querySelector('.card-container.types-mode');
    if (!card) return;
    const expanded = !!this._expanded;
    card.classList.toggle('expanded', expanded);
    const list = card.querySelector('.types-list');
    if (list) {
      list.inert = !expanded;
      list.setAttribute('aria-hidden', String(!expanded));
    }
    const chevron = card.querySelector('.types-chevron');
    if (chevron) chevron.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  }

  _wireTypesInteractions(card) {
    const header = card.querySelector('.types-header');
    const chevron = card.querySelector('.types-chevron');
    const expand = () => {
      this._expanded = !this._expanded;
      this._vibrate();
      this._applyExpanded();
    };

    // The chevron is the dedicated expand / collapse control.
    if (chevron) {
      chevron.addEventListener('click', (ev) => { ev.stopPropagation(); expand(); });
      chevron.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.stopPropagation(); expand(); }
      });
    }

    // Tapping the header body (anywhere but the chevron) adds / removes the
    // bare title, like a normal single-item card. Holding it clears every
    // item that belongs to this card (the bare title and all variants).
    if (header) {
      header.addEventListener('click', (ev) => {
        if (ev.target.closest('.types-chevron')) return;
        this._handleHeaderTap(ev);
      });
      header.addEventListener('keydown', (ev) => {
        if ((ev.key === 'Enter' || ev.key === ' ') && !ev.target.closest('.types-chevron')) {
          ev.preventDefault(); this._handleHeaderTap(ev);
        }
      });
      this._attachHold(header, () => this._removeAllTypes());
    }

    card.querySelectorAll('.type-row').forEach(row => {
      const idx = +row.dataset.typeIndex;
      const tap = (ev) => this._handleTypeTap(ev, idx);
      row.addEventListener('click', tap);
      row.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); tap(ev); }
      });
      // Holding a row removes that specific variant entirely, regardless of
      // its quantity.
      this._attachHold(row, () => this._removeType(idx));
    });
  }

  /** Generic press-and-hold wiring: fires `onHold` after a 500ms hold and
   *  swallows the trailing click so the tap handler doesn't also fire.
   *  Honors `hold_action: { action: none }` to disable holds entirely. */
  _attachHold(el, onHold) {
    if (this._config.hold_action?.action === 'none') return;
    let holdTimer = null;
    let startX = 0;
    let startY = 0;
    const version = this._configVersion;
    const start = event => {
      if (event.button !== 0 || event.isPrimary === false
        || event.target.closest('.quantity-btn, .types-chevron')) return;
      startX = event.clientX;
      startY = event.clientY;
      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => {
        holdTimer = null;
        if (!el.isConnected || this._configVersion !== version) return;
        this._suppressClick = true;
        clearTimeout(this._clickResetTimer);
        this._clickResetTimer = setTimeout(() => { this._suppressClick = false; }, 1000);
        this._vibrate();
        this._handleHoldAction(onHold);
      }, 500);
    };
    const cancel = () => { clearTimeout(holdTimer); holdTimer = null; };
    const move = event => {
      if (!holdTimer) return;
      if (Math.abs(event.clientX - startX) > 10 || Math.abs(event.clientY - startY) > 10) cancel();
    };
    el.addEventListener('pointerdown', start);
    el.addEventListener('pointermove', move);
    for (const event of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(event, cancel);
    this._holdCleanups.add(() => {
      cancel();
      el.removeEventListener('pointerdown', start);
      el.removeEventListener('pointermove', move);
      for (const event of ['pointerup', 'pointerleave', 'pointercancel']) el.removeEventListener(event, cancel);
    });
  }

  _clearHolds() {
    for (const cleanup of this._holdCleanups) cleanup();
    this._holdCleanups.clear();
  }

  /** Hold on the header: remove every item that belongs to this card, i.e.
   *  the bare title plus each configured variant currently on the list. */
  _removeAllTypes() {
    return this._runItemActions([this._config.subtitle || null, ...this._getTypes().map(type => type.name)], 'remove');
  }

  /** Hold on a variant row: remove that specific variant entirely. */
  _removeType(idx) {
    const entries = this._typeEntries || [];
    if (idx < 0 || idx >= entries.length) return;
    return this._runItemActions([entries[idx]], 'remove');
  }

  _handleHeaderTap(ev) {
    return this._toggleSubtitle(ev, this._config.subtitle || null);
  }

  _handleTypeTap(ev, idx) {
    ev.stopPropagation();
    const entries = this._typeEntries || [];
    if (idx < 0 || idx >= entries.length) return;
    return this._toggleSubtitle(ev, entries[idx]);
  }

  _toggleSubtitle(event, subtitle) {
    event.stopPropagation();
    const action = event.target.closest('.quantity-btn')?.dataset.action || 'toggle';
    return this._runItemActions([subtitle], action);
  }

  async _runItemActions(subtitles, action) {
    if (this._isUpdating || !this.isConnected) return;
    const store = this._store;
    const config = this._config;
    const version = this._configVersion;
    const keys = [...new Set(subtitles.map(subtitle => buildName(config, subtitle).toLowerCase()))];
    if (keys.some(key => store?.pending.has(key))) return;
    if (!store?.ready) {
      this._actionError = store?.error || 'Wait for the to-do list to reconnect.';
      this._renderStatus();
      return;
    }
    this._vibrate();
    this._isUpdating = true;
    this._actionError = null;
    this._applyBusyState();
    this._renderStatus();
    try {
      await store.execute(keys, items => {
        const seen = new Set();
        return subtitles.map(subtitle => planItemAction(config, items, subtitle, action)).filter(operation => {
          if (!operation || seen.has(operation.key)) return false;
          seen.add(operation.key);
          return true;
        });
      });
    } catch (error) {
      if (this._store === store && this._configVersion === version) {
        this._actionError = error.message || 'Could not update the to-do list.';
      }
    } finally {
      if (this._store === store && this._configVersion === version) {
        this._isUpdating = false;
        this._applyBusyState();
        this._renderStatus();
      }
    }
  }

  _wireImageError(card) {
    card.querySelectorAll('.type-thumb img').forEach(image => {
      image.addEventListener('error', () => image.parentElement?.classList.add('image-error'));
    });
    const img = card.querySelector('.image-wrapper img');
    if (!img) return;
    // Try each candidate in order; when all fail, hide the image so the
    // icon-only fallback shows through.
    const candidates = this._imageCandidates();
    let idx = 0;
    img.addEventListener('error', () => {
      idx += 1;
      if (idx < candidates.length) {
        img.src = candidates[idx];
      } else {
        img.style.display = 'none';
        img.parentElement?.classList.add('image-error');
      }
    });
  }

  _wireInteractions(card) {
    const tap = (event) => this._toggleSubtitle(event, this._config.subtitle || null);
    card.addEventListener('click', tap);
    card.addEventListener('keydown', (ev) => {
      if (ev.target.closest('.quantity-btn')) {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          tap(ev);
        }
        return;
      }
      if (ev.target === card && (ev.key === 'Enter' || ev.key === ' ')) {
        ev.preventDefault();
        tap(ev);
      }
    });

    this._attachHold(card, () => this._runItemActions([this._config.subtitle || null], 'remove'));
  }

  _handleHoldAction(onRemove) {
    const cfg = this._config.hold_action;
    const action = cfg?.action || 'default';

    if (action === 'none') return;

    if (action === 'more-info') {
      const event = new CustomEvent('hass-more-info', {
        bubbles: true,
        composed: true,
        detail: { entityId: this._config.todo_list },
      });
      this.dispatchEvent(event);
      return;
    }

    if (action === 'default') return onRemove();
  }

  _vibrate() {
    if (this._config?.haptic && navigator.vibrate) navigator.vibrate(50);
  }

  _attachStyles() {
    if (this.querySelector('style')) return;
    const s = document.createElement('style');
    s.textContent = CARD_STYLES;
    this.appendChild(s);
  }

  getCardSize() {
    if (this._config && this._getTypes().length) return 2;
    if (this._config && this._config.layout === 'vertical') {
      return this._config.show_name === false ? 1 : 2;
    }
    return 1;
  }

  getLayoutOptions() {
    if (this._config && this._getTypes().length) {
      // Expandable: let the card grow with its content. `grid_rows: auto` keeps
      // the height flexible by default so the expanded variant list is never
      // clipped in the sections layout.
      // Vertical types cards are narrower (grid tiles), horizontal span wider.
      const cols = this._config.layout === 'vertical' ? 2 : 4;
      return { grid_rows: 'auto', grid_columns: cols, grid_min_columns: 2 };
    }
    if (this._config && this._config.layout === 'vertical') {
      const rows = this._config.show_name === false ? 1 : 2;
      return { grid_rows: rows, grid_min_rows: rows, grid_columns: 2, grid_min_columns: 2 };
    }
    return { grid_rows: 1, grid_min_rows: 1, grid_columns: 4, grid_min_columns: 2 };
  }
}
if (!customElements.get('shopping-list-card')) {
  customElements.define('shopping-list-card', ShoppingListCard);
}

window.customCards = window.customCards || [];
if (!window.customCards.some(c => c.type === 'shopping-list-card')) {
  window.customCards.push({
    type: 'shopping-list-card',
    name: 'Shopping List Card',
    preview: true,
    description: 'A card to manage items on a shopping list.',
    getEntitySuggestion: (hass, entityId) => {
      if (typeof entityId !== 'string' || entityId.split('.')[0] !== 'todo') return null;
      return { config: { type: 'custom:shopping-list-card', title: 'New item', todo_list: entityId } };
    },
  });
}

console.info(
  `%c SHOPPING-LIST-CARD %c v${CARD_VERSION} `,
  'color: white; background: #4CAF50; font-weight: 700;',
  'color: #4CAF50; background: white; font-weight: 700;'
);
