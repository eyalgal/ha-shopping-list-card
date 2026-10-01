export const CARD_STYLES = `
      ha-card { position: relative; box-sizing: border-box; border-radius: var(--ha-card-border-radius,12px); box-shadow: var(--ha-card-box-shadow); overflow:hidden; background: var(--ha-card-background, var(--card-background-color)); }
      .card-undo { --undo-size: 24px; --undo-icon-size: 20px; --undo-radius: 5px; --undo-background: rgba(128,128,128,0.2); --undo-hover-background: rgba(128,128,128,0.4); position: absolute; z-index: 2; top: 15px; right: 8px; color: var(--primary-text-color); }
      ha-card:has(.types-mode) .card-undo { top: 16px; }
      .card-undo[hidden] { display: none; }
      ha-card.has-undo .card-container:not(.vertical-layout):not(.types-mode) { padding-right: 40px; }
      ha-card.has-undo .types-header:not(.vertical-header) { padding-right: 40px; }
      /* Vertical tiles: sit in the top corner, above the quantity buttons (which start at 30px). */
      ha-card.has-vertical-undo .card-undo { top: 6px; right: 6px; }
      .card-content { padding:0 !important; margin: -1px 0; }
      .card-container { display:flex; align-items:center; padding:10px 12px; gap:10px; cursor:pointer; transition:background-color .2s; box-sizing: border-box; outline: none; }
      .card-container:hover { background: var(--secondary-background-color) }
      .card-container:focus-visible { box-shadow: 0 0 0 2px var(--primary-color); }
      .card-container.is-updating { opacity: .6; cursor: wait; }
      .card-container.is-unavailable { opacity: .6; cursor: not-allowed; }
      .list-status:empty { display: none; }
      .list-status { padding: 8px; overflow-wrap: anywhere; }
      .refresh-list { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; padding: 0; margin-inline-start: 4px; border: 0; border-radius: 4px; background: transparent; color: inherit; cursor: pointer; vertical-align: middle; }
      .refresh-list:focus-visible { outline: 2px solid var(--primary-color); }
      .quantity-btn { cursor: pointer; }
      .quantity-btn:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 1px; }

      /* Icon-only mode */
      .card-container.vertical-layout.no-name { justify-content: center; height: 56px; }
      .card-container.vertical-layout.no-name .vertical-top-block { top: 50%; transform: translateY(-50%); }
      .card-container.vertical-layout.no-name .icon-wrapper.vertical-icon { width: 36px; height: 36px; }
      .card-container.vertical-layout.no-name .icon-wrapper.vertical-icon ha-icon { --mdc-icon-size: 22px; }
      .card-container.vertical-layout.no-name .image-wrapper.vertical-image { max-height: 36px; }
      .card-container.vertical-layout.no-name .image-wrapper.vertical-image img { max-height: 36px; }
      .card-container.vertical-layout.no-name .image-wrapper.vertical-image.image-error { width: 36px; height: 36px; }
      /* Horizontal no-name: keep icon at left, quantity at right */
      .card-container:not(.vertical-layout).no-name .quantity-controls { margin-left: auto; }

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

      /* Types (variants) mode */
      .card-container.types-mode { display: block; padding: 0; cursor: default; container: shopping-variants / inline-size; }
      .card-container.types-mode:hover { background: transparent; }
      /* Types cards grow with their content; never inherit the fixed 120px
         height from the normal vertical-layout tile. */
      .card-container.types-mode.vertical-layout { height: auto; }
      .types-header { display: grid; grid-template-columns: 36px minmax(0, 1fr) auto 24px; align-items: center; gap: 8px; height: 56px; position: relative; box-sizing: border-box; padding: 10px 12px; cursor: pointer; transition: background-color .2s; }
      .types-header > .info-container { grid-column: 2; grid-row: 1; }
      .types-header:hover { background: var(--secondary-background-color); }
      .types-header:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--primary-color) inset; }
      .types-header.is-updating { opacity: .6; pointer-events: none; }
      .types-header .header-quantity { grid-column: 3; grid-row: 1; width: 80px; flex-wrap: nowrap; }
      .types-header .header-quantity .quantity-btn { flex-shrink: 0; }
      .types-header .header-quantity .quantity { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .header-quantity-badge { display: none; top: 6px; left: 38px; right: auto; width: auto; min-width: 18px; max-width: 44px; padding-inline: 2px; overflow: hidden; }
      .types-chevron { grid-column: 4; grid-row: 1; flex-shrink: 0; box-sizing: border-box; width: 24px; height: 24px; color: var(--secondary-text-color); transition: transform .25s ease, background-color .2s; cursor: pointer; border-radius: 50%; padding: 2px; }
      .types-chevron:hover { background: var(--divider-color); }
      .types-chevron:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--primary-color); }
      .card-container.types-mode.expanded .types-chevron { transform: rotate(180deg); }
      .types-list { max-height: 0; overflow: hidden; transition: max-height .3s ease; }
      .card-container.types-mode.expanded .types-list { max-height: 2000px; }

      /* Vertical types header: reuse the normal vertical-tile shape. The header
         is a fixed-height (120px) relative block with the icon absolutely
         positioned top-center, the name / subtitle bottom-center, and the
         chevron in the bottom-right corner. The variant list expands below,
         exactly like the horizontal layout. */
      .types-header.vertical-header { display: block; height: 120px; position: relative; padding: 0 8px; cursor: default; }
      .types-header.vertical-header:hover { background: transparent; }
      .types-header.vertical-header .vertical-top-block { position: absolute; top: 18px; left: 16px; right: 16px; display: flex; justify-content: center; }
      .types-header.vertical-header .info-container { position: absolute; bottom: 12px; left: 16px; right: 16px; height: 40px; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; }
      .types-header.vertical-header .primary,
      .types-header.vertical-header .secondary { text-align: center; width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      /* Keep the subtitle clear of the bottom-right chevron: symmetric padding
         keeps it centered while ellipsizing before it reaches the button. */
      .types-header.vertical-header .secondary { padding: 0 28px; box-sizing: border-box; }
      .types-header.vertical-header .types-chevron { position: absolute; bottom: 8px; right: 10px; --mdc-icon-size: 22px; opacity: .85; }
      .types-header.vertical-header .header-quantity { position: absolute; top: 30px; left: 16px; right: 16px; width: auto; justify-content: space-between; }
      .types-header.vertical-header .header-quantity .quantity { display: none; }
      .types-header.vertical-header .header-quantity-badge { display: flex; top: 14px; left: calc(50% + 10px); }
      .types-header.vertical-header.has-header-quantity .variant-count-badge { display: none; }
      .type-row, .base-item-row { display: flex; align-items: center; gap: 10px; min-height: 44px; box-sizing: border-box; padding: 7px 12px 7px 14px; cursor: pointer; border-top: 1px solid var(--divider-color); transition: background-color .2s; outline: none; }
      .base-item-row { display: none; }
      .type-row:hover, .base-item-row:hover { background: var(--secondary-background-color); }
      .type-row:focus-visible, .base-item-row:focus-visible { box-shadow: 0 0 0 2px var(--primary-color) inset; }
      .type-row.is-updating, .base-item-row.is-updating { opacity: .6; pointer-events: none; }
      .type-thumb { width: 28px; height: 28px; flex-shrink: 0; }
      .type-thumb img { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; }
      .type-thumb ha-icon { --mdc-icon-size: 28px; color: var(--secondary-text-color); }
      .type-thumb .type-image-fallback, .type-thumb.image-error img { display: none; }
      .type-thumb.image-error .type-image-fallback { display: inline-flex; }
      .type-name { flex: 1; min-width: 0; font-size: 14px; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .type-qty { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
      .type-indicator { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
      .type-indicator ha-icon { --mdc-icon-size: 20px; }
      .type-indicator.type-add ha-icon { color: var(--secondary-text-color); opacity: .45; }
         @container shopping-variants (max-width: 219px) {
            .types-header:not(.vertical-header) { grid-template-columns: 36px minmax(0, 1fr) 24px; }
            .types-header:not(.vertical-header) .types-chevron { grid-column: 3; }
            .types-header .header-quantity { display: none; }
            .header-quantity-badge { display: flex; }
            .base-item-row { display: flex; }
            .type-row, .base-item-row { flex-wrap: wrap; gap: 6px; padding: 8px; }
            .type-name { flex-basis: 70px; white-space: normal; overflow-wrap: anywhere; }
            .type-qty { margin-inline-start: auto; max-width: 100%; }
            .type-qty .quantity { min-width: 0; }
         }
         @container shopping-variants (max-width: 139px) {
            .types-header:not(.vertical-header) { grid-template-columns: minmax(0, 1fr) 24px; gap: 4px; padding-inline: 6px; }
            .types-header:not(.vertical-header) > .icon-wrapper,
            .types-header:not(.vertical-header) > .image-wrapper { display: none; }
            .types-header:not(.vertical-header) > .info-container { grid-column: 1; }
            .types-header:not(.vertical-header) .types-chevron { grid-column: 2; }
            .types-header:not(.vertical-header).has-header-quantity { grid-template-columns: minmax(0, 1fr) 20px 24px; }
            .types-header:not(.vertical-header).has-header-quantity .types-chevron { grid-column: 3; }
            .types-header:not(.vertical-header) .header-quantity-badge { position: static; grid-column: 2; grid-row: 1; box-sizing: border-box; width: 20px; min-width: 0; height: 20px; padding: 0; }
            .type-row, .base-item-row { padding: 6px 4px; gap: 6px 4px; }
            .type-qty { flex-basis: 100%; justify-content: space-between; }
         }
`;
