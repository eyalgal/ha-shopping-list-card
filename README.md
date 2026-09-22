# 🛍️ Shopping List Card
[![GitHub Release][release_badge]][release]
[![Downloads][downloads_badge]][release]
[![Community Forum][forum_badge]][forum]
[![Buy Me A Coffee][bmac_badge]][bmac]

<!-- Link references -->
[release_badge]: https://img.shields.io/github/v/release/eyalgal/ha-shopping-list-card
[release]: https://github.com/eyalgal/ha-shopping-list-card/releases
[downloads_badge]: https://img.shields.io/github/downloads/eyalgal/ha-shopping-list-card/total.svg
[forum_badge]: https://img.shields.io/badge/Community-Forum-5294E2.svg
[forum]: https://community.home-assistant.io/t/shopping-list-card-a-simple-card-for-quick-adding-items-to-any-to-do-list/905005
[bmac_badge]: https://img.shields.io/badge/buy_me_a-coffee-yellow
[bmac]: https://www.buymeacoffee.com/eyalgal

A simple and intuitive Lovelace card for Home Assistant to quickly add and manage items on any to-do list. Tap to add, tap again to remove, bump quantity with +/-, and let the card automatically pick up your product images. Works with the native `todo` integration and any integration that exposes a `todo.<name>` entity (Bring!, Todoist, Local To-do, etc.).

<img src="https://github.com/user-attachments/assets/005161c4-abdc-4dca-a604-0386e69cae90" alt="Shopping List Card Preview" width="700"/>

> *The list at the bottom of the screenshot is the standard `type: todo-list` [card](https://www.home-assistant.io/lovelace/todo-list/), used here to display the full list.*

## ✨ Features

- **Tap to add / tap to remove** with case-insensitive matching against an existing to-do list.
- **Real-time updates** via a shared WebSocket subscription per entity (one subscription covers every card pointing at the same list, so a grid of 50 cards does not fan out into 50 sockets).
- **Reliable recovery** with shared reconnect retries, visible connection and action errors, and pending-write protection across tiles for the same item. Refreshing an error only reloads the list; it never repeats a write.
- **Quantity controls** - enable `+` / `-` buttons with optional `quantity_step` and `quantity_max`.
- **Item types (variants)** - give one item several `types` (e.g. _Apple_ -> Pink Lady, Granny Smith, Gala). The card collapses to a single tile; tap to expand and add any type (with its own quantity) as `Title - Type`.
- **Hold action** - configurable long-press: remove item (default), open more-info, or do nothing. Optional haptic feedback.
- **Custom images, auto-derived** - set an `image_base` path and the card tries `title.png` in several slug variants (`dash-case`, `snake_case`, `with spaces`, `joinedword`) so you don't have to name your files exactly right.
- **List prefix** - optionally store items as `"Dairy - Milk"` for category-based sorting while the card still displays just the title.
- **Theme-aware colors** - HA color names like `red`, `blue`, `green` follow your theme; unknown variables fall back to sensible hex defaults so the card never renders blank.
- **Two layouts** - horizontal (icon left, text right) or vertical (icon on top, great for grid dashboards). `show_name: false` produces an icon-only card.
- **Colorize background** - optional tinted background matching the on-state color.
- **Polished visual editor** - collapsible sections for Content / Layout & Display / Icons & Colors / Behavior, native icon picker, color swatches, image upload.
- **Accessible** - proper `role`, `aria-pressed`, `aria-label`, keyboard-activatable quantity buttons, error states surfaced via `ha-alert`.
- **XSS-safe** - all user content is escaped before insertion.

When the list is loading, disconnected, or not yet confirmed after an update, item changes are temporarily blocked. The card does not queue offline changes or automatically retry failed adds, removals, or quantity updates.

## ✅ Prerequisites

- **A to-do entity.** Either the built-in [Local To-do](https://www.home-assistant.io/integrations/local_todo/) integration or any third-party integration that exposes a `todo.<your_list>` entity (Bring!, Todoist, etc.). Add it under **Settings → Devices & Services → Add Integration**.

> If no to-do entities are found, the visual editor shows a helpful message with a link to the `todo` docs.

## 🚀 Installation (HACS)

Shopping List Card is available in [HACS](https://hacs.xyz/).

[![Open your Home Assistant instance and open a repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=eyalgal&repository=ha-shopping-list-card)

_or_

1. Install HACS if you don't already have it.
2. Open HACS in Home Assistant.
3. Search for "Shopping List Card".
4. Click download.

## Card Modes

Add **Shopping List Card** from the dashboard card picker, then choose **Single** or **Catalog** using **Card mode** at the top of its visual editor. Both modes use `type: custom:shopping-list-card`.

- `mode: single` displays one product with its optional variants. Omitting `mode` also selects Single.
- `mode: catalog` displays the shared sensor-backed product catalog. Its settings include the source sensor, categories, display controls, and product defaults.

The separate `custom:shopping-list-catalog-card` type has been removed. Replace it with `type: custom:shopping-list-card` and add `mode: catalog`; the remaining catalog settings stay the same. There is no alias for the removed type.

## Native Catalog

Choose **Catalog** mode to display a shared product catalog with category tabs, search, and an **On list** filter. It does not require `auto-entities` or `layout-card`.

The catalog is not another shopping list. A sensor provides the available products, and the existing `todo` entity stores the items and quantities you need to buy. The catalog uses the same product tiles, variants, quantity controls, and hold actions as single-product cards.

For the [existing JSON-backed sensor example](examples/auto-generated-grid/), the complete card configuration can be:

```yaml
type: custom:shopping-list-card
mode: catalog
catalog_entity: sensor.shopping_list_items
todo_list: todo.shopping_list
title: Shopping
columns: 4
item_options:
  image_base: /local/images/shopping-list/
```

Replace the example entity IDs with your own. Select **Shopping List Card > Card mode > Catalog** to access the sensor/list pickers, column count, and product defaults. Existing generated grids can remain alongside it; no list migration or item renaming is required.

### Catalog Source

By default, each array-valued sensor attribute is treated as a category. Other attributes, such as `friendly_name`, are ignored. Each product is an object with a required `title` and optional single-product card fields such as `subtitle`, `types`, `image`, `icon` variants, and `list_prefix`. The existing example JSON works unchanged:

```json
{
  "Fruits": [
    { "title": "Apple", "subtitle": "Pink Lady", "types": "Pink Lady, Granny Smith, Gala" },
    { "title": "Pear" }
  ],
  "Dairy": [
    { "title": "Milk" },
    { "title": "Milk", "subtitle": "Lactose-free" }
  ]
}
```

Flat catalogs are supported too. Repeated products with the same title and compatible settings in one category are grouped into a variant dropdown using their subtitles. For example, separate `Chicken` entries with `subtitle: Breast` and `subtitle: Legs` become one Chicken tile with both variants. A bare entry is used for the header when present; otherwise the first subtitle remains the header's default. Stored to-do names are unchanged, and per-variant images are preserved.

Explicit `types` entries and products with their own `id` remain as configured. Products with different list prefixes, quantity limits, or other behavior/display options are not merged. Single subtitle entries remain ordinary tiles. Groups appear where their first member occurred; other products retain their source order.

If the entire category map is in one attribute, set `catalog_attribute` to its name. That attribute may contain an object or a JSON string. Categories follow the source order. Category names do not automatically become list prefixes.

### Catalog Options

| Option | Required | Description | Default |
|---|---|---|---|
| `mode` | Yes | Set to `catalog` on `custom:shopping-list-card`. | `single` when omitted |
| `catalog_entity` | Yes | Sensor containing the shared product catalog. | - |
| `todo_list` | Yes | Existing to-do entity used by every product tile. | - |
| `catalog_attribute` | No | Attribute containing the entire category map. | Category arrays directly in sensor attributes |
| `title` | No | Catalog heading. | `Shopping` |
| `columns` | No | Maximum number of grid columns, from 1 to 6. Narrow containers use fewer columns. | `4` |
| `categories` | No | Category names to display. Omit for all categories; an empty list displays none. Missing names never fall back to showing other categories. | All categories |
| `show_category_tabs` | No | Show the category selector. When `false`, all allowed categories are displayed together. | `true` |
| `show_search` | No | Show the catalog search box. Disabling it clears any active search. | `true` |
| `show_title` | No | Show the main catalog heading. | `true` |
| `show_list_button` | No | Show the button that expands the full native Home Assistant to-do list. | `true` |
| `show_add_button` | No | Show the quick-add button for a missing shopping-list item. | `true` |
| `item_options` | No | Shared single-product defaults, such as `layout`, `image_base`, `enable_quantity`, colors, and `hold_action`. Per-product values override these defaults. | Vertical tiles with quantity controls enabled |

In the visual editor, **Display** contains category checkboxes and the visibility switches. For a fixed view of selected categories without navigation, search, or a title:

```yaml
type: custom:shopping-list-card
mode: catalog
catalog_entity: sensor.shopping_list_items
todo_list: todo.shopping_list
categories:
  - Fruits
  - Dairy and Eggs
show_category_tabs: false
show_search: false
show_title: false
```

Omit `categories` to show every category together. These options only affect this card, not other dashboards or the shared catalog. Disabling category tabs clears the previous selected tab. Category section headings remain visible when the main title is hidden.

Products cannot override the catalog's target `todo_list`. Search matches category, title, subtitle, and variant names, ignoring case and accents. **On list** includes a product when its header item or any variant is active; kept-zero entries are inactive. The count shows visible catalog products, not the sum of quantities.

### Shopping List and Quick Add

The list icon expands Home Assistant's native `todo-list` card instead of the entity's count-only more-info dialog. It shows the entire selected list, including items that are not in the catalog and completed items. Catalog category/search filters do not restrict this list. Native item editing, completion, and removal follow the capabilities of the to-do integration. Closing the section unloads the native card.

The plus button opens a quick-add field. Type a missing item and submit to add it directly to `todo_list`. This does not add a product to the JSON catalog or apply a catalog category prefix. An existing active item is not added twice, and an existing kept-zero item is reactivated when the list supports updates. The form clears only after Home Assistant confirms the change; failed saves keep the text for correction, and offline writes are not queued. Pending protection is shared with the existing catalog tiles on the same connection.

Adding a permanent catalog product from the card is not supported with the read-only JSON/sensor source. Continue editing the shared JSON for permanent products; the quick-add field is for the shopping list only.

### Sharing and Persistence

- Point each dashboard at the same `catalog_entity` and `todo_list` to share products and shopping selections. No catalog copy is saved in browser storage.
- Shopping selections persist in the to-do integration and update connected devices through Home Assistant. Catalog changes appear when the source sensor refreshes, including after reopening a dashboard.
- Search text, the selected category, the **On list** filter, and expanded variants are local view state. They do not change other dashboards and are not restored after a page reload.
- This version reads the shared catalog; it does not write to the JSON file. Edit products at their source. The sensor must expose new category keys before the card can display them; the example command-line sensor uses an explicit `json_attributes` list and a five-minute scan interval.
- Writes are confirmed by Home Assistant; offline changes are not queued or automatically retried. The shared pending-write guard covers cards on one browser connection, not atomic transactions across devices. Simultaneous edits from separate devices remain subject to the to-do integration's conflict behavior.

---

## ⚙️ Configuration

The card ships with a full visual editor. The following options are for **Single** mode; use the catalog options above for **Catalog** mode.

### YAML example

```yaml
type: custom:shopping-list-card
mode: single
title: Feed Guinness
subtitle: Morning & Evening
todo_list: todo.daily_chores
layout: vertical
enable_quantity: true
quantity_step: 1
quantity_max: 10
image: /local/images/guinness.png
on_color: brown
colorize_background: true
hold_action:
  action: more-info
haptic: true
```

### Options

| Name | Type | Required | Description | Default |
|---|---|---|---|---|
| `type` | string | yes | Must be `custom:shopping-list-card`. | - |
| `mode` | string | no | `single` for one product or `catalog` for the sensor-backed catalog. | `single` |
| `title` | string | yes | The item name. | - |
| `subtitle` | string | no | A secondary line of text. Included when matching/writing: the stored item is `"<title> - <subtitle>"`. | `''` |
| `types` | list or string | no | Turns the card into an expandable group. A list of entries (a string, or `{ name, image, icon }`), or a single comma-separated string like `"Pink Lady, Granny Smith, Gala"` (handy from a JSON catalog). Each is added as `"<title> - <type>"`. Tapping the card header adds the bare title (or `"<title> - <subtitle>"` when `subtitle` is set); the chevron expands the variant list. Works in both `horizontal` and `vertical` layouts. | - |
| `types_sort` | string | no | Order of the variant rows: `none` (as listed), `asc` (A-Z), or `desc` (Z-A). Case-insensitive, natural (numbers sorted numerically). Only used when `types` is set. | `none` |
| `todo_list` | string | yes | The `todo.<name>` entity to manage. | - |
| `list_prefix` | string | no | When set, items are stored as `"<prefix> - <title>"` for category sorting. Display is unchanged. | `''` |
| `image` | string | no | URL to a custom image. Replaces the icon when set. | `''` |
| `image_base` | string | no | Base path for auto-derived images. When set and `image` is empty, the card tries `<image_base><slug>.png` in several slug variants of the title. | `''` |
| `layout` | string | no | `horizontal` or `vertical`. | `horizontal` |
| `show_name` | boolean | no | Set to `false` for an icon-only card. | `true` |
| `enable_quantity` | boolean | no | Show `+` / `-` buttons when the item is on the list. | `false` |
| `quantity_step` | number | no | How much `+` / `-` adjusts per tap. | `1` |
| `quantity_max` | number | no | Optional cap for the quantity. | - |
| `remove_zero` | boolean | no | Delete the item when its quantity hits 0. Set `false` to keep it as `Milk (0)` and always suffix the quantity. | `true` |
| `on_icon` | string | no | Icon when the item is on the list. | `mdi:check` |
| `on_color` | string | no | Color for the on state (HA name like `green`, `teal`, or `#4CAF50`). | `green` |
| `off_icon` | string | no | Icon when the item is not on the list. | `mdi:plus` |
| `off_color` | string | no | Color for the off state. | `grey` |
| `colorize_background` | boolean | no | Tint the whole card with the on-color when on. | `true` |
| `hold_action` | object | no | `{ action: 'default' \| 'more-info' \| 'none' }`. `default` removes the item. | `{ action: 'default' }` |
| `haptic` | boolean | no | Short vibration on tap and hold (mobile only). | `false` |

---

### Custom images

Either set a specific URL, or let the card derive one from the title.

**Explicit URL**

```yaml
type: custom:shopping-list-card
title: Milk
todo_list: todo.shopping_list
image: /local/shopping/milk.png
```

**Auto-derived from title** (new in 2.0)

```yaml
type: custom:shopping-list-card
title: Ice Cream
todo_list: todo.shopping_list
image_base: /local/images/shopping-list/
```

With the title `Ice Cream`, the card tries in order and uses the first that loads:

1. `/local/images/shopping-list/ice-cream.png`
2. `/local/images/shopping-list/ice_cream.png`
3. `/local/images/shopping-list/ice%20cream.png`
4. `/local/images/shopping-list/icecream.png`

If all four fail, the card falls back to the icon.

- Store local images in `/config/www/` and reference them as `/local/...`.
- External URLs work but may be blocked by your browser's CSP.

### Layout options

- **Horizontal** (default): Icon/image on the left, text on the right.
- **Vertical**: Icon/image on top, text below. Great for grid layouts. Images are shown uncropped with their aspect ratio preserved.

### Quantity behavior

When `enable_quantity: true`:

- An item on the list shows its quantity with `+` and `-` buttons.
- If quantity is `1`, the `-` button is hidden and tapping the main card removes the item.
- If quantity is greater than `1`, the `-` button is visible for decrementing.
- `quantity_step` controls how much each tap adjusts by (default `1`).
- `quantity_max` sets an optional cap.

When `remove_zero: false`:

- An emptied item stays on the list as `Milk (0)` instead of being deleted

### List prefix (category sorting)

Set `list_prefix: Dairy` and the card will store items as `"Dairy - Milk"` on your to-do list. The list stays sorted by category, but the card's own UI keeps showing just `Milk`.

```yaml
type: custom:shopping-list-card
title: Milk
list_prefix: Dairy
todo_list: todo.shopping_list
```

---

### Item types (variants)

When you want one tile to cover several variants of the same item, list them under `types`. The card renders as a single tile with a chevron. Tapping the **chevron** expands an inline list of the variants; tapping a variant adds it as `"<title> - <type>"`, so it shows up on your to-do list as e.g. `Apple - Pink Lady`. Tapping again removes it, and `enable_quantity` adds per-variant `+` / `-` controls.

Tapping the **header body** (anywhere but the chevron) adds or removes the header item, exactly like a normal single-item card. By default that is the bare title (`Apple`); if you also set a `subtitle`, the header item is `"<title> - <subtitle>"` (e.g. `Apple - Pink Lady`), so you can keep a default variant available with a single tap while the chevron exposes the rest.

**Holding** clears items in bulk (respecting `hold_action: none`):

- Hold the **header** to remove every item that belongs to this card (the bare title and all of its variants).
- Hold a **variant row** to remove that specific variant entirely, regardless of its quantity.

With `hold_action: { action: more-info }`, holding either the header or a variant opens the list's more-info dialog without removing anything.

Use `types_sort` to order the rows alphabetically (`asc` for A-Z, `desc` for Z-A) instead of the order they are listed.

```yaml
type: custom:shopping-list-card
title: Apple
todo_list: todo.shopping_list
enable_quantity: true
types_sort: asc
types:
  - Pink Lady
  - Granny Smith
  - Gala
```

In the visual editor, **Content > Variants** lets you add, rename, remove, and reorder variants. Expand a row's image/icon settings to upload a picture, enter an image URL, or choose an icon. Move-up and move-down controls are available when **Sort types** is **As listed**.

Names must be nonempty and unique, ignoring case. Invalid edits remain drafts until corrected; the card preview retains the last valid configuration. Renaming or removing a variant changes only the card configuration, not existing to-do items. Renamed variants will match the new name, so existing entries under the old name remain in your list.

Existing string lists, comma-separated strings, and object entries remain supported. Unrelated edits preserve the original format and custom properties. A plain name becomes an object when it gains an image or icon. Objects can also be configured directly in YAML:

```yaml
type: custom:shopping-list-card
title: Apple
todo_list: todo.shopping_list
types:
  - name: Pink Lady
    image: /local/shopping/pink-lady.png
  - name: Granny Smith
    icon: mdi:food-apple-outline
  - Gala
```

Both layouts are supported - add `layout: vertical` for a grid-friendly tile (icon on top, name centered, chevron in the bottom-right). The card keeps its compact shape when collapsed and expands the variant list below.

> Because the card grows when expanded, it works best in masonry or grid dashboards where the row height can flex. In the **sections** layout a fixed row height may clip the expanded list.

---

## Development

Use Node.js 22.13 or newer. Run `npm ci`, then `npm run check` to lint, build, and run the regression tests. The root `shopping-list-card.js` is the generated HACS artifact and must be rebuilt and committed with source changes.

Source ownership:

- `src/shopping-list-card.js`: card rendering and interactions.
- `src/todo-store.js`: shared subscriptions, recovery, stale-response protection, and pending writes.
- `src/item-model.js`: naming, quantity actions, and lossless variant updates.
- `src/editor.js` and `src/variants-editor.js`: the visual configuration editor and variant rows.
- `src/catalog-card.js`, `src/catalog-model.js`, and `src/catalog-editor.js`: the sensor-backed catalog view, data validation, and configuration editor.
- `src/card-defaults.js` and `src/card-styles.js`: shared defaults and card styling.

Tests use mocked Home Assistant services and a DOM implementation; they never connect to a real shopping list. CI tests Node.js 22 and 24 and checks that the committed bundle matches the source.

Serve the repository on a local HTTP server to open `tests/browser.html?catalog` for the full sample catalog, `?catalog&editor` for its settings, or `?editor` for the variants editor. These fixtures use fake list data and simulated Home Assistant controls.

---

## 📚 Examples

- **[Auto-generated categorized grid](examples/auto-generated-grid/)** - drive an entire categorized shopping dashboard from a single JSON file. One `custom:shopping-list-card` per item, grouped into category grids, rebuilt automatically when you edit the JSON. Combines this card with [`layout-card`](https://github.com/thomasloven/lovelace-layout-card) and [`auto-entities`](https://github.com/thomasloven/lovelace-auto-entities).

---

## ❤️ Support

If you find this card useful and would like to show your support, you can buy me a coffee:

<a href="https://coff.ee/eyalgal" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 60px !important;width: 217px !important;" ></a>
