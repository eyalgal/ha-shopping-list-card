# Shopping List Card

A simple and intuitive Lovelace card for Home Assistant to quickly add and manage items on your shopping list. This card is designed to work with the native `todo` integration and provides a clean, "mushroom-style" interface for your dashboard.

## Features

- **Quick Add/Remove:** Tap a card to add or remove an item from a specified to-do list.
- **Visual Feedback:** The card's icon and color change to indicate if an item is already on the list.
- **Case-Insensitive Matching:** Checks for items on the list without worrying about capitalization.
- **(Optional) Quantity Control:** For items you need more than one of, you can enable `+` and `-` buttons to adjust the quantity directly from the card.
- **Customizable:** Set a primary title and a secondary subtitle for each item card.
- **Mushroom-Inspired Design:** Clean and modern look that fits well with other mushroom cards.

## Prerequisites

1. **Mushroom Cards:** This card is based on the `mushroom-template-card`, so you'll need to have [Mushroom Cards](https://github.com/piitaya/lovelace-mushroom) installed. You can install it via HACS.
2. **To-do List Integration:** You must have a to-do list set up via the `todo` integration. Go to **Settings > Devices & Services > Helpers** and create a new To-do list.

## Installation (HACS)

1. Go to **HACS** in your Home Assistant.
2. Click on **"Frontend"** and then the 3 dots in the top right and select **"Custom repositories"**.
3. Add the URL to this repository and select the category **"Lovelace"**.
4. Click **"ADD"**.
5. You should now see the **"Shopping List Card"** in your HACS frontend list. Click **"INSTALL"**.
6. Refresh your browser.

## Configuration

### Basic Example

```yaml
type: 'custom:shopping-list-card'
title: 'Milk'
subtitle: 'Lactose-free'
todo_list: 'todo.shopping_list'
```

### Advanced Configuration with Quantity

To enable the quantity selector, simply add `enable_quantity: true` to your card's configuration:

```yaml
type: 'custom:shopping-list-card'
title: 'Apples'
subtitle: 'Granny Smith'
todo_list: 'todo.shopping_list'
enable_quantity: true
```

When an item with quantity enabled is added to the list, the card will display `+` and `-` buttons to adjust the count. The item will be added to the list with the quantity in parentheses, like `"Apples (2)"`.

### Options

| Option | Type | Required | Description | Default |
| --- | --- | --- | --- | --- |
| `type` | string | Yes | Must be `custom:shopping-list-card` | --- |
| `title` | string | Yes | The main title for the card (the item name). | --- |
| `subtitle` | string | No | A secondary line of text for more detail. | `''` |
| `todo_list` | string | Yes | The entity ID of the `todo` list to manage. | --- |
| `enable_quantity` | boolean | No | If `true`, enables the `+` and `-` buttons for quantity. | `false` |

How It Works
------------

This card doesn't use a script like the original proof-of-concept. Instead, it directly calls the `todo.add_item` and `todo.remove_item` services from the browser.

It:

-   Finds the item on the list (case-insensitive)

-   Updates or removes the correct item

-   Uses a regular expression to update quantity when `enable_quantity` is enabled

> *Note: This card is not an official Mushroom card, but is designed to be a visual and functional companion to it.*
