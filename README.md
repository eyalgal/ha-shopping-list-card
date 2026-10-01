# Shopping List Card
[![GitHub Release][release_badge]][release]
[![Downloads][downloads_badge]][release]
[![Community Forum][forum_badge]][forum]

A Home Assistant card that turns your existing to-do list into product tiles or a browsable shopping catalog. Pick products, choose variants, and adjust quantities without typing the same names again.

<img src="https://raw.githubusercontent.com/eyalgal/ha-shopping-list-card/main/docs/images/catalog-hero.png" alt="Shopping catalog with Fruit, Dairy, and Pantry categories, selected products, and expanded Milk variants with independent quantities" width="960"/>

Catalog mode with demo products, category tabs, quantities, and expanded variants.

- **Single or Catalog:** a few favorite products, or a shared catalog with categories, search, and an On list filter.
- **Variants and quantities:** plain Milk and Lactose-free can have separate quantities in one expandable tile.
- **Full list, quick-add, and Undo:** manage the complete list, add a one-off item, or restore an accidental removal.
- **Shared across dashboards:** selections stay in your existing to-do integration, with live updates through Home Assistant.

## Get Started

1. Use an existing `todo` entity or add [Local To-do](https://www.home-assistant.io/integrations/local_todo/) under **Settings > Devices & Services > Add Integration**. Other to-do integrations work according to their supported actions.
2. In [HACS](https://hacs.xyz/), search for **Shopping List Card** and download it.
3. Edit your dashboard, add **Shopping List Card**, and choose **Single** or **Catalog** at the top of the visual editor.
4. Select your to-do list, configure the products or catalog source, and save.

[![Open your Home Assistant instance and open a repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=eyalgal&repository=ha-shopping-list-card)

> Catalog mode and Undo are part of **3.0.0**, currently a **pre-release**. See the [release instructions][release] to install the test version. The release badge above tracks the latest stable release.

## Card Modes

### Single

Use individual tiles for favorites, pantry staples, or recurring tasks. Enter a title and optionally add **Content > Variants**. Customize images, icons, colors, quantities, and horizontal or vertical layout. No sensor is needed.

<details>
<summary>Minimal Single configuration</summary>

```yaml
type: custom:shopping-list-card
title: Milk
todo_list: todo.shopping_list
enable_quantity: true
types:
  - Lactose-free
```

</details>

<a id="native-catalog"></a>

### Catalog

Browse products from a shared JSON-backed sensor. Choose categories, search, open the full list, or quick-add an item. Columns can adapt to available width or stay fixed; title, count, and controls can be hidden independently.

The editor validates the source and offers **Starter JSON** for a new catalog. Follow the [JSON catalog setup guide](https://github.com/eyalgal/ha-shopping-list-card/tree/main/examples/auto-generated-grid/) to connect the sensor. No `auto-entities`, `layout-card`, or generated grid is required.

<details>
<summary>Minimal Catalog configuration</summary>

```yaml
type: custom:shopping-list-card
mode: catalog
catalog_entity: sensor.shopping_list_items
todo_list: todo.shopping_list
```

Replace the sensor and list IDs with your own. Products live in the sensor's source data; selections and quantities live in the to-do integration.

</details>

<details>
<summary>More screenshots: product cards and a mobile catalog</summary>

### Product Cards

<img src="https://raw.githubusercontent.com/eyalgal/ha-shopping-list-card/main/docs/images/single-cards.png" alt="Single-mode Milk and Apple variant groups above vertical Bread, Coffee, Eggs, and Cheddar tiles" width="920"/>

Horizontal variant groups and vertical tiles can share the same shopping list.

### Mobile Catalog and Undo

<img src="https://raw.githubusercontent.com/eyalgal/ha-shopping-list-card/main/docs/images/catalog-mobile-undo.png" alt="Two-column catalog at phone width, showing the Undo icon in the catalog header after removing Eggs, and separate Milk and Lactose-free quantities" width="390"/>

Compact tiles keep the main item and its variants accessible. Screenshots use demo data and sample photos; product-photo files are not bundled with the card.

</details>

<a id="undo-removal"></a>

## Good to Know

- **Catalogs are read-only sources.** Quick-add changes the shopping list, not the JSON catalog. Edit the source to add permanent products.
- **Undo is temporary.** A 10-second icon covers this card's last removal batch in the current browser, not edits through other apps or the native list. [Undo details](https://github.com/eyalgal/ha-shopping-list-card/blob/main/docs/usage.md#undo-removal).
- **Quantities affect removal.** Above one, use the minus button or default hold action; a normal tap does not remove the item. Kept-zero mode behaves differently. [Quantity behavior](https://github.com/eyalgal/ha-shopping-list-card/blob/main/docs/usage.md#quantities).
- **No offline write queue.** The card waits for Home Assistant confirmation and does not automatically repeat failed changes.

<a id="configuration"></a><a id="options"></a><a id="catalog-options"></a><a id="custom-images"></a><a id="item-types-variants"></a>

## Documentation

| Guide | Contents |
|---|---|
| [Using the card](https://github.com/eyalgal/ha-shopping-list-card/blob/main/docs/usage.md) | Variants, quantities, images, prefixes, Undo, and shared-list behavior |
| [Configuration reference](https://github.com/eyalgal/ha-shopping-list-card/blob/main/docs/configuration.md) | Every Single/Catalog option, defaults, and layout examples |
| [JSON catalog setup](https://github.com/eyalgal/ha-shopping-list-card/tree/main/examples/auto-generated-grid/) | Sensor setup, product data, flat variants, existing-grid migration, and troubleshooting |
| [Complete dashboard example](https://github.com/eyalgal/ha-shopping-list-card/blob/main/examples/auto-generated-grid/dashboard.yaml) | Native Sections dashboard with one Catalog card |
| [Contributing](https://github.com/eyalgal/ha-shopping-list-card/blob/main/CONTRIBUTING.md) | Development, browser fixtures, and pre-release device checks |

## Support

[Community discussion][forum] · [Report an issue](https://github.com/eyalgal/ha-shopping-list-card/issues) · [Buy me a coffee][bmac]

[release_badge]: https://img.shields.io/github/v/release/eyalgal/ha-shopping-list-card
[release]: https://github.com/eyalgal/ha-shopping-list-card/releases
[downloads_badge]: https://img.shields.io/github/downloads/eyalgal/ha-shopping-list-card/total.svg
[forum_badge]: https://img.shields.io/badge/Community-Forum-5294E2.svg
[forum]: https://community.home-assistant.io/t/shopping-list-card-a-simple-card-for-quick-adding-items-to-any-to-do-list/905005
[bmac]: https://www.buymeacoffee.com/eyalgal
