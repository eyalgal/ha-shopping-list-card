# JSON Shopping Catalog

Use **Catalog** mode in Shopping List Card to browse products from one shared JSON-backed sensor. Categories, search, variants, quantities, the full shopping list, and quick-add are built in. No generated tile template, `auto-entities`, or `layout-card` is needed.

Catalog mode requires Shopping List Card **2.2.0 or later**. For a test build, follow the installation instructions on the [release page](https://github.com/eyalgal/ha-shopping-list-card/releases).

This folder keeps its original URL, but the instructions and dashboard example now use Catalog mode. The existing JSON format is still supported; you do not need to convert your catalog.

## What Goes Where

| Data | Where it lives | How to change it |
|---|---|---|
| Available products, categories, and variants | Your JSON file, exposed through a sensor | Edit the JSON and refresh the sensor |
| Items to buy and their quantities | Your existing `todo` entity | Tap products, use quick-add, or open the full list |
| Category restrictions, visibility, and product defaults | This dashboard card's configuration | Use the visual card editor |
| Search, active category, On list filter, expanded variants | The current card view | Use the catalog controls; these reset on reload |

The JSON contains the available products, not the current shopping list. Catalog mode reads that data; it cannot write products back to the file.

## Already Have the JSON Sensor?

Keep your JSON, sensor, image directory, and to-do entity. Skip sensor setup and go directly to [Add the Card](#add-the-card). See [Migrate from a Generated Grid](#migrate-from-a-generated-grid) for moving old tile settings.

## Set Up a New Source

1. Install Shopping List Card through HACS. Create a to-do list through **Settings > Devices & Services > Add Integration > Local To-do**, or use an existing integration that exposes a `todo` entity. Note its actual entity ID.
2. Put your catalog JSON at `/config/shopping_items.json`. Use [shopping_items.json](shopping_items.json) as a starting point, or create a category-to-products map as shown below. With Home Assistant Container, this path is inside the container's configuration mount, not an arbitrary host path.
3. Back up your Home Assistant configuration, then merge the `command_line` sensor from [sensor.yaml](sensor.yaml) into `configuration.yaml`. If `command_line:` already exists, append the sensor entry to that list instead of adding a duplicate key. Keep `json_attributes` in sync with your JSON category names. Command Line is a YAML-configured integration; [its documentation](https://www.home-assistant.io/integrations/command_line/) covers includes and configuration details.
4. Check the configuration before applying it. If Command Line is already loaded, run `command_line.reload` from **Developer Tools > Actions**. For its first setup, restart Home Assistant after the configuration check succeeds.
5. Open **Developer Tools > States** and find the new sensor, normally `sensor.shopping_list_items`. Confirm that its attributes contain product arrays such as `Fruits`. The timestamp state is not a product count; the card reads the attributes. Use the actual entity ID if Home Assistant assigned a different one.

The sample sensor reads the file every 300 seconds. For an immediate refresh after a JSON edit, run `homeassistant.update_entity` targeting your catalog sensor. Changes to the sensor's YAML, such as adding a category to `json_attributes`, also require a configuration check and `command_line.reload`.

## Add the Card

1. Edit the dashboard and choose **Add card > Shopping List Card**.
2. Set **Card mode** to **Catalog**.
3. Select your **Catalog sensor** and **To-do list**. Leave **Catalog attribute** empty for the sensor in this example.
4. Set the title and maximum columns. Under **Product defaults**, set the image base path if you use local product images.
5. Under **Display**, choose all categories or a subset and turn individual controls on or off. Save the card.

The same setup in the card's YAML editor is [catalog-card.yaml](catalog-card.yaml):

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

Replace both entity IDs with your own. This is **one card**, not a complete dashboard. For a separate new dashboard, [dashboard.yaml](dashboard.yaml) provides a complete native Sections configuration containing this card. Do not replace an existing dashboard's unrelated views with that example.

If your sensor puts the whole category map inside one attribute, such as `products`, set `catalog_attribute: products`. It can contain an object or a JSON string. With no `catalog_attribute`, every array-valued sensor attribute is a category; non-array metadata is ignored.

## Use the Catalog

- Tap a product to add it to the list; tap again to remove it. This removes the to-do item, rather than marking it completed.
- Open a product's chevron to choose variants. Tap a variant to add or remove that exact item. The header is also actionable: it uses the bare title, or the title plus subtitle when one is set.
- Use `+` and `-` to adjust quantities. Catalog mode enables these by default. The default hold action removes an item; holding a grouped header clears its configured variants too. Change this under product options if you prefer more-info or no hold action.
- Use category tabs, search, and **On list** to filter catalog tiles. On list does not include uncatalogued items.
- Open the **list icon** for the full native to-do list, including items outside the catalog and completed items. Editing and completion controls depend on the to-do integration. Catalog filters do not restrict this view.
- Open the **plus icon** to add a missing item directly to the shopping list. This is a one-off list addition, not a permanent catalog product. Failed additions keep your draft; disconnected writes are not queued.

Point another dashboard or device at the same sensor and to-do entity to share products and selections. Each card can have different display settings. Pending-write protection is shared within a browser connection, not an atomic lock across devices.

## Product JSON

The top-level object maps exact category names to arrays of products. Each product needs a nonempty `title`. JSON uses double quotes and does not allow comments or trailing commas.

```json
{
  "Fruits": [
    { "title": "Apple" },
    { "title": "Apple", "subtitle": "Pink Lady" },
    { "title": "Pear" }
  ],
  "Dairy and Eggs": [
    { "title": "Milk" },
    { "title": "Milk", "subtitle": "Lactose-free" }
  ]
}
```

These flat rows produce one Apple tile with a Pink Lady variant, one Pear tile, and one Milk tile with a Lactose-free variant. Existing names such as `Apple - Pink Lady` and `Milk - Lactose-free` remain unchanged. When a group has no bare-title entry, its first subtitle remains the header's default.

For explicit variants, replace the relevant product rows with an entry like this:

```json
{
  "title": "Apple",
  "subtitle": "Pink Lady",
  "types": [
    { "name": "Pink Lady", "image": "/local/images/shopping-list/pink-lady.png" },
    { "name": "Granny Smith", "icon": "mdi:food-apple-outline" },
    "Gala"
  ]
}
```

Here a header tap selects `Apple - Pink Lady`, and the chevron exposes all three variants. `types` also accepts plain string arrays or the existing comma-separated string format. Explicit `types` are not regrouped. Flat rows only merge within the same category when their title and behavior/display settings match; explicit product IDs prevent automatic grouping. Per-variant images are retained.

The [product options reference](../../README.md#options) also applies to JSON entries: for example `image`, `list_prefix`, `quantity_max`, `remove_zero`, colors, or `hold_action`. Products always use the Catalog card's `todo_list`; individual entries cannot redirect writes to another list.

Set shared defaults in the card's `item_options`; per-product JSON settings override them. In **Single** mode you can edit variants visually under **Content > Variants**. In **Catalog** mode variants belong to the shared JSON source, not the card editor.

### Images

Place local images under `/config/www/images/shopping-list/` and set `item_options.image_base` to `/local/images/shopping-list/`. A product titled `Baby Carrots` tries PNG filenames based on its title, including `baby-carrots.png` and `baby_carrots.png`; see [image naming](../../README.md#custom-images) for all supported forms. Use `image` on a product or variant for an explicit URL. Missing images fall back to an icon. The card does not download a product-image library for you.

### Categories and Order

Categories and products follow the JSON's order, not the old template's alphabetical sort. Arrange the file to control their order; `types_sort` can sort explicit variant rows. Category names do not automatically prefix to-do item names.

To add a permanent product, edit its category array and refresh the sensor. To add a new category, add it to both the JSON and the sensor's `json_attributes`, reload Command Line, and include it in any card that uses a category allowlist. A JSON edit alone cannot expose a category omitted from that sensor configuration.

Renaming a title, subtitle, variant, or `list_prefix` changes which to-do name the tile matches. It does not rename or delete items already stored in the list. Keep those values unchanged during migration.

## Display Options

For a fixed view without tabs, search, or a main title:

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

Omit `categories` to show all categories together, or specify exact category names to restrict the view. `categories: []` shows none. Hiding the title does not hide category headings. `show_item_count: false` hides the top `X / X` counter without hiding category counts. `show_list_button: false` and `show_add_button: false` hide the full-list and quick-add buttons independently. These settings affect only this card; they do not restrict the underlying to-do list.

`columns` normally sets a responsive maximum. Add `fixed_columns: true` to enforce the exact count at every width, including phones. The same setting is **Catalog > Fixed columns** in the visual editor; **Display > Item count** controls the top counter. Use a count that fits the available space, especially for narrow cards with quantity controls.

See the [catalog options reference](../../README.md#catalog-options) for defaults and supported fields.

## Migrate from a Generated Grid

1. Keep your existing JSON file, sensor, to-do list, and images. Do not overwrite them with the sample data or create a second shopping list.
2. Add the Catalog card alongside the old grid using the same entity IDs. Move shared tile settings such as `image_base`, `enable_quantity`, colors, and `hold_action` into `item_options`. Set the card's `columns` instead of copying the old grid's sizing or Jinja template.
3. Preserve any `list_prefix` used by the old tiles. For a prefix that varied by category, set the corresponding literal prefix on each product in the JSON, or use separate category-restricted cards with that `item_options.list_prefix`. Do not paste Jinja expressions into the catalog configuration; they are not evaluated.
4. Compare existing selections and quantities, then remove the old generated-grid card when satisfied. The new list icon replaces the need for a separate full-list card, though you can keep one alongside it.

`layout-card` and `auto-entities` are no longer dependencies of this example. Only remove their resources if no other dashboard uses them. Flat subtitle rows and explicit `types` both work without a data-format migration.

For an earlier 2.2.0 test build using `custom:shopping-list-catalog-card`, replace the type with `custom:shopping-list-card` and add `mode: catalog`. Keep the other settings; the removed type has no compatibility alias.

## Troubleshooting

| Symptom | Check |
|---|---|
| No Catalog mode or unknown custom card | Install a version with Catalog support and reload the browser or companion app so it loads the new bundle |
| Catalog entity not found or unavailable | Check the actual sensor ID, JSON syntax, file path, and Command Line logs |
| JSON changes do not appear | Wait for the 300-second poll or call `homeassistant.update_entity`; reload Command Line after YAML changes |
| A category is missing | Match its exact name in the JSON, `json_attributes`, and any card `categories` restriction; clear search and On list |
| No variant dropdown | Provide explicit `types` or compatible repeated titles with subtitles in the same category; a lone subtitle row stays a normal tile |
| Images do not load | Open the `/local/...` URL in your browser and check filename case, PNG naming, and the image base path |
| A quick-added item is absent from the catalog | It was added to the to-do list only; open the list icon or add a permanent product to the JSON |
| Existing list items appear unselected | Check the target to-do entity and exact title, subtitle, variant, and prefix; catalog edits do not migrate stored names |

## Files

| File | Purpose |
|---|---|
| [shopping_items.json](shopping_items.json) | Sample catalog with categories, explicit variants, and flat subtitle rows |
| [sensor.yaml](sensor.yaml) | Command Line sensor exposing the sample JSON as category attributes |
| [catalog-card.yaml](catalog-card.yaml) | One Catalog card for an existing dashboard |
| [dashboard.yaml](dashboard.yaml) | Complete new dashboard using a native Sections view and the same Catalog card |
