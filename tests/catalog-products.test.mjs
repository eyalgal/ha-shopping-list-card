import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Window } from 'happy-dom';

const source = readFileSync(new URL('../shopping-list-card.js', import.meta.url), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
const ENTITY = 'sensor.shopping_catalog_costco';

function createEnvironment(context, { confirm = true } = {}) {
  const window = new Window({ url: 'http://localhost/' });
  window.console.info = () => {};
  window.setTimeout = () => 0;
  window.confirm = () => confirm;
  window.eval(source);
  context.after(() => window.happyDOM.close());
  return { window, document: window.document };
}

function createHass(catalog, { admin = true, companion = true, save, candidates, dismiss } = {}) {
  const calls = [];
  let revision = 'r1';
  const hass = {
    user: { is_admin: admin },
    states: {
      'todo.shopping': { state: '0', attributes: {} },
      [ENTITY]: { state: '3', attributes: { catalog } },
    },
    entities: { [ENTITY]: { entity_id: ENTITY, platform: companion ? 'shopping_list_catalog' : 'command_line' } },
    connection: { subscribeMessage: () => Promise.resolve(() => {}) },
    async callWS(message) {
      calls.push(JSON.parse(JSON.stringify(message)));
      if (message.type === 'shopping_list_catalog/get') {
        return { title: 'Costco', path: 'shopping_catalogs/costco.json', catalog, revision, error: null };
      }
      if (message.type === 'shopping_list_catalog/save') {
        if (save) return save(message);
        catalog = message.catalog;
        revision = `r${calls.length}`;
        return { revision };
      }
      if (message.type === 'shopping_list_catalog/candidates') {
        if (!candidates) throw { code: 'unknown_command', message: 'Unknown command.' };
        return { candidates };
      }
      if (message.type === 'shopping_list_catalog/dismiss') {
        if (dismiss) return dismiss(message);
        return null;
      }
      return { items: [] };
    },
    callService: async () => {},
  };
  return { hass, calls };
}

function catalogEditor(environment, hass) {
  const editor = environment.window.customElements.get('shopping-list-catalog').getConfigElement();
  editor.setConfig({
    type: 'custom:shopping-list-card', mode: 'catalog', catalog_entity: ENTITY, catalog_attribute: 'catalog',
    todo_list: 'todo.shopping', item_options: { image_base: '/local/shop/' },
  });
  editor.hass = hass;
  environment.document.body.append(editor);
  const changes = [];
  editor.addEventListener('config-changed', event => changes.push(event.detail.config));
  return { editor, changes };
}

const click = element => element.dispatchEvent(new element.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));

function input(element, value) {
  element.value = value;
  element.dispatchEvent(new element.ownerDocument.defaultView.Event('input', { bubbles: true }));
}

async function openProducts(environment, hass) {
  const setup = catalogEditor(environment, hass);
  click(setup.editor.shadowRoot.querySelector('.catalog-edit-products'));
  await settle();
  const products = setup.editor.shadowRoot.querySelector('shopping-list-catalog-products');
  return { ...setup, products, root: products.shadowRoot };
}

const CATALOG = {
  Fruits: [
    { title: 'Apple', types: [{ name: 'Gala', image: '/local/gala.png' }, 'Fuji'], note: 'keep me' },
    { title: 'Banana' },
  ],
  Dairy: [{ title: 'Milk', layout: 'vertical' }],
};

test('Edit products appears only for companion catalogs and administrators', context => {
  for (const [options, visible] of [[{}, true], [{ admin: false }, false], [{ companion: false }, false]]) {
    const environment = createEnvironment(context);
    const { editor } = catalogEditor(environment, createHass(CATALOG, options).hass);
    assert.equal(editor.shadowRoot.querySelector('.catalog-edit-products').hidden, !visible, JSON.stringify(options));
    assert.equal(editor.shadowRoot.querySelector('.catalog-starter').hidden, options.companion !== false);
  }
});

test('the product form edits a catalog product relative to the catalog defaults', context => {
  const environment = createEnvironment(context);
  const editor = environment.document.createElement('shopping-list-card-editor');
  editor.productDefaults = { layout: 'vertical', enable_quantity: true, image_base: '/local/shop/' };
  editor.setConfig({ title: 'Milk', layout: 'vertical', note: 'keep me' });
  editor.hass = createHass(CATALOG).hass;
  environment.document.body.append(editor);
  const changes = [];
  editor.addEventListener('config-changed', event => changes.push(JSON.parse(JSON.stringify(event.detail.config))));
  const root = editor.shadowRoot;

  assert.equal(root.querySelector('.card-mode'), null);
  assert.equal(root.querySelector('#todo_list').hidden, true);
  assert.equal(root.querySelector('#enable_quantity').checked, true);
  assert.equal(root.querySelector('#image_base').value, '/local/shop/');

  input(root.querySelector('#title'), 'Whole milk');
  assert.deepEqual(changes.at(-1), { title: 'Whole milk', layout: 'vertical', note: 'keep me' });

  const quantity = root.querySelector('#enable_quantity');
  quantity.checked = false;
  quantity.dispatchEvent(new environment.window.Event('change'));
  assert.equal(changes.at(-1).enable_quantity, false);

  root.querySelector('#layout').dispatchEvent(new environment.window.CustomEvent('selected', { detail: { value: 'horizontal' } }));
  assert.equal(changes.at(-1).layout, 'horizontal');
  assert.equal('todo_list' in changes.at(-1), false);
  assert.equal('image_base' in changes.at(-1), false);
});

test('products can be renamed, reordered, added, edited, and saved without touching the card config', async context => {
  const environment = createEnvironment(context);
  const { hass, calls } = createHass(structuredClone(CATALOG));
  const { editor, changes, root } = await openProducts(environment, hass);

  assert.equal(editor.shadowRoot.querySelector('.catalog-form').hidden, true);
  assert.match(root.querySelector('.products-title').textContent, /Products: Costco/);
  assert.deepEqual([...root.querySelectorAll('input.category-name')].map(field => field.value), ['Fruits', 'Dairy']);
  assert.match(root.querySelector('.product-meta').textContent, /2 variants/);
  assert.equal(root.querySelector('.save').disabled, true);

  input(root.querySelector('input.category-name'), 'Produce');
  click(root.querySelector('[data-category] .move-down'));
  const produce = [...root.querySelectorAll('section.category')].find(section => section.querySelector('input').value === 'Produce');
  click(produce.querySelector('[data-product] .move-down'));

  click([...root.querySelectorAll('.add-category')].at(-1));
  assert.equal(root.querySelector('.save').disabled, true);
  assert.match(root.querySelector('.footer-message').textContent, /Fix 1 problem/);
  input([...root.querySelectorAll('input.category-name')].at(-1), 'Bakery');

  click([...root.querySelectorAll('.add-product')].at(-1));
  const form = root.querySelector('shopping-list-card-editor');
  assert.ok(form);
  assert.equal(root.querySelector('.category-select').selectedOptions[0].textContent, 'Bakery');
  input(form.shadowRoot.querySelector('#title'), 'Bread');
  click(root.querySelector('.back'));

  const appleRow = [...root.querySelectorAll('.product-name')].find(name => name.textContent === 'Apple').closest('.product');
  click(appleRow.querySelector('.product-open'));
  input(root.querySelector('shopping-list-card-editor').shadowRoot.querySelector('#subtitle'), 'Organic');
  click(root.querySelector('.back'));

  assert.equal(root.querySelector('.save').disabled, false);
  click(root.querySelector('.save'));
  await settle();

  const saved = calls.find(call => call.type === 'shopping_list_catalog/save');
  assert.equal(saved.entity_id, ENTITY);
  assert.equal(saved.revision, 'r1');
  assert.deepEqual(Object.keys(saved.catalog), ['Dairy', 'Produce', 'Bakery']);
  assert.deepEqual(saved.catalog.Produce, [
    { title: 'Banana' },
    { title: 'Apple', types: [{ name: 'Gala', image: '/local/gala.png' }, 'Fuji'], note: 'keep me', subtitle: 'Organic' },
  ]);
  assert.deepEqual(saved.catalog.Dairy, [{ title: 'Milk', layout: 'vertical' }]);
  assert.deepEqual(saved.catalog.Bakery, [{ title: 'Bread' }]);
  assert.equal(root.querySelector('.save').disabled, true);
  assert.match(root.querySelector('.footer-message').textContent, /All changes saved/);
  assert.deepEqual(changes, []);

  click(root.querySelector('.back'));
  assert.equal(editor.shadowRoot.querySelector('shopping-list-catalog-products'), null);
  assert.equal(editor.shadowRoot.querySelector('.catalog-form').hidden, false);
});

test('a conflicting save keeps local changes and offers a reload', async context => {
  const environment = createEnvironment(context);
  const { hass, calls } = createHass(structuredClone(CATALOG), {
    save() {
      throw { code: 'conflict', message: 'The catalog changed since it was loaded.' };
    },
  });
  const { root } = await openProducts(environment, hass);
  click(root.querySelector('[data-product] .delete-product'));
  click(root.querySelector('.save'));
  await settle();

  const alert = root.querySelector('ha-alert');
  assert.equal(alert.hidden, false);
  assert.match(alert.textContent, /changed somewhere else/);
  assert.equal(root.querySelector('.save').disabled, false);

  click(alert.querySelector('.reload'));
  await settle();
  assert.equal(calls.filter(call => call.type === 'shopping_list_catalog/get').length, 2);
  assert.equal(root.querySelectorAll('[data-product]').length, 3);
});

test('the card mode switch is hidden while products are open', async context => {
  const environment = createEnvironment(context);
  const editor = environment.document.createElement('shopping-list-card-editor');
  editor.setConfig({ type: 'custom:shopping-list-card', mode: 'catalog', catalog_entity: ENTITY, catalog_attribute: 'catalog', todo_list: 'todo.shopping' });
  editor.hass = createHass(structuredClone(CATALOG)).hass;
  environment.document.body.append(editor);
  const mode = editor.shadowRoot.querySelector('.card-mode').parentElement;
  const settings = editor.shadowRoot.querySelector('shopping-list-catalog-editor');
  click(settings.shadowRoot.querySelector('.catalog-edit-products'));
  await settle();
  assert.equal(mode.hidden, true);
  const products = settings.shadowRoot.querySelector('shopping-list-catalog-products');
  assert.equal(products.shadowRoot.querySelector('.save').textContent, 'Save products');
  click(products.shadowRoot.querySelector('.back'));
  assert.equal(mode.hidden, false);
});

test('the product form has a way back to the list at the top and bottom', async context => {
  const environment = createEnvironment(context);
  const { root, editor } = await openProducts(environment, createHass(structuredClone(CATALOG)).hass);
  assert.equal(root.querySelector('.done').hidden, true);
  click(root.querySelector('.product-open'));
  assert.equal(root.querySelector('.back').textContent, 'All products');
  assert.equal(root.querySelector('.done').hidden, false);
  click(root.querySelector('.done'));
  assert.ok(root.querySelector('input.category-name'));
  assert.equal(root.activeElement?.classList.contains('product-open'), true);

  const settings = editor.shadowRoot;
  const order = settings.getElementById('product_order');
  const changes = [];
  editor.addEventListener('config-changed', event => changes.push(event.detail.config));
  order.dispatchEvent(new environment.window.CustomEvent('selected', { detail: { value: 'name' } }));
  assert.equal(changes.at(-1).product_order, 'name');
  order.dispatchEvent(new environment.window.CustomEvent('selected', { detail: { value: 'catalog' } }));
  assert.equal('product_order' in changes.at(-1), false);
});

test('closing with unsaved changes asks first', async context => {
  const environment = createEnvironment(context, { confirm: false });
  const { editor, root } = await openProducts(environment, createHass(structuredClone(CATALOG)).hass);
  click(root.querySelector('[data-product] .delete-product'));
  click(root.querySelector('.back'));
  assert.ok(editor.shadowRoot.querySelector('shopping-list-catalog-products'));
});

test('a broken catalog file is reported instead of editable', async context => {
  const environment = createEnvironment(context);
  const { hass } = createHass(CATALOG);
  hass.callWS = async () => ({ title: 'Costco', path: 'x.json', catalog: null, revision: null, error: 'The catalog file is not valid JSON.' });
  const { root } = await openProducts(environment, hass);
  assert.match(root.querySelector('ha-alert').textContent, /not valid JSON/);
  assert.equal(root.querySelector('.footer').hidden, true);
  assert.equal(root.querySelector('input.category-name'), null);
});

const CANDIDATE_CATALOG = {
  Fruits: [
    { title: 'Apple', types: ['Gala'] },
    { title: 'Grapes', subtitle: 'Green' },
    { title: 'Grapes', subtitle: 'Purple' },
    { title: 'Banana' },
  ],
  Snacks: [{ title: 'Chips' }],
};

const CANDIDATES = [
  { key: 'bamba', name: 'Bamba', times: 3, last: '2026-09-28', quantity: 1, variant_of: null },
  { key: 'apple | honeycrisp', name: 'Apple - Honeycrisp', times: 2, last: '2026-10-12', quantity: 2, variant_of: { category: 'Fruits', title: 'Apple', variant: 'Honeycrisp' } },
  { key: 'grape | red', name: 'Grapes - Red', times: 2, last: '2026-10-10', quantity: 1, variant_of: { category: 'Fruits', title: 'Grapes', variant: 'Red' } },
  { key: 'mini pear', name: 'Mini pears', times: 2, last: '2026-10-09', quantity: 1, variant_of: { category: 'Fruits', title: 'Pear', variant: 'Mini' } },
];

const candidateRow = (root, key) => root.querySelector(`[data-candidate="${key}"]`);

test('products bought but missing from the catalog can be added as products or variants', async context => {
  const environment = createEnvironment(context);
  const { hass, calls } = createHass(structuredClone(CANDIDATE_CATALOG), { candidates: structuredClone(CANDIDATES) });
  const { root } = await openProducts(environment, hass);

  assert.equal(root.querySelector('.candidates h3').textContent, 'Bought but not in the catalog');
  assert.deepEqual([...root.querySelectorAll('.candidate .product-name')].map(name => name.textContent),
    ['Bamba', 'Apple - Honeycrisp', 'Grapes - Red', 'Mini pears']);
  assert.match(candidateRow(root, 'bamba').querySelector('.product-meta').textContent, /^Bought 3 times, last on /);
  assert.equal(candidateRow(root, 'bamba').querySelector('.add-variant'), null);
  // Pear isn't in the catalog, so only a new product is offered.
  assert.equal(candidateRow(root, 'mini pear').querySelector('.add-variant'), null);
  assert.equal(candidateRow(root, 'apple | honeycrisp').querySelector('.add-variant').textContent, 'Add to Apple as Honeycrisp');

  const bamba = candidateRow(root, 'bamba');
  assert.equal(bamba.querySelector('.add-candidate').disabled, true);
  const select = bamba.querySelector('.candidate-category');
  select.value = [...select.options].find(option => option.textContent === 'Snacks').value;
  select.dispatchEvent(new environment.window.Event('change'));
  click(bamba.querySelector('.add-candidate'));
  assert.equal(root.querySelector('.category-select').selectedOptions[0].textContent, 'Snacks');
  assert.equal(root.querySelector('shopping-list-card-editor').shadowRoot.querySelector('#title').value, 'Bamba');
  click(root.querySelector('.back'));
  assert.equal(candidateRow(root, 'bamba'), null);

  click(candidateRow(root, 'apple | honeycrisp').querySelector('.add-variant'));
  assert.equal(root.querySelector('shopping-list-card-editor').shadowRoot.querySelector('#title').value, 'Apple');
  click(root.querySelector('.back'));
  click(candidateRow(root, 'grape | red').querySelector('.add-variant'));
  click(root.querySelector('.back'));
  assert.equal(root.querySelector('.candidates').textContent.includes('Grapes - Red'), false);

  click(root.querySelector('.save'));
  await settle();
  const saved = calls.find(call => call.type === 'shopping_list_catalog/save').catalog;
  assert.deepEqual(saved.Fruits, [
    { title: 'Apple', types: ['Gala', 'Honeycrisp'] },
    { title: 'Grapes', subtitle: 'Green' },
    { title: 'Grapes', subtitle: 'Purple' },
    { title: 'Grapes', subtitle: 'Red' },
    { title: 'Banana' },
  ]);
  assert.deepEqual(saved.Snacks, [{ title: 'Chips' }, { title: 'Bamba' }]);
  assert.equal(calls.some(call => call.type === 'shopping_list_catalog/dismiss'), false);
});

test('dismissing a missing product is saved right away and reported if it fails', async context => {
  const environment = createEnvironment(context);
  let fail = true;
  const { hass, calls } = createHass(structuredClone(CANDIDATE_CATALOG), {
    candidates: structuredClone(CANDIDATES),
    dismiss: () => { if (fail) throw { message: 'Not allowed.' }; return null; },
  });
  const { root } = await openProducts(environment, hass);

  click(candidateRow(root, 'bamba').querySelector('.dismiss-candidate'));
  await settle();
  assert.match(root.querySelector('ha-alert').textContent, /Not allowed/);
  assert.ok(candidateRow(root, 'bamba'));

  fail = false;
  click(candidateRow(root, 'bamba').querySelector('.dismiss-candidate'));
  await settle();
  assert.equal(candidateRow(root, 'bamba'), null);
  assert.equal(root.querySelector('ha-alert').hidden, true);
  assert.deepEqual(calls.filter(call => call.type === 'shopping_list_catalog/dismiss').at(-1),
    { type: 'shopping_list_catalog/dismiss', entity_id: ENTITY, key: 'bamba' });
  assert.equal(root.querySelector('.save').disabled, true);
});

test('older integrations without candidates show the products as before', async context => {
  const environment = createEnvironment(context);
  const { hass } = createHass(structuredClone(CANDIDATE_CATALOG));
  const { root } = await openProducts(environment, hass);
  assert.equal(root.querySelector('.candidates'), null);
  assert.equal(root.querySelectorAll('section.category').length, 2);
  assert.equal(root.querySelector('ha-alert').hidden, true);
});
