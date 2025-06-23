# Shopping List Card

A simple and intuitive Lovelace card for Home Assistant to quickly add and manage items on your shopping list. This card is designed to work with the native `todo` integration and provides a clean, modern interface for your dashboard.

<img src="https://github.com/user-attachments/assets/a0b4b32b-c765-456a-959c-ec2b6138e525" alt="Shopping List Card Preview" width="400"/>

> *The list at the bottom of the screenshot is the standard `type: todo-list` [card](https://www.home-assistant.io/lovelace/todo-list/), used here to display the full list.*

## Features

* **Visual Editor:** Easy-to-use graphical interface for card configuration.
* **Quick Add/Remove:** Tap a card to add or remove an item from a specified to-do list.
* **Visual Feedback:** The card's icon and color change to indicate if an item is already on the list.
* **Case-Insensitive Matching:** Checks for items on the list without worrying about capitalization.
* **(Optional) Quantity Control:** For items you need more than one of, you can enable `+` and `-` buttons to adjust the quantity directly from the card.
* **Customizable:** Set a primary title and a secondary subtitle for each item card.
* **Standalone & Theme-Aware:** Works without any other dependencies and respects your theme's styling for fonts, colors, and border radius.

## Prerequisites

* **To-do List Integration:** You must have a to-do list set up via the `todo` integration. You can add one by going to **Settings > Devices & Services > Add Integration > Local To-do**.

## Installation (HACS)

1.  Go to HACS in your Home Assistant.
2.  Click on "Frontend" and then the 3 dots in the top right and "Custom repositories".
3.  Add the repository URL `https://github.com/eyalgal/ha-shopping-list-card` and select the category "Dashboard".
4.  Click "ADD".
5.  You should now see the "Shopping List Card" in your HACS frontend list. Click "INSTALL".
6.  Refresh your browser.

## Configuration

This card can be configured using the Visual Editor. Simply add the card to your dashboard and fill out the form.

<img src="https://github.com/user-attachments/assets/cb1e4d2e-fa99-453c-b363-ead634002c6a" alt="Visual Editor" width="600"/>

#### YAML Mode

For advanced use cases, you can configure the card using YAML:

```yaml
type: 'custom:shopping-list-card'
title: 'Apples'
subtitle: 'Pink Lady'
todo_list: 'todo.shopping_list'
enable_quantity: true
```

### Options

| Option | Type | Required | Description | Default |
| --- | --- | --- | --- | --- |
| `type` | string | Yes | Must be `custom:shopping-list-card` | --- |
| `title` | string | Yes | The main title for the card (the item name). | --- |
| `subtitle` | string | No | A secondary line of text for more detail. | `''` |
| `todo_list` | string | Yes | The entity ID of the `todo` list to manage. | --- |
| `enable_quantity` | boolean | No | If `true`, enables the `+` and `-` buttons for quantity. | `false` |

### Quantity Behavior

When `enable_quantity` is set to `true`:

* An item on the list will display its quantity along with `+` and `-` buttons.
* If the quantity is 1, the `-` button will be hidden, and tapping the main card will remove the item.
* If the quantity is greater than 1, the `-` button is visible for decrementing the count.### Quantity Behavior

## Support

If you find this card useful and would like to show your support, you can buy me a coffee!

<a href="https://coff.ee/eyalgal" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 60px !important;width: 217px !important;" ></a>
