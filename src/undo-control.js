class ShoppingListUndo extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; padding: 8px; color: var(--primary-text-color); }
        :host([hidden]) { display: none; }
        .notice { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 13px; }
        .message { flex: 1 1 90px; min-width: 0; overflow-wrap: anywhere; }
        button { display: inline-flex; align-items: center; justify-content: center; gap: 4px; min-height: 36px; padding: 4px 8px; border: 0; border-radius: 4px; background: transparent; color: var(--primary-color); font: inherit; cursor: pointer; }
        button:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 1px; }
        button:disabled { opacity: .5; cursor: default; }
        .dismiss { width: 36px; padding: 0; color: var(--secondary-text-color); }
        ha-icon { --mdc-icon-size: 20px; }
        .error { margin-top: 6px; color: var(--error-color, #db4437); font-size: 13px; overflow-wrap: anywhere; }
        .error:empty { display: none; }
      </style>
      <div class="notice">
        <span class="message" role="status" aria-live="polite"></span>
        <button class="undo" type="button" title="Undo last removal"><ha-icon icon="mdi:undo"></ha-icon>Undo</button>
        <button class="dismiss" type="button" title="Dismiss Undo" aria-label="Dismiss Undo"><ha-icon icon="mdi:close"></ha-icon></button>
      </div>
      <div class="error" role="alert"></div>
    `;
    this.shadowRoot.querySelector('.undo').addEventListener('click', () => { void this._restore(); });
    this.shadowRoot.querySelector('.dismiss').addEventListener('click', () => this._store?.dismissUndo());
  }

  update(store, snapshot, keys = null) {
    if (this._store !== store || this._undoId !== snapshot?.undo?.id) this._error = '';
    this._store = store;
    this._undoId = snapshot?.undo?.id;
    this._keys = keys;
    this._render(snapshot);
  }

  _render(snapshot) {
    const undo = snapshot?.undo;
    this.hidden = !undo || !!this._keys && !undo.keys.some(key => this._keys.includes(key));
    if (this.hidden) return;
    this.shadowRoot.querySelector('.message').textContent = undo.busy ? 'Restoring items...'
      : undo.count === 1 ? `Removed ${undo.summary}` : `Removed ${undo.count} items`;
    this.shadowRoot.querySelector('.undo').disabled = undo.busy || !this._store?.ready || !!snapshot.pending.size;
    this.shadowRoot.querySelector('.dismiss').disabled = undo.busy;
    this.shadowRoot.querySelector('.error').textContent = this._error || '';
    this.shadowRoot.querySelector('.notice').setAttribute('aria-busy', String(undo.busy));
  }

  async _restore() {
    const store = this._store;
    const undoId = this._undoId;
    if (!store || this.hidden) return;
    this._error = '';
    try {
      await store.undoLastRemoval(undoId);
    } catch (error) {
      if (this.isConnected && this._store === store && this._undoId === undoId) {
        this._error = error.message || 'Could not undo the removal.';
      }
    } finally {
      if (this.isConnected && this._store === store) this._render(store.snapshot);
    }
  }
}

if (!customElements.get('shopping-list-undo')) {
  customElements.define('shopping-list-undo', ShoppingListUndo);
}