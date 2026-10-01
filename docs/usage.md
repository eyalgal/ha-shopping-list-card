# Using Shopping List Card

[README](../README.md) | [Configuration reference](configuration.md) | [JSON catalog setup](../examples/auto-generated-grid/)

## Products and Variants

Tap an unselected product to add it to the configured to-do list. Removal deletes an item rather than marking it completed. Quantity-enabled items above one have different tap behavior; see [Quantities](#quantities).

The card matches existing names without case sensitivity. A `subtitle` becomes part of the stored name: Milk with subtitle Lactose-free matches `Milk - Lactose-free`.

### Variants

Use `types` for several versions of one product. The chevron opens and closes the list; the header itself acts on the main item. Each variant matches `"<title> - <type>"` and has an independent quantity.

```yaml
type: custom:shopping-list-card
title: Milk
todo_list: todo.shopping_list
enable_quantity: true
types:
  - Lactose-free
  - Whole
```

Here the header targets plain Milk. Set `subtitle` to target a default variant instead. When the header already matches a configured variant, both controls refer to that same list item.

The header subtitle lists the selected variants with their quantities, such as `Gala (2), Granny Smith`. On vertical tiles, the badge shows the total quantity of selected variants, so that example shows `3`.

At regular widths, the selected header item has its own quantity buttons. Below 220px, it shows a quantity badge; expand the card to adjust the main item in its first row. A main item that already matches a variant is not duplicated. The chevron stays on the header, and quantity changes do not increase the collapsed height.

Expansion is manual and remains open through quantity updates. The chevron works while a write is pending or the list is disconnected. Both horizontal and vertical layouts are supported; use automatic dashboard row height so expanded content is not clipped.

### Editing Variants

In Single mode, open **Content > Variants** in the visual editor. Add, rename, remove, and reorder rows; expand a row's image/icon settings to upload a picture, enter a URL, or choose an icon. Move-up/down is available when **Sort types** is **As listed**. Use `types_sort: asc` or `desc` for alphabetical ordering.

Names must be nonempty and unique, ignoring case. Invalid edits remain drafts while the preview keeps the last valid configuration. Renaming or removing a variant changes the card configuration only; existing to-do entries retain their old names.

String lists, comma-separated strings, and objects remain supported. Unrelated editor changes preserve the saved format and custom properties. A plain name becomes an object when given an image or icon:

```yaml
type: custom:shopping-list-card
title: Apple
todo_list: todo.shopping_list
types_sort: asc
types:
  - name: Pink Lady
    image: /local/shopping/pink-lady.png
  - name: Granny Smith
    icon: mdi:food-apple-outline
  - Gala
```

In Catalog mode, products and variants are edited in the [shared JSON source](../examples/auto-generated-grid/#product-json), not in individual tile editors. Compatible repeated title/subtitle rows are grouped automatically; their stored shopping-list names do not change.

## Quantities

With `enable_quantity: true`:

- A selected item displays its quantity. Use `+` and `-` to adjust it.
- In normal removal mode (`remove_zero: true`), decrement stops at one. At one, the minus button is hidden and tapping the item removes it. Above one, tapping the body does not remove it; decrement to one or use the default hold action.
- `quantity_step` controls the button increment; `quantity_max` sets an optional upper limit.
- With `remove_zero: false`, tapping a selected item sets it to zero instead of deleting it. A zero entry stays in the list as `Milk (0)` but is unselected in the card. Tapping it again restores quantity one. Decrement can also reach zero.

Catalog mode enables quantities by default. Single mode does not. Quantities are stored in the to-do summary, such as `Milk (2)`, rather than only in the browser.

## Hold Actions

The default hold removes an item entirely, regardless of quantity. On a variant header it removes the main item and every configured variant; on a variant row it removes that row only. Explicit hold removal also deletes kept-zero entries.

Set `hold_action: { action: more-info }` to open the list's more-info dialog without removing anything, or `{ action: none }` to disable holds. Optional `haptic: true` uses feedback on supported mobile clients.

## Undo Removal

After a confirmed removal, an **Undo** button appears on the affected product tile, in both Single and Catalog mode. It uses the same style as the quantity buttons and does not change the tile's size. It restores the last confirmed removal batch, including successfully removed variants from a bulk hold. Setting an item to zero is also undoable; ordinary quantity changes are not. Hover or focus the button to see what was removed.

In Catalog mode with **On list** enabled, a removed product stays visible until its Undo expires, so the button remains reachable.

Undo is on by default. Turn it off with `show_undo: false`, or with **Undo button** in the visual editor (**Behavior** in Single mode, **Display** in Catalog mode). Removals still work normally when Undo is off.

- Restores exact names, quantities, and supported descriptions/due dates. Deleted items receive new UIDs and may appear at the end of the list. Original ordering and other provider-specific metadata cannot be restored.
- Refreshes the list first and refuses to overwrite entries that changed or were re-added. Undo is disabled while disconnected or while another card write is pending. The check is not an atomic cross-device transaction.
- Failed restores are never retried automatically. The button turns red and its tooltip shows the error. After a partial restore, only the remaining entries stay available for explicit retry.
- One batch is shared by cards using the same list and browser connection. A later removal replaces it; editing a captured item invalidates that item's Undo. The button disappears after 10 seconds, on reload, or when the last connected card is removed.
- Only removals made through Shopping List Card are captured. Native full-list controls and external apps do not contribute to Undo. It is not persistent or cross-device history.

## Browsing a Catalog

Category tabs, search, and **On list** filter the product tiles. Search ignores case and accents and includes category, title, subtitle, and variant names. **On list** includes a product when its header item or any variant is active; kept-zero entries are inactive. The top count measures visible products, not total quantities.

The visual editor's **Display** section selects category subsets and independently shows or hides controls. Fixed columns, header visibility, and shared product defaults are covered in the [configuration reference](configuration.md#catalog-options).

### Full List and Quick Add

The list icon opens Home Assistant's native to-do list, including items outside the catalog and completed items. Catalog filters do not restrict it. Editing, completion, and removal follow the integration's supported capabilities. Closing the panel unloads that native card.

The plus button adds a one-off item directly to the to-do list. It does not create a catalog product or apply a category prefix. Existing active items are not duplicated; an existing zero item is reactivated when updates are supported. The input clears only after confirmation. Failed saves retain the text, and offline writes are not queued.

For permanent catalog products, edit the shared JSON and refresh its sensor. The card reads the source; it cannot write products back to it.

### Sharing and Persistence

Use the same `catalog_entity` and `todo_list` on each dashboard to share products and selections. No catalog copy is stored in the browser. Shopping selections persist in the to-do integration; catalog edits appear after the source sensor refreshes.

Search, category selection, On list, and expanded variants are local view state and reset on reload. They do not change another dashboard's view. New JSON categories must also be exposed by the sensor; the example Command Line sensor uses explicit `json_attributes` and a five-minute scan interval.

## Images

Use an explicit URL or let the card derive a PNG filename from the title:

```yaml
type: custom:shopping-list-card
title: Milk
todo_list: todo.shopping_list
image: /local/shopping/milk.png
```

```yaml
type: custom:shopping-list-card
title: Ice Cream
todo_list: todo.shopping_list
image_base: /local/images/shopping-list/
```

For Ice Cream, the card tries these names in order:

1. `ice-cream.png`
2. `ice_cream.png`
3. `ice%20cream.png`
4. `icecream.png`

Missing images fall back to the icon. Store local files under `/config/www/` and reference them with `/local/`. External URLs may be blocked by browser security policies. The card does not include or download a product-photo library.

Horizontal layout places the image or icon beside the title; vertical layout places it above. Images retain their aspect ratio without cropping. Colors follow the Home Assistant theme; use named colors or hex values. `show_name: false` makes an icon-only tile, and `colorize_background` controls the selected-state tint.

## List Prefixes

```yaml
type: custom:shopping-list-card
title: Milk
list_prefix: Dairy
todo_list: todo.shopping_list
```

This stores `Dairy - Milk` while displaying Milk. Prefixes can group items when the to-do list is sorted alphabetically, but the card does not sort that list itself. Catalog categories do not automatically become prefixes. Preserve titles, subtitles, variants, and prefixes when moving existing tiles so their selections still match.

## Connection and Action Errors

Cards targeting the same list share one subscription and pending-write protection per browser connection. Loading, disconnected, and unconfirmed states temporarily block item changes. Connection recovery retries reads, not writes; refreshing an error never repeats a mutation.

This protection is not a transaction across devices. Simultaneous edits on separate clients follow the to-do integration's conflict behavior. If an action fails, inspect the visible error and current list state before retrying.