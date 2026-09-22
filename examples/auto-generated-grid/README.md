# Auto-generated categorized shopping grid

Render your entire shopping catalog as a categorized grid of shopping-list-cards, driven by a single JSON file. Add, remove, or reorganize items by editing the JSON; the dashboard rebuilds itself on the next sensor poll.

## Native Catalog Alternative

The same JSON and sensor can also drive `custom:shopping-list-card` with `mode: catalog` directly. In the visual editor, choose **Card mode > Catalog**. Use [catalog-card.yaml](catalog-card.yaml) instead of the generated grid to get built-in categories, search, and an **On list** filter without `layout-card` or `auto-entities`. The existing to-do list is unchanged, and the old grid can remain on another dashboard.

Both explicit `types` and flat entries such as multiple `Chicken` rows with different `subtitle` values are supported. Compatible flat rows in one category become a single product with a variant dropdown; no JSON rewrite is needed.

Each dashboard can reference the same sensor and to-do list. Edit the catalog in the shared JSON source; this card does not save changes back to the file. New top-level category keys must also be exposed in the sensor's `json_attributes` list. They become available after the sensor refreshes.

## Files in this folder

| File | Where it lives | Purpose |
|---|---|---|
| [`shopping_items.json`](shopping_items.json) | `/config/shopping_items.json` | Your catalog: categories → list of `{ title, subtitle? }` items. |
| [`sensor.yaml`](sensor.yaml) | Included in `configuration.yaml` | A `command_line` sensor that loads the JSON as attributes. |
| [`dashboard.yaml`](dashboard.yaml) | Your Lovelace dashboard | A `layout-card` + `auto-entities` combo that renders one grid per category. |
| [`catalog-card.yaml`](catalog-card.yaml) | Your Lovelace dashboard | Native catalog alternative using the same JSON-backed sensor and to-do list. |

## Requirements

For the generated-grid version, install these via HACS. The native catalog alternative only needs this repository's card bundle and the source sensor:

- [`custom:shopping-list-card`](https://github.com/eyalgal/ha-shopping-list-card) (this repo)
- [`custom:layout-card`](https://github.com/thomasloven/lovelace-layout-card)
- [`custom:auto-entities`](https://github.com/thomasloven/lovelace-auto-entities)

## Setup (3 steps)

1. **Copy the JSON.** Save `shopping_items.json` to `/config/shopping_items.json` and edit it to match your categories and items.
2. **Add the sensor.** Merge the `command_line:` block from `sensor.yaml` into your `configuration.yaml`, then restart Home Assistant. You should now have `sensor.shopping_list_items` with one attribute per category.
3. **Add the card.** Create (or edit) a Lovelace view in raw config editor mode and paste the contents of `dashboard.yaml`.

## How it works

- The JSON groups items by category. Each item has a `title` and optional `subtitle`.
- The `command_line` sensor runs `cat /config/shopping_items.json` on every scan and exposes each top-level key as a state attribute. `value_template: "{{ now().timestamp() }}"` forces the state to change on every poll so the template re-evaluates even if the file is unchanged.
- The dashboard template loops through categories, sorts each category's items by title, and produces one `type: grid` per non-empty category. Each item becomes a `custom:shopping-list-card` pointing at `todo.shopping_list`.

## Customizing

- **Per-card options** - edit the dict inside the template. Any option the card supports works here (icons, colors, `list_prefix`, `hold_action`, etc.).
- **Image auto-derive** - the included template sets `image_base: /local/images/shopping-list/`. Drop files named `apple.png`, `baby-carrots.png`, etc. into `/config/www/images/shopping-list/` and they'll show automatically.
- **Category sorting on the to-do list** - set `list_prefix: "{{ cat }}"` inside the item dict to store items as `"Fruits - Apple"` on the list itself.
- **Column count** - change `columns: 5` (grid) or `columns: 6` (per-card grid_options) to suit your screen.

## Example JSON format

```json
{
  "Fruits": [
    { "title": "Apple" },
    { "title": "Grapes", "subtitle": "Green" }
  ],
  "Dairy and Eggs": [
    { "title": "Milk", "subtitle": "Lactose-free" }
  ]
}
```
