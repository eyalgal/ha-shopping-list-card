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
- **Quantity controls** - enable `+` / `-` buttons with optional `quantity_step` and `quantity_max`.
- **Hold action** - configurable long-press: remove item (default), open more-info, or do nothing. Optional haptic feedback.
- **Custom images, auto-derived** - set an `image_base` path and the card tries `title.png` in several slug variants (`dash-case`, `snake_case`, `with spaces`, `joinedword`) so you don't have to name your files exactly right.
- **List prefix** - optionally store items as `"Dairy - Milk"` for category-based sorting while the card still displays just the title.
- **Theme-aware colors** - HA color names like `red`, `blue`, `green` follow your theme; unknown variables fall back to sensible hex defaults so the card never renders blank.
- **Two layouts** - horizontal (icon left, text right) or vertical (icon on top, great for grid dashboards). `show_name: false` produces an icon-only card.
- **Colorize background** - optional tinted background matching the on-state color.
- **Polished visual editor** - collapsible sections for Content / Layout & Display / Icons & Colors / Behavior, native icon picker, color swatches, image upload.
- **Accessible** - proper `role`, `aria-pressed`, `aria-label`, keyboard-activatable quantity buttons, error states surfaced via `ha-alert`.
- **XSS-safe** - all user content is escaped before insertion.

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

## ⚙️ Configuration

The card ships with a full visual editor. Just add it to your dashboard and fill out the form.

### YAML example

```yaml
type: custom:shopping-list-card
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
| `title` | string | yes | The item name. | - |
| `subtitle` | string | no | A secondary line of text. Included when matching/writing: the stored item is `"<title> - <subtitle>"`. | `''` |
| `todo_list` | string | yes | The `todo.<name>` entity to manage. | - |
| `list_prefix` | string | no | When set, items are stored as `"<prefix> - <title>"` for category sorting. Display is unchanged. | `''` |
| `image` | string | no | URL to a custom image. Replaces the icon when set. | `''` |
| `image_base` | string | no | Base path for auto-derived images. When set and `image` is empty, the card tries `<image_base><slug>.png` in several slug variants of the title. | `''` |
| `layout` | string | no | `horizontal` or `vertical`. | `horizontal` |
| `show_name` | boolean | no | Set to `false` for an icon-only card. | `true` |
| `enable_quantity` | boolean | no | Show `+` / `-` buttons when the item is on the list. | `false` |
| `quantity_step` | number | no | How much `+` / `-` adjusts per tap. | `1` |
| `quantity_max` | number | no | Optional cap for the quantity. | - |
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

### List prefix (category sorting)

Set `list_prefix: Dairy` and the card will store items as `"Dairy - Milk"` on your to-do list. The list stays sorted by category, but the card's own UI keeps showing just `Milk`.

```yaml
type: custom:shopping-list-card
title: Milk
list_prefix: Dairy
todo_list: todo.shopping_list
```

---

## 📚 Examples

- **[Auto-generated categorized grid](examples/auto-generated-grid/)** - drive an entire categorized shopping dashboard from a single JSON file. One `custom:shopping-list-card` per item, grouped into category grids, rebuilt automatically when you edit the JSON. Combines this card with [`layout-card`](https://github.com/thomasloven/lovelace-layout-card) and [`auto-entities`](https://github.com/thomasloven/lovelace-auto-entities).

---

## ❤️ Support

If you find this card useful and would like to show your support, you can buy me a coffee:

<a href="https://coff.ee/eyalgal" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 60px !important;width: 217px !important;" ></a>
