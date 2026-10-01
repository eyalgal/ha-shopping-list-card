# Development

[README](README.md) | [Configuration reference](docs/configuration.md)

Use Node.js 22.13 or newer.

```sh
npm ci
npm run check
```

The check command lints, builds, and runs the regression tests. The root `shopping-list-card.js` is the generated HACS artifact and must be rebuilt and committed with source changes. CI checks Node.js 22 and 24 and requires the committed bundle to match a fresh build.

## Source Map

| File | Responsibility |
|---|---|
| `src/shopping-list-card.js` | Public card, Single rendering, and interactions |
| `src/todo-store.js` | Shared subscriptions, recovery, stale-response protection, pending writes, and Undo batches |
| `src/undo-control.js` | Undo icon, labels, and retry errors |
| `src/item-model.js` | Naming, quantities, action planning, and lossless variant updates |
| `src/editor.js`, `src/variants-editor.js` | Public visual editor and variant rows |
| `src/catalog-card.js`, `src/catalog-model.js`, `src/catalog-editor.js` | Catalog rendering, source validation, and configuration |
| `src/card-defaults.js`, `src/card-styles.js` | Defaults and styling |

## Browser Fixtures

Tests use mocked Home Assistant services and never connect to a real shopping list. Serve the repository over local HTTP and open:

- `tests/browser.html?catalog`: sample catalog.
- `tests/browser.html?catalog&editor`: Catalog editor and preview.
- `tests/browser.html?editor`: Single variants editor.
- `tests/browser.html`: Single product cards.

The fixtures render the actual built card with fake list data and simulated Home Assistant controls. They are not a substitute for installed-card or physical-device testing. Use synthetic products for documentation screenshots; do not expose household lists or credentials.

## Release Device Checks

Before each release, test the installed build on physical iOS and Android companion apps and a desktop browser. Emulation does not verify haptics, saved mobile downloads, or the WebView lifecycle. Use a disposable to-do list:

1. Add plain Milk and Lactose-free, change their quantities independently, and expand/collapse at the intended tile width. Check for overlapping or clipped controls.
2. Remove a product and Undo it. Hold a variant header to remove a group, then Undo the batch and check exact quantities. Try a kept-zero item too.
3. Disconnect and reconnect, then repeat an edit and Undo. Double-tap during a slow update and verify no duplicate entries. Reopen the app: the persistent list should remain correct, but the previous Undo icon should not return. Confirm the icon never changes tile or catalog height and expires after 10 seconds.
4. In the editor, select direct and wrapped JSON sensors, check malformed-source errors, and download Starter JSON. Confirm that the file actually saves and that settings survive switching modes.

## Documentation Changes

Keep the README focused on installation, mode selection, and screenshots. Put option tables in the [reference](docs/configuration.md), interaction details in the [usage guide](docs/usage.md), and source setup in the [JSON catalog guide](examples/auto-generated-grid/). Check relative links, anchors, and YAML examples when moving sections.

HACS renders the README inside Home Assistant, where relative paths resolve against the Home Assistant server. Use absolute `raw.githubusercontent.com` URLs for README images and absolute GitHub URLs for README links.

### Screenshots

The README images in `docs/images/` show the built 3.0.0 card in the local browser fixture, with synthetic list data and simulated Home Assistant host controls. They are actual rendered cards, not UI mockups. Capture widths are 1080px for the catalog, 920px for Single cards, and 390px for the mobile catalog, at 2x pixel density.

Use an isolated browser with no live Home Assistant connection. Wait for fonts, product images, and expansion animations before measuring the crop. Verify that tiles do not overflow and that the full bottom row is visible. The mobile image uses a removal against the fixture's fake list to show the real Undo icon; it is not a physical-phone test.

The sample product photos are from Unsplash: [apples](https://images.unsplash.com/photo-1560806887-1e4cd0b6cbd6?auto=format&fit=crop&w=240&q=85) and [milk](https://images.unsplash.com/photo-1550583724-b2692b85b150?auto=format&fit=crop&w=240&q=85). Only rendered screenshots are included, not a product-photo library.