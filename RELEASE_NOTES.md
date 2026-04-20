# v2.0.0 - A big leap from 1.4.0

This release rolls up everything since `v1.4.0` into one major version. New features, real-time updates, a rebuilt editor, and compatibility with Home Assistant 2026.x.

> 🎉 **Upgrading from 1.4.0?** No breaking config changes. All existing YAML keeps working. The `enable_quantity` flag, icon/color options, layout, and image URLs behave the same as before.

## ✨ Highlights

- **Auto-derived images.** Set `image_base: /local/images/shopping-list/` and the card automatically looks for `<slug>.png` based on the title, trying dash / underscore / space / joined variants. `"Ice Cream"` matches `ice-cream.png`, `ice_cream.png`, `ice cream.png`, or `icecream.png`, whichever exists.
- **Category sorting via `list_prefix`.** Store items as `"Dairy - Milk"` for sorted grouping on the to-do list, while the card still displays just `Milk`.
- **Real-time updates.** Todo changes push to the card over WebSocket instead of polling, and a shared subscription manager keeps one socket per entity no matter how many cards point at it.
- **Rebuilt visual editor.** Collapsible sections (Content / Layout & Display / Icons & Colors / Behavior), native color swatches, image upload via `ha-picture-upload`, and a proper icon picker.
- **Theme-aware colors.** Color names follow your theme's `--rgb-*` variables with safe hex fallbacks, so the card never renders blank when a theme is missing a variable.
- **Hold action + haptics.** Long-press can remove the item (default), open more-info, or do nothing. Optional vibration feedback on mobile.
- **Quantity controls** gained `quantity_step` (how much each tap adjusts by) and `quantity_max` (cap).
- **Icon-only mode.** `show_name: false` hides the title/subtitle for tight grid dashboards.

## 📦 New configuration options

| Option | Added in | Description |
|---|---|---|
| `show_name` | 1.6.0 | Hide title/subtitle for an icon-only card. |
| `hold_action` | 1.5.0 | `{ action: 'default' \| 'more-info' \| 'none' }`. |
| `haptic` | 1.5.0 | Short vibration on tap and hold. |
| `quantity_step` | 1.7.0 | How much `+` / `-` adjusts per tap. |
| `quantity_max` | 1.7.0 | Optional cap for the quantity. |
| `list_prefix` | 1.8.0 | Store items as `"<prefix> - <title>"` for category sorting. |
| `image_base` | 1.8.0 | Auto-derive the image URL from the title (tries several slug variants). |

## 🐛 Bug fixes & internals

- Case-insensitive matching uses UIDs so completed items with the same name no longer collide (1.5.0).
- Correct grid row counts for vertical layout (1.6.0).
- Stopped re-rendering on every `hass` update (fixed hover flicker on busy dashboards) (1.6.1).
- One WebSocket subscription per entity, shared across cards (1.6.2).
- Horizontal no-name layout centers its quantity controls correctly (1.7.0 / 1.7.1).
- Themed `ha-card` border no longer adds 2 extra pixels of height (1.7.2).
- `ha-picture-upload` lazy-loads reliably (1.7.3).
- Default grey/green colors render on themes that don't define `--rgb-grey` or `--rgb-green` (1.7.4).
- Layout / hold-action dropdowns work again on **Home Assistant 2026.x**, which rewrote `ha-select` to use `ha-dropdown` internally and ignore slotted `<mwc-list-item>` children (1.7.5 / 1.8.0).
- Auto-derived image slugs preserve underscores and try multiple separator styles (1.8.1 / 1.8.2).

## 🔐 Security & a11y (since 1.5.0-beta)

- All user-facing strings are escaped before insertion into the DOM (XSS hardening).
- `role`, `aria-pressed`, `aria-label`, keyboard-activatable quantity buttons.
- Errors surface through `ha-alert` instead of inline HTML.
- Card element registration is guarded against double-registration.

## 📜 Consolidated changelog (v1.4.0 → v2.0.0)

- **1.5.0** - XSS escaping, accessibility, `hold_action`, `haptic`, uid-based item tracking; restored `setConfig` and registration guard.
- **1.6.0** - Real-time subscriptions, `show_name`, `ha-alert` errors, correct grid rows.
- **1.6.1** - Stop re-rendering on every `hass` update.
- **1.6.2** - Shared WebSocket subscription per entity.
- **1.7.0** - Editor rewrite, theme-aware colors, horizontal no-name fix, `quantity_step`, `quantity_max`.
- **1.7.1** - Image upload, editor polish, horizontal no-name alignment.
- **1.7.2** - Absorb themed border (no more 2px too tall).
- **1.7.3** - Layout dropdown + image upload fixes.
- **1.7.4** - Hex fallback for `--rgb-*` color vars.
- **1.7.5** - Cache `ha-select` value from event detail.
- **1.8.0** - HA 2026.x `ha-select` compatibility, `list_prefix`, `image_base`.
- **1.8.1** - Preserve underscores in `image_base` slug.
- **1.8.2** - Try multiple slug variants (dash / underscore / space / joined).
- **2.0.0** - Rollup release.
