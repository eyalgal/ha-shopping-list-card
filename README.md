# 🛍️ Shopping List Card
[![GitHub Release][release_badge]][release]
[![Buy Me A Coffee][bmac_badge]][bmac]
<!--[![Community Forum][forum_badge]][forum] 
-->

<!-- Link references -->
[release_badge]: https://img.shields.io/github/v/release/eyalgal/ha-shopping-list-card
[release]: https://github.com/eyalgal/ha-shopping-list-card/releases
[bmac_badge]: https://img.shields.io/badge/buy_me_a-coffee-yellow
[bmac]: https://www.buymeacoffee.com/eyalgal
<!--[forum_badge]: https://img.shields.io/badge/Community-Forum-5294E2.svg
[forum]: <!-- TODO: Add link to your HA community forum post -->


A simple and intuitive Lovelace card for Home Assistant to quickly add and manage items on your shopping list. This card is designed to work with the native `todo` integration and provides a clean, modern interface for your dashboard.

<img src="https://github.com/user-attachments/assets/04f2f0f0-0304-47c2-9408-30a28729752a" alt="Shopping List Card Preview" width="700"/>

> *The list at the bottom of the screenshot is the standard `type: todo-list` [card](https://www.home-assistant.io/lovelace/todo-list/), used here to display the full list.*

## ✨ Features

* **Powerful Visual Editor:** An easy-to-use graphical interface for card configuration, including icon and color pickers.
* **Quick Add/Remove:** Tap a card to add or remove an item from a specified to-do list.
* **Visual Feedback:** The card's icon and color change to indicate if an item is already on the list.
* **Case-Insensitive Matching:** Checks for items on the list without worrying about capitalization.
* **Fully Customizable:** Set a primary title, a secondary subtitle, and customize the icons and colors for both "on" and "off" states.
* **(Optional) Quantity Control:** For items you need more than one of, you can enable `+` and `-` buttons to adjust the quantity directly from the card.
* **(Optional) Background Color:** Optionally colorize the entire card background based on the "on" state color.
* **Standalone & Theme-Aware:** Works without any other dependencies and respects your theme's styling for fonts, colors, and border radius.

## ✅ Prerequisites

* **To-do List Integration:** You must have a to-do list set up via the `todo` integration. This can be the built-in Local To‑do integration or any third‑party integration that provides a `todo.<your_list>` entity—**e.g. Bring! or Todoist.** Add your preferred integration under **Settings > Devices & Services > Add Integration.**

## 🚀 Installation (HACS)

### HACS

Shopping List Card is available in [HACS](https://hacs.xyz/) (Home Assistant Community Store).

Use this link to directly go to the repository in HACS:

[![Open your Home Assistant instance and open a repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=eyalgal&repository=ha-shopping-list-card)

_or_

1. Install HACS if you don't have it already  
2. Open HACS in Home Assistant  
3. Search for "Shopping List Card"  
4. Click the download button. ⬇️

## ⚙️ Configuration

This card can be configured using the Visual Editor. Simply add the card to your dashboard and fill out the form.

<img src="https://github.com/user-attachments/assets/c7e6d42c-5025-4389-8bdf-1064a33a49a0" alt="Visual Editor" width="600"/>

#### YAML Mode

For advanced use cases, you can configure the card using YAML:

```yaml
type: custom:shopping-list-card
title: Feed Guinness
todo_list: todo.daily_chores
enable_quantity: false
off_icon: mdi:paw-off
on_icon: mdi:paw
on_color: brown
colorize_background: true
```

### Options

| Name              | Type    | Required | Description                                                                      | Default        |
| ----------------- | ------- | -------- | -------------------------------------------------------------------------------- | -------------- |
| `type`            | string  | Yes      | Must be `custom:shopping-list-card`                                              | ---            |
| `title`           | string  | Yes      | The main title for the card (the item name).                                     | ---            |
| `subtitle`        | string  | No       | A secondary line of text for more detail.                                        | `''`           |
| `todo_list`       | string  | Yes      | The entity ID of the `todo` list to manage.                                      | ---            |
| `enable_quantity` | boolean | No       | If `true`, enables the `+` and `-` buttons for quantity.                         | `false`        |
| `on_icon`         | string  | No       | The icon to display when the item is on the list.                                | `mdi:check`    |
| `on_color`        | string  | No       | The color for the "on" state (e.g., `green`, `teal`, or `#4CAF50`).             | `green`        |
| `off_icon`        | string  | No       | The icon to display when the item is not on the list.                            | `mdi:plus`     |
| `off_color`       | string  | No       | The color for the "off" state (e.g., `grey`, `disabled`, or `#808080`).            | `grey`         |
| `colorize_background`       | boolean  | No       | If `true`, the card background will be tinted with the "on" state color.            | `false`          |

### Quantity Behavior

When `enable_quantity` is set to `true`:

* An item on the list will display its quantity along with `+` and `-` buttons.
* If the quantity is 1, the `-` button will be hidden, and tapping the main card will remove the item.
* If the quantity is greater than 1, the `-` button is visible for decrementing the count.

## ❤️ Support

If you find this card useful and would like to show your support, you can buy me a coffee!

<a href="https://coff.ee/eyalgal" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 60px !important;width: 217px !important;" ></a>
