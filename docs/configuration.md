# Configuration Reference

[README](../README.md) | [Using the card](usage.md) | [JSON catalog setup](../examples/auto-generated-grid/)

Both modes use `type: custom:shopping-list-card`. Choose **Single** or **Catalog** at the top of the visual editor; YAML is optional.

## Single Options

Single mode needs an existing to-do entity and a product title. It does not need a catalog sensor. Omit `mode` or set it to `single`.

| Name | Type | Required | Description | Default |
|---|---|---|---|---|
| `type` | string | yes | Must be `custom:shopping-list-card`. | - |
| `mode` | string | no | `single` for one product or `catalog` for the sensor-backed catalog. | `single` |
| `title` | string | yes | The item name. | - |
| `subtitle` | string | no | Secondary text included in the stored name: `"<title> - <subtitle>"`. | `''` |
| `types` | list or string | no | Expandable variants: strings, `{ name, image, icon }` objects, or a comma-separated string. Each matches `"<title> - <type>"`. The header targets the title, with `subtitle` when configured. | - |
| `types_sort` | string | no | Variant order: `none` (source order), `asc` (A-Z), or `desc` (Z-A). Case-insensitive with natural numeric sorting. | `none` |
| `todo_list` | string | yes | The `todo.<name>` entity to manage. | - |
| `list_prefix` | string | no | Store names as `"<prefix> - <title>"`; does not change the displayed title or automatically sort the list. | `''` |
| `image` | string | no | Explicit image URL, replacing the icon when it loads. | `''` |
| `image_base` | string | no | Base path for PNG images derived from the title. Used when `image` is empty. | `''` |
| `layout` | string | no | `horizontal` or `vertical`. | `horizontal` |
| `show_name` | boolean | no | Set to `false` for an icon-only card. | `true` |
| `enable_quantity` | boolean | no | Show quantity controls for selected items. | `false` |
| `quantity_step` | number | no | Amount added or subtracted per quantity-button tap. | `1` |
| `quantity_max` | number | no | Optional upper quantity limit. | - |
| `remove_zero` | boolean | no | Normal removal deletes the item. Set `false` to keep a zero-quantity entry and always suffix quantities, such as `Milk (0)`. Explicit hold removal still deletes it. | `true` |
| `on_icon` | string | no | Icon when selected. | `mdi:check` |
| `on_color` | string | no | Selected-state color: an HA color name or hex value. | `green` |
| `off_icon` | string | no | Icon when not selected. | `mdi:plus` |
| `off_color` | string | no | Unselected-state color. | `grey` |
| `colorize_background` | boolean | no | Tint the background with the selected-state color. | `true` |
| `hold_action` | object | no | `{ action: 'default' \| 'more-info' \| 'none' }`. Default removes the item, or the header's whole variant group. | `{ action: 'default' }` |
| `haptic` | boolean | no | Haptic feedback on supported mobile clients. | `false` |

```yaml
type: custom:shopping-list-card
mode: single
title: Milk
todo_list: todo.shopping_list
layout: vertical
enable_quantity: true
quantity_step: 1
quantity_max: 10
image: /local/shopping/milk.png
on_color: blue
colorize_background: true
hold_action:
  action: more-info
haptic: true
```

Names and prefixes determine which existing to-do item a card matches. Changing them does not rename existing list entries. See [quantities](usage.md#quantities), [variants](usage.md#variants), and [images](usage.md#images) for behavior and examples.

## Catalog Options

Catalog mode reads products from a sensor and stores selections in the to-do integration. It cannot read a JSON file path directly or write to the catalog source.

| Option | Required | Description | Default |
|---|---|---|---|
| `mode` | Yes | Set to `catalog` on `custom:shopping-list-card`. | `single` when omitted |
| `catalog_entity` | Yes | Sensor containing the shared product catalog. | - |
| `todo_list` | Yes | Existing to-do entity used by every product tile. | - |
| `catalog_attribute` | No | Attribute containing the entire category map, as an object or JSON string. | Category arrays directly in sensor attributes |
| `title` | No | Catalog heading. | `Shopping` |
| `columns` | No | Grid columns, from 1 to 6. A responsive maximum unless `fixed_columns` is enabled. | `4` |
| `fixed_columns` | No | Keep exactly `columns` tracks at every container width, including phones. | `false` |
| `categories` | No | Exact category names to display. Omit for all; `[]` displays none. Missing names do not fall back to other categories. | All categories |
| `show_category_tabs` | No | Show the category selector. When hidden, all allowed categories appear together. | `true` |
| `show_search` | No | Show search. Disabling it clears the active search. | `true` |
| `show_title` | No | Show the main heading. | `true` |
| `show_item_count` | No | Show the top visible/total product count. Category-tab and section counts are independent. | `true` |
| `show_list_button` | No | Show the button that opens the full native to-do list. | `true` |
| `show_add_button` | No | Show quick-add for a missing shopping-list item. | `true` |
| `item_options` | No | Shared Single-mode defaults, such as layout, images, quantities, colors, and hold behavior. Product settings override these, but cannot change `todo_list`. | Vertical tiles with quantities enabled |

The visual editor detects valid direct or wrapped catalog data when you select a sensor. Its status shows category/product counts or a source error. It does not silently repair an existing saved configuration; use the offered source suggestion to apply a detected attribute.

**Starter JSON** downloads example data only. It does not create a sensor, overwrite a file, or add shopping-list entries. Use the [setup guide](../examples/auto-generated-grid/) to connect a JSON source.

### Responsive or Fixed Columns

```yaml
type: custom:shopping-list-card
mode: catalog
catalog_entity: sensor.shopping_list_items
todo_list: todo.shopping_list
title: Shopping
columns: 3
fixed_columns: true
show_item_count: false
item_options:
  layout: horizontal
  enable_quantity: true
```

This example always has three columns. For responsive sizing, omit `fixed_columns` or set it to `false`. Fixed columns do not reduce on phones; choose a count that leaves enough room for names and controls.

In the editor, use **Catalog > Fixed columns** and **Display > Item count**. The count measures visible products, not the sum of their quantities.

### Category Subsets and Hidden Controls

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
show_item_count: false
show_list_button: false
show_add_button: false
```

These settings affect only this card, not other dashboards or the source data. Hiding tabs resets the selected category. Category headings remain visible when the main title is hidden. Hiding the title, item count, list button, and add button removes the unused header row entirely.

## Dashboard Sizing

In a native Sections dashboard, let expanded variants grow vertically:

```yaml
grid_options:
  columns: full
  rows: auto
```

Use this on the outer Shopping List Card, not inside `item_options`. A fixed row height can clip expanded content. See the [complete Sections dashboard](../examples/auto-generated-grid/dashboard.yaml).