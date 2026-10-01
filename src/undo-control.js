class ShoppingListUndo extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: inline-flex; flex-shrink: 0; width: var(--undo-size, 36px); height: var(--undo-size, 36px); }
        :host([hidden]) { display: none; }
        .undo { display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; width: 100%; height: 100%; padding: 0; border: 0; border-radius: 50%; background: var(--card-background-color, #fff); box-shadow: 0 0 0 1px var(--divider-color, #ccc); color: var(--primary-color); cursor: pointer; }
        .undo:hover { background: var(--secondary-background-color, #eee); }
        .undo:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 1px; }
        .undo:disabled { opacity: .5; cursor: default; }
        .undo.has-error { color: var(--error-color, #db4437); box-shadow: 0 0 0 1px currentColor; }
        ha-icon { --mdc-icon-size: calc(var(--undo-size, 36px) - 14px); }
        .live, .error { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
      </style>
      <button class="undo" type="button"><ha-icon icon="mdi:undo"></ha-icon></button>
      <span class="live" role="status" aria-live="polite"></span>
      <span class="error" role="alert"></span>
    `;
    this.shadowRoot.querySelector('.undo').addEventListener('click', event => {
      event.stopPropagation();
      void this._restore();
    });
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
    const message = undo.busy ? 'Restoring items...'
      : undo.count === 1 ? `Removed ${undo.summary}` : `Removed ${undo.count} items`;
    const button = this.shadowRoot.querySelector('.undo');
    const label = undo.busy ? message : `Undo: ${message}`;
    button.disabled = undo.busy || !this._store?.ready || !!snapshot.pending.size;
    button.title = this._error ? `${label}. ${this._error}` : label;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-busy', String(undo.busy));
    button.classList.toggle('has-error', !!this._error);
    this.shadowRoot.querySelector('.live').textContent = message;
    this.shadowRoot.querySelector('.error').textContent = this._error || '';
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