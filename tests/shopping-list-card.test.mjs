import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Window } from 'happy-dom';

const source = readFileSync(new URL('../shopping-list-card.js', import.meta.url), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
const item = (summary, uid = summary) => ({ summary, uid, status: 'needs_action' });

function createEnvironment(context) {
  const window = new Window({ url: 'http://localhost/' });
  const timers = new Map();
  const errors = [];
  let nextTimer = 1;
  window.console.info = () => {};
  window.console.error = (...args) => errors.push(args);
  window.setTimeout = (callback, delay) => {
    const timer = nextTimer++;
    timers.set(timer, { callback, delay });
    return timer;
  };
  window.clearTimeout = timer => timers.delete(timer);
  window.eval(source);
  context.after(() => window.happyDOM.close());
  return { window, document: window.document, timers, errors };
}

function createHass(items = [], options = {}) {
  const subscriptions = [];
  const services = [];
  const fetches = [];
  const state = { items };
  const hass = {
    connected: true,
    states: { 'todo.shopping': { state: String(items.length) }, 'todo.other': { state: '0' } },
    connection: {
      subscribeMessage(callback, message) {
        const record = { callback, message, active: true };
        subscriptions.push(record);
        if (options.subscribe) return options.subscribe(record);
        queueMicrotask(() => { if (record.active) callback({ items: message.entity_id === 'todo.other' ? [] : state.items }); });
        return Promise.resolve(() => { record.active = false; });
      },
    },
    async callWS(message) {
      fetches.push(message);
      return options.fetch ? options.fetch(message) : { items: state.items };
    },
    async callService(domain, service, data) {
      services.push({ domain, service, data });
      return options.service?.(domain, service, data);
    },
  };
  const push = next => {
    state.items = next;
    for (const record of subscriptions) if (record.active) record.callback({ items: next });
  };
  return { hass, state, services, subscriptions, fetches, push };
}

function mount(environment, hass, config = {}) {
  const card = environment.document.createElement('shopping-list-card');
  card.setConfig({ title: 'Milk', todo_list: 'todo.shopping', ...config });
  card.hass = hass;
  environment.document.body.append(card);
  return card;
}

test('shopping-list-card catalog mode renders products without requiring a single-item title', async context => {
  const environment = createEnvironment(context);
  const setup = createHass([item('Milk')]);
  catalogSource(setup, { Dairy: [{ title: 'Milk' }], Fruits: [{ title: 'Apple', types: ['Gala'] }] });
  const card = environment.document.createElement('shopping-list-card');
  card.setConfig({ type: 'custom:shopping-list-card', mode: 'catalog', catalog_entity: 'sensor.catalog', todo_list: 'todo.shopping' });
  card.hass = setup.hass;
  environment.document.body.append(card);
  await settle();
  const catalog = card.querySelector('shopping-list-catalog');
  assert.ok(catalog);
  const products = [...catalog.shadowRoot.querySelectorAll('shopping-list-card')];
  assert.deepEqual(products.map(product => product._config.title), ['Milk', 'Apple']);
  assert.equal(products[0].querySelector('.card-container').getAttribute('aria-pressed'), 'true');
  assert.ok(products[1].querySelector('.types-chevron'));
  assert.equal(products.some(product => product.querySelector('shopping-list-catalog')), false);
  assert.equal(card.getLayoutOptions().grid_columns, 12);
  assert.equal(card.getLayoutOptions().grid_rows, 'auto');
  assert.equal(setup.subscriptions.length, 1);
  assert.equal(setup.fetches.length, 0);
  assert.equal(setup.services.length, 0);
  assert.deepEqual(environment.errors, []);
});

test('single mode remains the default and invalid modes leave the current view intact', async context => {
  const environment = createEnvironment(context);
  const setup = createHass([item('Milk')]);
  const card = mount(environment, setup.hass);
  await settle();
  const container = card.querySelector('.card-container');
  assert.equal(container.getAttribute('aria-pressed'), 'true');
  assert.equal(card.getCardSize(), 1);
  assert.throws(() => card.setConfig({ title: 'Milk', todo_list: 'todo.shopping', mode: 'invalid' }), /single or catalog/);
  assert.equal(card.querySelector('.card-container'), container);
  assert.throws(() => card.setConfig({ todo_list: 'todo.shopping', mode: 'catalog' }), /sensor entity/);
  assert.equal(card.querySelector('.card-container'), container);
  card.setConfig({ title: 'Milk', todo_list: 'todo.shopping', mode: 'single' });
  assert.equal(card.querySelectorAll('shopping-list-catalog').length, 0);
  assert.equal(card.querySelector('.card-container').getAttribute('aria-pressed'), 'true');
  assert.equal(setup.subscriptions.length, 1);
});

test('switching modes cleans up holds, old product tiles, and subscriptions', async context => {
  const environment = createEnvironment(context);
  const setup = createHass([item('Milk')]);
  catalogSource(setup, { Dairy: [{ title: 'Milk' }], Fruits: [{ title: 'Apple' }] });
  const card = mount(environment, setup.hass);
  await settle();
  card.querySelector('.card-container').dispatchEvent(new environment.window.PointerEvent('pointerdown', {
    bubbles: true, button: 0, isPrimary: true,
  }));
  assert.equal([...environment.timers.values()].filter(timer => timer.delay === 500).length, 1);
  card.setConfig({ mode: 'catalog', catalog_entity: 'sensor.catalog', todo_list: 'todo.shopping' });
  await settle();
  const catalog = card.querySelector('shopping-list-catalog');
  const product = catalog.shadowRoot.querySelector('shopping-list-card');
  assert.equal([...environment.timers.values()].filter(timer => timer.delay === 500).length, 0);
  assert.equal(card.querySelectorAll('.card-container').length, 0);
  assert.equal(setup.subscriptions.filter(subscription => subscription.active).length, 1);
  card.setConfig({ mode: 'single', title: 'Milk', todo_list: 'todo.shopping' });
  await settle();
  assert.equal(catalog.isConnected, false);
  assert.equal(product.isConnected, false);
  assert.equal(catalog._store, null);
  assert.equal(card.querySelector('.card-container').getAttribute('aria-pressed'), 'true');
  assert.equal(card.getLayoutOptions().grid_columns, 4);
  assert.equal(setup.subscriptions.filter(subscription => subscription.active).length, 1);
  card.remove();
  await settle();
  assert.equal(setup.subscriptions.filter(subscription => subscription.active).length, 0);
  assert.equal(setup.services.length, 0);
  assert.deepEqual(environment.errors, []);
});

test('catalog mode retains its view across configuration echoes, source updates, and reattachment', async context => {
  const environment = createEnvironment(context);
  const setup = createHass();
  catalogSource(setup, { Fruits: [{ title: 'Apple', types: ['Gala'] }] });
  const card = mount(environment, setup.hass, { mode: 'catalog', catalog_entity: 'sensor.catalog' });
  await settle();
  const catalog = card.querySelector('shopping-list-catalog');
  const apple = catalog.shadowRoot.querySelector('shopping-list-card');
  apple.querySelector('.types-chevron').click();
  card.setConfig({ ...card._config, columns: 2, show_search: false });
  assert.equal(card.querySelector('shopping-list-catalog'), catalog);
  assert.equal(catalog.shadowRoot.querySelector('shopping-list-card'), apple);
  assert.equal(apple._expanded, true);
  assert.equal(catalog.shadowRoot.querySelector('.catalog-search').hidden, true);
  setup.push([item('Apple - Gala')]);
  assert.equal(apple.querySelector('.type-row').getAttribute('aria-pressed'), 'true');
  catalogSource(setup, { Fruits: [{ title: 'Apple', types: ['Gala'] }, { title: 'Pear' }] });
  card.hass = { ...setup.hass };
  await settle();
  assert.equal(catalog.shadowRoot.querySelectorAll('shopping-list-card').length, 2);
  card.remove();
  await settle();
  assert.equal(setup.subscriptions.filter(subscription => subscription.active).length, 0);
  environment.document.body.append(card);
  await settle();
  assert.equal(card.querySelector('shopping-list-catalog'), catalog);
  assert.equal(setup.subscriptions.filter(subscription => subscription.active).length, 1);
  assert.equal(setup.services.length, 0);
});

test('a pending single-item write stays guarded after switching to catalog mode', async context => {
  const environment = createEnvironment(context);
  let finishService;
  const setup = createHass([], { service: () => new Promise(resolve => { finishService = resolve; }) });
  catalogSource(setup, { Dairy: [{ title: 'Milk' }] });
  const card = mount(environment, setup.hass);
  await settle();
  card.querySelector('.card-container').click();
  await settle();
  card.setConfig({ mode: 'catalog', catalog_entity: 'sensor.catalog', todo_list: 'todo.shopping' });
  await settle();
  const catalog = card.querySelector('shopping-list-catalog');
  const milk = catalog.shadowRoot.querySelector('shopping-list-card');
  milk.querySelector('.card-container').click();
  await settle();
  assert.equal(setup.services.length, 1);
  assert.equal(milk.querySelector('.card-container').getAttribute('aria-busy'), 'true');
  setup.push([item('Milk')]);
  finishService();
  await settle();
  assert.equal(card.querySelector('shopping-list-catalog'), catalog);
  assert.equal(milk.querySelector('.card-container').getAttribute('aria-pressed'), 'true');
  assert.equal(milk.querySelector('.card-container').getAttribute('aria-busy'), 'false');
  assert.equal(card.querySelectorAll('.card-content').length, 0);
  assert.deepEqual(environment.errors, []);
});

test('one visual editor switches between single and catalog without losing saved settings', context => {
  const environment = createEnvironment(context);
  const setup = createHass();
  catalogSource(setup, { Dairy: [{ title: 'Milk' }] });
  const editor = environment.document.createElement('shopping-list-card-editor');
  const variants = [{ name: 'Whole', image: '/local/whole.png', custom: true }];
  editor.setConfig({
    type: 'custom:shopping-list-card', title: 'Milk', todo_list: 'todo.shopping', types: variants,
    item_options: { quantity_max: 5 }, show_search: false, card_mod: { style: 'ha-card {}' },
  });
  editor.hass = setup.hass;
  environment.document.body.append(editor);
  const changes = [];
  editor.addEventListener('config-changed', event => {
    changes.push(JSON.parse(JSON.stringify(event.detail.config)));
    editor.setConfig(JSON.parse(JSON.stringify(event.detail.config)));
  });
  const selectMode = mode => {
    const radio = editor.shadowRoot.querySelector(`.card-mode input[value="${mode}"]`);
    assert.ok(radio);
    radio.checked = true;
    radio.dispatchEvent(new environment.window.Event('change', { bubbles: true }));
  };
  selectMode('catalog');
  assert.equal(changes.length, 1);
  assert.equal(changes[0].type, 'custom:shopping-list-card');
  assert.equal(changes[0].mode, 'catalog');
  assert.equal(changes[0].catalog_entity, 'sensor.catalog');
  assert.equal(changes[0].todo_list, 'todo.shopping');
  const catalogEditor = editor.shadowRoot.querySelector('shopping-list-catalog-editor');
  assert.ok(catalogEditor);
  const columns = catalogEditor.shadowRoot.getElementById('columns');
  columns.value = '2';
  columns.dispatchEvent(new environment.window.Event('input', { bubbles: true, composed: true }));
  assert.equal(changes.length, 2);
  assert.equal(changes[1].columns, 2);
  assert.equal(changes[1].mode, 'catalog');
  assert.deepEqual(changes[1].types, variants);
  assert.equal(editor.shadowRoot.querySelector('shopping-list-catalog-editor'), catalogEditor);
  selectMode('single');
  assert.equal(changes.at(-1).mode, 'single');
  assert.deepEqual(changes.at(-1).types, variants);
  assert.deepEqual(changes.at(-1).card_mod, { style: 'ha-card {}' });
  assert.deepEqual(changes.at(-1).item_options, { quantity_max: 5 });
  assert.equal(editor.shadowRoot.querySelector('#title').value, 'Milk');
  assert.equal(editor.shadowRoot.querySelector('shopping-list-variants-editor').value[0].name, 'Whole');
  selectMode('catalog');
  assert.equal(editor.shadowRoot.querySelector('shopping-list-catalog-editor').shadowRoot.getElementById('columns').value, '2');
  assert.equal(setup.services.length, 0);
});

test('switching out of catalog mode cancels pending native-list loading', async context => {
  const environment = createEnvironment(context);
  const setup = createHass([item('Milk')]);
  catalogSource(setup, { Dairy: [{ title: 'Milk' }] });
  let finishLoading;
  let created = 0;
  environment.window.loadCardHelpers = () => new Promise(resolve => { finishLoading = resolve; });
  const card = mount(environment, setup.hass, { mode: 'catalog', catalog_entity: 'sensor.catalog' });
  await settle();
  const catalog = card.querySelector('shopping-list-catalog');
  catalog.shadowRoot.querySelector('.catalog-open-list').click();
  card.setConfig({ mode: 'single', title: 'Milk', todo_list: 'todo.shopping' });
  await settle();
  finishLoading({ createCardElement() { created++; return environment.document.createElement('hui-todo-list-card'); } });
  await settle();
  assert.equal(created, 0);
  assert.equal(catalog.isConnected, false);
  assert.equal(catalog.shadowRoot.querySelector('.catalog-list-content').children.length, 0);
  assert.equal(card.querySelector('.card-container').getAttribute('aria-pressed'), 'true');
  assert.equal(setup.subscriptions.filter(subscription => subscription.active).length, 1);
  assert.equal(setup.services.length, 0);
});

test('inactive editor callbacks cannot modify the newly selected mode', context => {
  const environment = createEnvironment(context);
  const setup = createHass();
  catalogSource(setup, { Dairy: [{ title: 'Milk' }] });
  const editor = environment.document.createElement('shopping-list-card-editor');
  const single = { type: 'custom:shopping-list-card', title: 'Milk', todo_list: 'todo.shopping', types: ['Whole'] };
  editor.setConfig(single);
  editor.hass = setup.hass;
  const oldUpload = editor.shadowRoot.querySelector('#image_upload');
  const oldVariants = editor.shadowRoot.querySelector('#types');
  const changes = [];
  editor.addEventListener('config-changed', event => changes.push(event.detail.config));
  const catalog = { ...single, mode: 'catalog', catalog_entity: 'sensor.catalog' };
  editor.setConfig(catalog);
  const catalogEditor = editor.shadowRoot.querySelector('shopping-list-catalog-editor');
  assert.ok(catalogEditor);
  assert.equal(editor.shadowRoot.querySelector('.card-mode input[value="catalog"]').checked, true);
  oldUpload.value = '/local/late-upload.png';
  oldUpload.dispatchEvent(new environment.window.Event('change'));
  oldVariants.dispatchEvent(new environment.window.CustomEvent('value-changed', { detail: { value: ['Late variant'] } }));
  assert.equal(changes.length, 0);
  editor.setConfig({ ...single, mode: 'single' });
  catalogEditor.dispatchEvent(new environment.window.CustomEvent('config-changed', { detail: { config: { ...catalog, title: 'Stale title' } } }));
  assert.equal(changes.length, 0);
  assert.equal(editor.shadowRoot.querySelector('#title').value, 'Milk');
  assert.equal(editor.shadowRoot.querySelector('#image').value, '');
  assert.equal(setup.services.length, 0);
});

test('variant header hold honors more-info without deleting items', async context => {
  const environment = createEnvironment(context);
  const setup = createHass([item('Apple'), item('Apple - Pink Lady')]);
  const card = mount(environment, setup.hass, {
    title: 'Apple', types: ['Pink Lady'], hold_action: { action: 'more-info' },
  });
  const events = [];
  card.addEventListener('hass-more-info', event => events.push(event));
  await settle();
  card.querySelector('.types-header').dispatchEvent(new environment.window.PointerEvent('pointerdown', { bubbles: true, button: 0, isPrimary: true }));
  const hold = [...environment.timers.values()].find(timer => timer.delay === 500);
  assert.ok(hold);
  hold.callback();
  await settle();
  assert.equal(setup.services.length, 0);
  assert.equal(events.length, 1);
  assert.equal(events[0].detail.entityId, 'todo.shopping');
});

test('editing an unrelated field preserves object-based variant configuration', context => {
  const environment = createEnvironment(context);
  const editor = environment.document.createElement('shopping-list-card-editor');
  const variants = [{ name: 'Pink Lady', image: '/local/pink.png', icon: 'mdi:food-apple' }];
  const events = [];
  editor.addEventListener('config-changed', event => events.push(event));
  editor.setConfig({ title: 'Apple', todo_list: 'todo.shopping', types: variants });
  editor.hass = createHass().hass;
  const title = editor.shadowRoot.querySelector('#title');
  title.value = 'Apples';
  title.dispatchEvent(new environment.window.Event('input'));
  assert.deepEqual(JSON.parse(JSON.stringify(events[0].detail.config.types)), variants);
});

test('the variants editor exposes editable rows without dropping existing metadata', context => {
  const environment = createEnvironment(context);
  const editor = environment.document.createElement('shopping-list-card-editor');
  const variants = ['Pink Lady', { name: 'Granny Smith', image: '/local/granny.png', icon: 'mdi:food-apple', custom: true }];
  editor.setConfig({ title: 'Apple', todo_list: 'todo.shopping', types: variants });
  editor.hass = createHass().hass;
  const control = editor.shadowRoot.querySelector('shopping-list-variants-editor');
  assert.ok(control);
  const rows = control.shadowRoot.querySelectorAll('.variant-row');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].querySelector('[data-field="name"]').value, 'Pink Lady');
  assert.equal(rows[1].querySelector('[data-field="image"]').value, '/local/granny.png');
  assert.deepEqual(JSON.parse(JSON.stringify(control.value)), variants);
});

function mountEditor(context, types, config = {}) {
  const environment = createEnvironment(context);
  const setup = createHass();
  const editor = environment.document.createElement('shopping-list-card-editor');
  const changes = [];
  editor.setConfig({ title: 'Apple', todo_list: 'todo.shopping', types, ...config });
  editor.hass = setup.hass;
  environment.document.body.append(editor);
  editor.addEventListener('config-changed', event => {
    changes.push(JSON.parse(JSON.stringify(event.detail.config)));
    editor.setConfig(JSON.parse(JSON.stringify(event.detail.config)));
  });
  const control = editor.shadowRoot.querySelector('shopping-list-variants-editor');
  const rows = () => [...control.shadowRoot.querySelectorAll('.variant-row')];
  const change = (row, field, value, event = 'input') => {
    const input = row.querySelector(`[data-field="${field}"]`);
    input.value = value;
    input.dispatchEvent(new environment.window.Event(event, { bubbles: true, composed: true }));
    return input;
  };
  return { ...environment, setup, editor, control, changes, rows, change };
}

test('variant edits keep focus, caret, expanded settings, and unrelated fields', context => {
  const setup = mountEditor(context, [{ name: 'Gala', icon: 'mdi:food-apple', custom: { aisle: 4 } }], {
    subtitle: 'Default', card_mod: { style: 'ha-card {}' },
  });
  const row = setup.rows()[0];
  row.querySelector('[data-action="media"]').click();
  const name = row.querySelector('[data-field="name"]');
  name.focus();
  name.value = 'Royal Gala';
  name.setSelectionRange(3, 3);
  name.dispatchEvent(new setup.window.Event('input'));
  assert.equal(setup.rows()[0], row);
  assert.equal(setup.control.shadowRoot.activeElement, name);
  assert.equal(name.selectionStart, 3);
  assert.equal(row.querySelector('.variant-media').hidden, false);
  assert.equal(setup.changes.length, 1);
  assert.deepEqual(setup.changes[0].types, [{ name: 'Royal Gala', icon: 'mdi:food-apple', custom: { aisle: 4 } }]);
  assert.equal(setup.changes[0].subtitle, 'Default');
  assert.deepEqual(setup.changes[0].card_mod, { style: 'ha-card {}' });
  assert.equal(setup.setup.services.length, 0);
});

test('adding a variant focuses a draft and publishes only a valid name', context => {
  const setup = mountEditor(context, ['Gala']);
  setup.control.shadowRoot.querySelector('.add-variant').click();
  const row = setup.rows()[1];
  const name = row.querySelector('[data-field="name"]');
  assert.equal(setup.control.shadowRoot.activeElement, name);
  assert.equal(name.getAttribute('aria-invalid'), 'true');
  assert.equal(setup.changes.length, 0);
  setup.change(row, 'name', ' Granny Smith ');
  assert.deepEqual(setup.changes.at(-1).types, ['Gala', 'Granny Smith']);
  assert.equal(setup.rows()[1], row);
  assert.equal(name.value, ' Granny Smith ');
});

test('duplicate and empty variant names retain the last valid configuration', context => {
  const setup = mountEditor(context, ['Gala', 'Pink Lady']);
  const row = setup.rows()[1];
  setup.change(row, 'name', ' gala ');
  assert.equal(setup.changes.length, 0);
  assert.ok(setup.rows().every(entry => entry.querySelector('[data-field="name"]').getAttribute('aria-invalid') === 'true'));
  assert.match(row.querySelector('.variant-error').textContent, /unique/);
  const title = setup.editor.shadowRoot.querySelector('#title');
  title.value = 'Apples';
  title.dispatchEvent(new setup.window.Event('input'));
  assert.deepEqual(setup.changes.at(-1).types, ['Gala', 'Pink Lady']);
  assert.equal(setup.rows()[1], row);
  setup.change(row, 'name', ' ');
  assert.equal(setup.changes.length, 1);
  assert.match(row.querySelector('.variant-error').textContent, /Enter/);
  setup.change(row, 'name', 'Fuji');
  assert.deepEqual(setup.changes.at(-1).types, ['Gala', 'Fuji']);
  assert.ok(setup.rows().every(entry => entry.querySelector('[data-field="name"]').getAttribute('aria-invalid') === 'false'));
});

test('existing string catalogs stay strings until a variant is edited', context => {
  const setup = mountEditor(context, 'Gala, Pink Lady\nFuji');
  assert.equal(setup.rows().length, 3);
  const title = setup.editor.shadowRoot.querySelector('#title');
  title.value = 'Apples';
  title.dispatchEvent(new setup.window.Event('input'));
  assert.equal(setup.changes.at(-1).types, 'Gala, Pink Lady\nFuji');
  setup.change(setup.rows()[0], 'name', 'Royal Gala');
  assert.deepEqual(setup.changes.at(-1).types, ['Royal Gala', 'Pink Lady', 'Fuji']);
});

test('variant media converts strings to objects and preserves unknown object fields', context => {
  const setup = mountEditor(context, ['Gala', { name: 'Fuji', custom: true, icon: 'mdi:tag' }]);
  const row = setup.rows()[0];
  setup.change(row, 'image', '/local/gala.png');
  assert.deepEqual(setup.changes.at(-1).types[0], { name: 'Gala', image: '/local/gala.png' });
  assert.equal(row.querySelector('[data-field="upload"]').value, '/local/gala.png');
  assert.equal(row.querySelector('.variant-preview img').getAttribute('src'), '/local/gala.png');
  const icon = row.querySelector('[data-field="icon"]');
  icon.dispatchEvent(new setup.window.CustomEvent('value-changed', { detail: { value: 'mdi:food-apple' } }));
  assert.equal(setup.changes.at(-1).types[0].icon, 'mdi:food-apple');
  setup.change(row, 'image', '');
  assert.equal(row.querySelector('.variant-preview img').hidden, true);
  assert.equal(row.querySelector('.variant-preview ha-icon').getAttribute('icon'), 'mdi:food-apple');
  setup.change(row, 'icon', '');
  assert.equal(setup.changes.at(-1).types[0], 'Gala');
  setup.change(setup.rows()[1], 'icon', '');
  assert.deepEqual(setup.changes.at(-1).types[1], { name: 'Fuji', custom: true });
});

test('an uploaded image follows its row through reorder and is ignored after removal', context => {
  const setup = mountEditor(context, ['Gala', 'Fuji']);
  const row = setup.rows()[0];
  const upload = row.querySelector('[data-field="upload"]');
  row.querySelector('[data-action="down"]').click();
  assert.equal(setup.rows()[1], row);
  assert.equal(row.querySelector('[data-field="upload"]'), upload);
  upload.value = '/api/image/serve/test/original';
  upload.dispatchEvent(new setup.window.Event('change'));
  assert.deepEqual(setup.changes.at(-1).types, ['Fuji', { name: 'Gala', image: '/api/image/serve/test/original' }]);
  row.querySelector('[data-action="remove"]').click();
  assert.deepEqual(setup.changes.at(-1).types, ['Fuji']);
  const count = setup.changes.length;
  upload.value = '/api/image/serve/late/original';
  upload.dispatchEvent(new setup.window.Event('change'));
  assert.equal(setup.changes.length, count);
  assert.equal(setup.setup.services.length, 0);
});

test('external configuration replaces drafts and invalidates old upload callbacks', context => {
  const setup = mountEditor(context, ['Gala']);
  const previousUpload = setup.rows()[0].querySelector('[data-field="upload"]');
  setup.editor.setConfig({ title: 'Apple', todo_list: 'todo.shopping', types: ['Fuji'] });
  previousUpload.value = '/local/old.png';
  previousUpload.dispatchEvent(new setup.window.Event('change'));
  assert.equal(setup.changes.length, 0);
  assert.equal(setup.rows()[0].querySelector('[data-field="name"]').value, 'Fuji');
});

test('manual variant ordering is disabled in alphabetical sort modes', context => {
  const setup = mountEditor(context, ['Gala', 'Fuji'], { types_sort: 'asc' });
  assert.ok(setup.rows().every(row => row.querySelector('[data-action="up"]').disabled && row.querySelector('[data-action="down"]').disabled));
  const sort = setup.editor.shadowRoot.querySelector('#types_sort');
  sort.dispatchEvent(new setup.window.CustomEvent('selected', { detail: { value: 'none' } }));
  assert.equal(setup.rows()[0].querySelector('[data-action="up"]').disabled, true);
  assert.equal(setup.rows()[0].querySelector('[data-action="down"]').disabled, false);
  assert.equal(setup.rows()[1].querySelector('[data-action="down"]').disabled, true);
  setup.rows()[1].querySelector('[data-action="up"]').click();
  assert.deepEqual(setup.changes.at(-1).types, ['Fuji', 'Gala']);
});

test('deleting the last variant removes the types option but never a to-do item', context => {
  const setup = mountEditor(context, ['Gala'], { subtitle: 'Default' });
  setup.rows()[0].querySelector('[data-action="remove"]').click();
  assert.equal('types' in setup.changes.at(-1), false);
  assert.equal(setup.changes.at(-1).subtitle, 'Default');
  assert.equal(setup.control.shadowRoot.activeElement, setup.control.shadowRoot.querySelector('.add-variant'));
  assert.equal(setup.setup.services.length, 0);
});

test('configured variant icons render and provide independent image fallbacks', async context => {
  const environment = createEnvironment(context);
  const setup = createHass();
  const card = mount(environment, setup.hass, { types: [
    { name: 'Whole', image: '/local/whole.png', icon: 'mdi:bottle-soda' },
    { name: 'Skim', image: '/local/skim.png', icon: 'mdi:cup' },
    { name: 'Oat', icon: 'mdi:barley' },
  ] });
  await settle();
  const rows = card.querySelectorAll('.type-row');
  assert.equal(rows[2].querySelector('.type-thumb ha-icon').getAttribute('icon'), 'mdi:barley');
  rows[1].querySelector('img').dispatchEvent(new environment.window.Event('error'));
  assert.equal(rows[1].querySelector('.type-thumb').classList.contains('image-error'), true);
  assert.equal(rows[1].querySelector('.type-image-fallback').getAttribute('icon'), 'mdi:cup');
  assert.equal(rows[0].querySelector('.type-thumb').classList.contains('image-error'), false);
});

test('50 mounted cards use one subscription without initial list fetches', async context => {
  const environment = createEnvironment(context);
  const setup = createHass();
  for (let index = 0; index < 50; index++) mount(environment, setup.hass, { title: `Item ${index}` });
  await settle();
  assert.equal(setup.subscriptions.length, 1);
  assert.equal(setup.fetches.length, 0);
  assert.equal(environment.document.querySelectorAll('.card-container').length, 50);
  assert.deepEqual(environment.errors, []);
});

test('changing lists ignores a late fetch from the previous entity', async context => {
  const environment = createEnvironment(context);
  let resolveFetch;
  const setup = createHass([], { fetch: () => new Promise(resolve => { resolveFetch = resolve; }) });
  const card = mount(environment, setup.hass);
  await settle();
  const refresh = card._store.refresh();
  card.setConfig({ title: 'Milk', todo_list: 'todo.other' });
  await settle();
  resolveFetch({ items: [item('Milk', 'from-old-list')] });
  await refresh;
  assert.equal(card._store.entityId, 'todo.other');
  assert.equal(card.querySelector('.card-container').getAttribute('aria-pressed'), 'false');
  assert.equal(card._items.length, 0);
});

test('disconnection is visible and reconnecting restores interactive state', async context => {
  const environment = createEnvironment(context);
  const setup = createHass([item('Milk')]);
  const card = mount(environment, setup.hass);
  await settle();
  card.hass = { ...setup.hass, connected: false };
  assert.match(card.querySelector('.list-status').textContent, /Disconnected/);
  assert.equal(card.querySelector('.card-container').getAttribute('aria-disabled'), 'true');
  card.hass = { ...setup.hass };
  await settle();
  assert.equal(card.querySelector('.list-status').textContent, '');
  assert.equal(card.querySelector('.card-container').getAttribute('aria-disabled'), 'false');
  assert.equal(setup.subscriptions.length, 2);
});

test('unrelated pushes and duplicate tiles do not unlock a pending add', async context => {
  const environment = createEnvironment(context);
  let finishService;
  const setup = createHass([], { service: () => new Promise(resolve => { finishService = resolve; }) });
  const first = mount(environment, setup.hass);
  const second = mount(environment, setup.hass);
  await settle();
  first.querySelector('.card-container').click();
  await settle();
  setup.push([item('Bread')]);
  first.querySelector('.card-container').click();
  second.querySelector('.card-container').click();
  await settle();
  assert.equal(setup.services.length, 1);
  assert.equal(first.querySelector('.card-container').getAttribute('aria-busy'), 'true');
  assert.equal(second.querySelector('.card-container').getAttribute('aria-busy'), 'true');
  setup.push([item('Bread'), item('Milk')]);
  finishService();
  await settle();
  for (const card of [first, second]) {
    assert.equal(card.querySelector('.card-container').getAttribute('aria-busy'), 'false');
    assert.equal(card.querySelector('.card-container').getAttribute('aria-pressed'), 'true');
  }
});

test('failed writes show a text-only error and refresh never repeats the write', async context => {
  const environment = createEnvironment(context);
  const setup = createHass([], { service: () => { throw new Error('Denied <img src=x>'); } });
  const card = mount(environment, setup.hass);
  await settle();
  card.querySelector('.card-container').click();
  await settle();
  assert.match(card.querySelector('.list-status').textContent, /Denied <img src=x>/);
  assert.equal(card.querySelector('.list-status img'), null);
  assert.equal(card.querySelector('ha-alert').getAttribute('alert-type'), 'error');
  card.querySelector('.refresh-list').click();
  await settle();
  assert.equal(setup.services.length, 1);
  assert.equal(card.querySelector('.list-status').textContent, '');
  assert.equal(card.querySelector('.card-container').getAttribute('aria-busy'), 'false');
});

test('offline clicks cannot submit writes', async context => {
  const environment = createEnvironment(context);
  const setup = createHass();
  const card = mount(environment, setup.hass);
  await settle();
  card.hass = { ...setup.hass, connected: false };
  card.querySelector('.card-container').click();
  await settle();
  assert.equal(setup.services.length, 0);
});

test('hold timers are cancelled on rerender, reconfiguration, and disconnect', async context => {
  const environment = createEnvironment(context);
  const setup = createHass([item('Milk')]);
  const card = mount(environment, setup.hass);
  await settle();
  const start = () => card.querySelector('.card-container').dispatchEvent(
    new environment.window.PointerEvent('pointerdown', { bubbles: true, button: 0, isPrimary: true }));
  const holds = () => [...environment.timers.values()].filter(timer => timer.delay === 500);
  start();
  assert.equal(holds().length, 1);
  setup.push([item('Milk (2)')]);
  assert.equal(holds().length, 0);
  start();
  card.setConfig({ title: 'Bread', todo_list: 'todo.shopping' });
  assert.equal(holds().length, 0);
  start();
  card.remove();
  assert.equal(holds().length, 0);
  assert.equal(setup.services.length, 0);
});

test('right clicks, chevron holds, and scrolling never start removal', async context => {
  const environment = createEnvironment(context);
  const setup = createHass([item('Apple')]);
  const card = mount(environment, setup.hass, { title: 'Apple', types: ['Pink Lady'] });
  await settle();
  const header = card.querySelector('.types-header');
  const pointer = (type, options = {}) => new environment.window.PointerEvent(type, {
    bubbles: true, button: 0, isPrimary: true, clientX: 0, clientY: 0, ...options,
  });
  header.dispatchEvent(pointer('pointerdown', { button: 2 }));
  card.querySelector('.types-chevron').dispatchEvent(pointer('pointerdown'));
  assert.equal(environment.timers.size, 0);
  header.dispatchEvent(pointer('pointerdown'));
  header.dispatchEvent(pointer('pointermove', { clientY: 20 }));
  assert.equal(environment.timers.size, 0);
  assert.equal(setup.services.length, 0);
});

test('collapsed variant rows are removed from keyboard interaction', async context => {
  const environment = createEnvironment(context);
  const card = mount(environment, createHass().hass, { types: ['Whole'] });
  await settle();
  const list = card.querySelector('.types-list');
  assert.equal(list.inert, true);
  card.querySelector('.types-chevron').click();
  assert.equal(list.inert, false);
  assert.equal(list.getAttribute('aria-hidden'), 'false');
});

test('a native catalog reads category attributes and shares the existing to-do subscription', async context => {
  const environment = createEnvironment(context);
  const setup = createHass([item('Milk')]);
  setup.hass.states['sensor.catalog'] = {
    state: '1',
    attributes: {
      friendly_name: 'Shopping catalog',
      Fruits: [{ title: 'Apple', types: 'Pink Lady, Gala' }, { title: 'Pear' }],
      Dairy: [{ title: 'Milk', image: '/local/milk.png' }],
    },
  };
  const catalog = environment.document.createElement('shopping-list-catalog');
  assert.equal(typeof catalog.setConfig, 'function');
  catalog.setConfig({ catalog_entity: 'sensor.catalog', todo_list: 'todo.shopping' });
  catalog.hass = setup.hass;
  environment.document.body.append(catalog);
  await settle();
  const cards = catalog.shadowRoot.querySelectorAll('shopping-list-card');
  assert.equal(cards.length, 3);
  assert.deepEqual([...catalog.shadowRoot.querySelectorAll('.catalog-category-title')].map(heading => heading.textContent), ['Fruits', 'Dairy']);
  assert.equal(cards[0]._config.types, 'Pink Lady, Gala');
  assert.equal(cards[2]._config.todo_list, 'todo.shopping');
  assert.equal(cards[2]._config.image, '/local/milk.png');
  assert.equal(setup.subscriptions.length, 1);
  assert.equal(setup.fetches.length, 0);
  assert.equal(setup.services.length, 0);
  assert.deepEqual(environment.errors, []);
});

test('catalog groups repeated title and subtitle rows into a variant dropdown', async context => {
  const environment = createEnvironment(context);
  const setup = createHass([item('Chicken - Legs')]);
  const entries = [
    { title: 'Apple' },
    { title: 'Apple', subtitle: 'Pink lady' },
    { title: 'Chicken', subtitle: 'Breast' },
    { title: 'Chicken', subtitle: 'Legs' },
  ];
  catalogSource(setup, { Products: entries });
  const catalog = mountCatalog(environment, setup.hass);
  await settle();
  const cards = [...catalog.shadowRoot.querySelectorAll('shopping-list-card')];
  assert.equal(cards.length, 2);
  assert.equal(cards[0]._config.title, 'Apple');
  assert.equal(cards[0]._config.subtitle, undefined);
  assert.deepEqual(Array.from(cards[0]._getTypes(), type => type.name), ['Pink lady']);
  const chicken = cards[1];
  assert.equal(chicken._config.subtitle, 'Breast');
  assert.deepEqual(Array.from(chicken._getTypes(), type => type.name), ['Breast', 'Legs']);
  assert.ok(chicken.querySelector('.types-chevron'));
  chicken.querySelector('.types-chevron').click();
  assert.equal(chicken.querySelector('.types-list').inert, false);
  assert.equal(chicken.querySelectorAll('.type-row')[1].getAttribute('aria-pressed'), 'true');
  assert.deepEqual(setup.hass.states['sensor.catalog'].attributes.Products, entries);
  assert.equal(setup.services.length, 0);
});

test('repeated products without subtitles retain their original order', async context => {
  const environment = createEnvironment(context);
  const setup = createHass();
  catalogSource(setup, { Products: [{ title: 'Milk' }, { title: 'Pear' }, { title: 'Milk' }] });
  const catalog = mountCatalog(environment, setup.hass);
  await settle();
  assert.deepEqual([...catalog.shadowRoot.querySelectorAll('shopping-list-card')].map(card => card._config.title), ['Milk', 'Pear', 'Milk']);
});

test('grouping keeps the bare header and variant images even when the bare row is last', async context => {
  const environment = createEnvironment(context);
  const setup = createHass();
  catalogSource(setup, { Fruits: [
    { title: 'Apple', subtitle: 'Pink lady', image: '/local/pink.png' },
    { title: 'Pear' },
    { title: 'Apple', subtitle: 'Gala', image: '/local/gala.png' },
    { title: 'Apple', image: '/local/apple.png' },
  ] });
  const catalog = mountCatalog(environment, setup.hass);
  await settle();
  const cards = [...catalog.shadowRoot.querySelectorAll('shopping-list-card')];
  assert.deepEqual(cards.map(card => card._config.title), ['Apple', 'Pear']);
  assert.equal(cards[0]._config.subtitle, undefined);
  assert.equal(cards[0]._config.image, '/local/apple.png');
  assert.deepEqual(JSON.parse(JSON.stringify(cards[0]._config.types)), [
    { name: 'Pink lady', image: '/local/pink.png' }, { name: 'Gala', image: '/local/gala.png' },
  ]);
});

test('grouping respects categories, prefixes, explicit types, product IDs, and quantity overrides', async context => {
  const environment = createEnvironment(context);
  const setup = createHass();
  catalogSource(setup, {
    Dairy: [
      { title: 'Milk', subtitle: 'Whole', list_prefix: 'Dairy' },
      { title: 'Milk', subtitle: 'Skim', list_prefix: 'Dairy' },
      { title: 'Milk', subtitle: 'Oat', list_prefix: 'Plant' },
      { title: 'Milk', subtitle: 'Soy', list_prefix: 'Plant' },
      { title: 'Milk', types: 'Almond, Cashew' },
      { title: 'Milk', subtitle: 'Heavy', quantity_max: 4 },
      { title: 'Milk', subtitle: 'Light', quantity_max: 9 },
      { title: 'Milk', subtitle: 'A', id: 'first' },
      { title: 'Milk', subtitle: 'B', id: 'second' },
      { title: 'Milk', subtitle: 'Uncombined', types: [] },
    ],
    Frozen: [{ title: 'Milk', subtitle: 'Whole' }, { title: 'Milk', subtitle: 'Skim' }],
  });
  const catalog = mountCatalog(environment, setup.hass);
  await settle();
  const sections = catalog.shadowRoot.querySelectorAll('.catalog-section');
  const cards = [...sections[0].querySelectorAll('shopping-list-card')];
  assert.equal(cards.length, 8);
  assert.equal(cards[0]._config.list_prefix, 'Dairy');
  assert.deepEqual(Array.from(cards[0]._getTypes(), type => type.name), ['Whole', 'Skim']);
  assert.equal(cards[1]._config.list_prefix, 'Plant');
  assert.equal(cards[2]._config.types, 'Almond, Cashew');
  assert.equal(cards[3]._config.quantity_max, 4);
  assert.equal(cards[4]._config.quantity_max, 9);
  assert.equal(cards[5]._config.subtitle, 'A');
  assert.equal(cards[6]._config.subtitle, 'B');
  assert.equal(cards[7]._getTypes().length, 0);
  assert.equal(sections[1].querySelectorAll('shopping-list-card').length, 1);
});

test('inferred variant actions preserve stored names and do not remove an unconfigured bare item', async context => {
  const environment = createEnvironment(context);
  const setup = createHass([item('Chicken - Legs', 'legs'), item('Chicken', 'unrelated')], {
    service(domain, service, data) {
      let next = setup.state.items.map(entry => ({ ...entry }));
      if (service === 'add_item') next.push(item(data.item, 'breast'));
      else if (service === 'update_item') next.find(entry => entry.uid === data.item).summary = data.rename;
      else next = next.filter(entry => entry.uid !== data.item);
      setup.push(next);
    },
  });
  catalogSource(setup, { Meat: [
    { title: 'Chicken', subtitle: 'Breast' }, { title: 'Chicken', subtitle: 'Legs' },
  ] });
  const catalog = mountCatalog(environment, setup.hass);
  await settle();
  const chicken = catalog.shadowRoot.querySelector('shopping-list-card');
  chicken.querySelector('.types-header').click();
  await settle();
  assert.equal(setup.services[0].data.item, 'Chicken - Breast');
  chicken.querySelectorAll('.type-row')[1].querySelector('[data-action="increment"]').click();
  await settle();
  assert.equal(setup.services[1].data.item, 'legs');
  assert.equal(setup.services[1].data.rename, 'Chicken - Legs (2)');
  await chicken._removeAllTypes();
  assert.deepEqual(setup.state.items, [item('Chicken', 'unrelated')]);
  assert.equal(setup.services.filter(call => call.service === 'remove_item').length, 2);
});

function mountCatalog(environment, hass, config = {}) {
  const card = environment.document.createElement('shopping-list-card');
  card.setConfig({ type: 'custom:shopping-list-card', mode: 'catalog', catalog_entity: 'sensor.catalog', todo_list: 'todo.shopping', ...config });
  card.hass = hass;
  environment.document.body.append(card);
  return card.querySelector('shopping-list-catalog');
}

function catalogSource(setup, categories, extraAttributes = {}) {
  setup.hass.states['sensor.catalog'] = { state: '1', attributes: { ...extraAttributes, ...categories } };
}

function visibleProducts(catalog) {
  return [...catalog.shadowRoot.querySelectorAll('shopping-list-card')].filter(card => !card.hidden);
}

test('catalog search matches category, subtitle, and variants without rebuilding product tiles', async context => {
  const environment = createEnvironment(context);
  const setup = createHass();
  catalogSource(setup, {
    Fruits: [{ title: 'Apple', types: 'Pink Lady, Gala' }],
    Drinks: [{ title: 'Coffee', subtitle: 'Caf\u00e9 blend' }, { title: 'Water' }],
  });
  const catalog = mountCatalog(environment, setup.hass);
  await settle();
  const originalApple = catalog.shadowRoot.querySelector('shopping-list-card');
  originalApple.querySelector('.types-chevron').click();
  const search = catalog.shadowRoot.querySelector('input[type="search"]');
  search.focus();
  const query = value => {
    search.value = value;
    search.dispatchEvent(new environment.window.Event('input'));
  };
  query('pink LADY');
  assert.deepEqual(visibleProducts(catalog).map(card => card._config.title), ['Apple']);
  query('drinks cafe');
  assert.deepEqual(visibleProducts(catalog).map(card => card._config.title), ['Coffee']);
  assert.equal(originalApple.inert, true);
  query('no matching product');
  assert.equal(visibleProducts(catalog).length, 0);
  assert.equal(catalog.shadowRoot.querySelector('.catalog-empty').hidden, false);
  assert.equal(catalog.shadowRoot.activeElement, search);
  catalog.shadowRoot.querySelector('.catalog-clear-search').click();
  assert.equal(visibleProducts(catalog).length, 3);
  assert.equal(visibleProducts(catalog)[0], originalApple);
  assert.equal(originalApple._expanded, true);
  assert.equal(setup.subscriptions.length, 1);
  assert.equal(setup.services.length, 0);
});

test('category tabs support keyboard selection and preserve search text', async context => {
  const environment = createEnvironment(context);
  const setup = createHass();
  catalogSource(setup, { Fruits: [{ title: 'Apple' }], Drinks: [{ title: 'Water' }] });
  const catalog = mountCatalog(environment, setup.hass);
  await settle();
  const tabs = catalog.shadowRoot.querySelectorAll('.catalog-tab');
  tabs[0].dispatchEvent(new environment.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.equal(tabs[1].getAttribute('aria-selected'), 'true');
  assert.deepEqual(visibleProducts(catalog).map(card => card._config.title), ['Apple']);
  tabs[1].dispatchEvent(new environment.window.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  assert.equal(catalog.shadowRoot.activeElement, tabs[2]);
  assert.deepEqual(visibleProducts(catalog).map(card => card._config.title), ['Water']);
  tabs[2].dispatchEvent(new environment.window.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
  assert.equal(visibleProducts(catalog).length, 2);
  assert.equal(catalog.shadowRoot.querySelector('.catalog-content').getAttribute('aria-labelledby'), tabs[0].id);
});

test('On list includes selected variants and respects kept-zero quantities and prefixes', async context => {
  const environment = createEnvironment(context);
  const setup = createHass([
    item('Apple - Gala (3)'), item('Milk (0)'), item('Dairy - Cheese'),
    { summary: 'Pear', uid: 'pear', status: 'completed' }, item('Uncatalogued item'),
  ]);
  catalogSource(setup, { Products: [
    { title: 'Apple', types: ['Gala'] },
    { title: 'Milk', remove_zero: false },
    { title: 'Cheese', list_prefix: 'Dairy' },
    { title: 'Pear' },
  ] });
  const catalog = mountCatalog(environment, setup.hass);
  await settle();
  const filter = catalog.shadowRoot.querySelector('.catalog-on-list input');
  filter.checked = true;
  filter.dispatchEvent(new environment.window.Event('change'));
  assert.deepEqual(visibleProducts(catalog).map(card => card._config.title), ['Apple', 'Cheese']);
  setup.push([item('Milk (2)')]);
  assert.deepEqual(visibleProducts(catalog).map(card => card._config.title), ['Milk']);
  setup.push([]);
  assert.equal(visibleProducts(catalog).length, 0);
  assert.equal(catalog.shadowRoot.querySelector('.catalog-empty').hidden, false);
  assert.equal(setup.services.length, 0);
});

test('catalog refresh adds and removes products while preserving unchanged cards and the source', async context => {
  const environment = createEnvironment(context);
  const setup = createHass();
  const apple = { title: 'Apple', types: ['Gala'] };
  catalogSource(setup, { Fruits: [apple], Drinks: [{ title: 'Water' }] });
  const originalSource = JSON.stringify(setup.hass.states['sensor.catalog']);
  const catalog = mountCatalog(environment, setup.hass);
  await settle();
  const card = catalog.shadowRoot.querySelector('shopping-list-card');
  card.querySelector('.types-chevron').click();
  catalog.hass = { ...setup.hass, states: { ...setup.hass.states } };
  assert.equal(card, catalog.shadowRoot.querySelector('shopping-list-card'));
  assert.equal(JSON.stringify(setup.hass.states['sensor.catalog']), originalSource);
  catalogSource(setup, { Fruits: [apple, { title: 'Pear' }], Dairy: [{ title: 'Milk' }] });
  catalog.hass = { ...setup.hass };
  await settle();
  assert.deepEqual(visibleProducts(catalog).map(product => product._config.title), ['Apple', 'Pear', 'Milk']);
  assert.equal(visibleProducts(catalog)[0], card);
  assert.equal(card._expanded, true);
  assert.deepEqual([...catalog.shadowRoot.querySelectorAll('.catalog-category-title')].map(title => title.textContent), ['Fruits', 'Dairy']);
  assert.equal(setup.subscriptions.length, 1);
  assert.equal(setup.services.length, 0);
});

test('catalog configuration supports a nested JSON attribute and forces one target list', async context => {
  const environment = createEnvironment(context);
  const setup = createHass();
  const data = { Dairy: [{ title: 'Milk', layout: 'horizontal', todo_list: 'todo.other' }] };
  catalogSource(setup, {}, { products: JSON.stringify(data) });
  const catalog = mountCatalog(environment, setup.hass, {
    catalog_attribute: 'products', item_options: { image_base: '/local/catalog/', quantity_step: 2, todo_list: 'todo.other' },
  });
  await settle();
  const card = catalog.shadowRoot.querySelector('shopping-list-card');
  assert.equal(card._config.todo_list, 'todo.shopping');
  assert.equal(card._config.image_base, '/local/catalog/');
  assert.equal(card._config.layout, 'horizontal');
  assert.equal(card._config.quantity_step, 2);
  assert.equal(setup.subscriptions[0].message.entity_id, 'todo.shopping');
});

test('invalid catalog sources show errors and cannot leave stale product controls active', async context => {
  const environment = createEnvironment(context);
  const setup = createHass();
  catalogSource(setup, { Products: [{ title: 'Milk' }] });
  const catalog = mountCatalog(environment, setup.hass);
  await settle();
  const previous = catalog.shadowRoot.querySelector('shopping-list-card');
  setup.hass.states['sensor.catalog'] = { state: 'unavailable', attributes: {} };
  catalog.hass = { ...setup.hass };
  assert.equal(catalog.shadowRoot.querySelectorAll('shopping-list-card').length, 0);
  assert.equal(previous.isConnected, false);
  assert.match(catalog.shadowRoot.querySelector('.catalog-status').textContent, /unavailable/);
  catalogSource(setup, { Products: [{ title: 'Milk' }, { title: '' }] });
  catalog.hass = { ...setup.hass };
  assert.match(catalog.shadowRoot.querySelector('.catalog-status').textContent, /Product 2.*title/);
  assert.equal(catalog.shadowRoot.querySelectorAll('shopping-list-card').length, 0);
  catalogSource(setup, { Products: [{ title: 'Milk' }] });
  catalog.hass = { ...setup.hass };
  await settle();
  assert.equal(visibleProducts(catalog).length, 1);
  assert.equal(catalog.shadowRoot.querySelector('.catalog-status').textContent, '');
  assert.equal(setup.services.length, 0);
});

test('catalog can switch list targets without accepting old list snapshots', async context => {
  const environment = createEnvironment(context);
  const setup = createHass([item('Milk')]);
  catalogSource(setup, { Dairy: [{ title: 'Milk' }] });
  const catalog = mountCatalog(environment, setup.hass);
  await settle();
  const old = setup.subscriptions[0];
  catalog.setConfig({ catalog_entity: 'sensor.catalog', todo_list: 'todo.other' });
  await settle();
  old.callback({ items: [item('Milk (5)')] });
  const card = catalog.shadowRoot.querySelector('shopping-list-card');
  assert.equal(card._config.todo_list, 'todo.other');
  assert.equal(card.querySelector('.card-container').getAttribute('aria-pressed'), 'false');
  assert.equal(old.active, false);
});

test('shopping selections persist through catalog remounts and sync across independent devices', async context => {
  const firstEnvironment = createEnvironment(context);
  const secondEnvironment = createEnvironment(context);
  const backend = [];
  const setups = [];
  const service = async (domain, action, data) => {
    assert.equal(domain, 'todo');
    assert.equal(data.entity_id, 'todo.shopping');
    if (action === 'add_item') backend.push(item(data.item, 'milk'));
    else if (action === 'update_item') backend.find(entry => entry.uid === data.item).summary = data.rename;
    else backend.splice(backend.findIndex(entry => entry.uid === data.item), 1);
    for (const setup of setups) setup.push(backend.map(entry => ({ ...entry })));
  };
  const firstSetup = createHass([], { service });
  const secondSetup = createHass([], { service });
  setups.push(firstSetup, secondSetup);
  for (const setup of setups) catalogSource(setup, { Dairy: [{ title: 'Milk' }] });
  const first = mountCatalog(firstEnvironment, firstSetup.hass);
  const second = mountCatalog(secondEnvironment, secondSetup.hass);
  await settle();
  first.shadowRoot.querySelector('shopping-list-card .card-container').click();
  await settle();
  assert.equal(second.shadowRoot.querySelector('shopping-list-card .card-container').getAttribute('aria-pressed'), 'true');
  second.shadowRoot.querySelector('shopping-list-card [data-action="increment"]').click();
  await settle();
  assert.equal(first.shadowRoot.querySelector('shopping-list-card .quantity-badge').textContent, '2');
  assert.equal(backend[0].summary, 'Milk (2)');
  first.remove();
  const remounted = mountCatalog(firstEnvironment, firstSetup.hass);
  await settle();
  assert.equal(remounted.shadowRoot.querySelector('shopping-list-card .quantity-badge').textContent, '2');
  assert.equal(firstSetup.services.length, 1);
  assert.equal(secondSetup.services.length, 1);
});

test('catalog filters remain independent across dashboards sharing the same catalog and list', async context => {
  const environment = createEnvironment(context);
  const setup = createHass();
  catalogSource(setup, { Products: [{ title: 'Apple' }, { title: 'Milk' }] });
  const first = mountCatalog(environment, setup.hass);
  const second = mountCatalog(environment, setup.hass);
  await settle();
  const search = first.shadowRoot.querySelector('input[type="search"]');
  search.value = 'Milk';
  search.dispatchEvent(new environment.window.Event('input'));
  assert.equal(visibleProducts(first).length, 1);
  assert.equal(visibleProducts(second).length, 2);
  assert.equal(setup.subscriptions.length, 1);
});

test('catalog metadata renders as text', async context => {
  const environment = createEnvironment(context);
  const setup = createHass();
  catalogSource(setup, { '<img src=x>': [{ title: '<b>Milk</b>' }] });
  const catalog = mountCatalog(environment, setup.hass, { title: '<script>test</script>' });
  await settle();
  assert.equal(catalog.shadowRoot.querySelector('.catalog-title').textContent, '<script>test</script>');
  assert.equal(catalog.shadowRoot.querySelector('.catalog-category-title img'), null);
  assert.equal(catalog.shadowRoot.querySelector('script'), null);
  assert.equal(setup.services.length, 0);
});

test('catalog icons and colors cannot inject elements into product tiles', async context => {
  const environment = createEnvironment(context);
  const setup = createHass([item('Apple - Gala')]);
  const injectedIcon = 'mdi:plus"><img data-injected src=x><ha-icon icon="mdi:plus';
  const injectedColor = 'red;"><img data-injected src=x><div style="color:red';
  catalogSource(setup, { Products: [
    { title: 'Milk', off_icon: injectedIcon, off_color: injectedColor },
    { title: 'Apple', types: ['Gala'], on_icon: injectedIcon, on_color: injectedColor },
  ] });
  const catalog = mountCatalog(environment, setup.hass);
  await settle();
  assert.equal(Boolean(catalog.shadowRoot.querySelector('[data-injected]')), false);
});

test('catalog visual editor changes only selected options and preserves advanced defaults', context => {
  const environment = createEnvironment(context);
  const setup = createHass();
  const Catalog = environment.window.customElements.get('shopping-list-catalog');
  const editor = Catalog.getConfigElement();
  const initial = {
    type: 'custom:shopping-list-card', mode: 'catalog', catalog_entity: 'sensor.catalog', todo_list: 'todo.shopping',
    catalog_attribute: 'products', item_options: { haptic: true, hold_action: { action: 'none' }, on_color: 'teal' },
    grid_options: { columns: 12 },
  };
  editor.setConfig(initial);
  editor.hass = setup.hass;
  const changes = [];
  editor.addEventListener('config-changed', event => {
    changes.push(JSON.parse(JSON.stringify(event.detail.config)));
    editor.setConfig(JSON.parse(JSON.stringify(event.detail.config)));
  });
  const root = editor.shadowRoot;
  assert.deepEqual([...root.getElementById('catalog_entity').includeDomains], ['sensor']);
  assert.deepEqual([...root.getElementById('todo_list').includeDomains], ['todo']);
  const title = root.getElementById('title');
  title.value = 'Household';
  title.dispatchEvent(new environment.window.Event('input'));
  assert.equal(changes.at(-1).title, 'Household');
  assert.deepEqual(changes.at(-1).item_options, initial.item_options);
  assert.deepEqual(changes.at(-1).grid_options, initial.grid_options);
  const layout = root.getElementById('layout');
  layout.dispatchEvent(new environment.window.CustomEvent('selected', { detail: { index: 1 } }));
  assert.equal(changes.at(-1).item_options.layout, 'horizontal');
  const quantity = root.getElementById('enable_quantity');
  quantity.checked = false;
  quantity.dispatchEvent(new environment.window.Event('change'));
  assert.equal(changes.at(-1).item_options.enable_quantity, false);
  const columns = root.getElementById('columns');
  columns.value = '3';
  columns.dispatchEvent(new environment.window.Event('input'));
  assert.equal(changes.at(-1).columns, 3);
  const count = changes.length;
  columns.value = '2.5';
  columns.dispatchEvent(new environment.window.Event('input'));
  assert.equal(changes.length, count);
  root.getElementById('catalog_attribute').value = '';
  root.getElementById('catalog_attribute').dispatchEvent(new environment.window.Event('input'));
  assert.equal('catalog_attribute' in changes.at(-1), false);
  assert.equal(setup.services.length, 0);
});

test('one card picker entry exposes both modes without registering the old catalog type', context => {
  const environment = createEnvironment(context);
  const setup = createHass();
  setup.hass.states['sensor.actual_products'] = { state: '1', attributes: { Dairy: [{ title: 'Milk' }] } };
  const Catalog = environment.window.customElements.get('shopping-list-catalog');
  const suggestion = Catalog.getStubConfig(setup.hass);
  assert.equal(suggestion.type, 'custom:shopping-list-card');
  assert.equal(suggestion.mode, 'catalog');
  assert.equal(suggestion.catalog_entity, 'sensor.actual_products');
  assert.equal(suggestion.todo_list, 'todo.shopping');
  assert.equal(Catalog.getStubConfig({ states: {} }).catalog_entity, '');
  const Card = environment.window.customElements.get('shopping-list-card');
  assert.equal(Card.getStubConfig(setup.hass).mode, 'single');
  assert.equal(Card.getStubConfig(setup.hass).todo_list, 'todo.shopping');
  assert.deepEqual(Array.from(environment.window.customCards, card => card.type), ['shopping-list-card']);
  assert.equal(environment.window.customElements.get('shopping-list-catalog-card'), undefined);
});

test('catalog category restrictions and display options clear inaccessible filters', async context => {
  const environment = createEnvironment(context);
  const setup = createHass();
  catalogSource(setup, {
    Fruits: [{ title: 'Apple' }],
    Dairy: [{ title: 'Milk' }],
    Grains: [{ title: 'Rice' }],
  });
  const catalog = mountCatalog(environment, setup.hass);
  await settle();
  catalog.shadowRoot.querySelectorAll('.catalog-tab')[1].click();
  const search = catalog.shadowRoot.querySelector('input[type="search"]');
  search.value = 'apple';
  search.dispatchEvent(new environment.window.Event('input'));
  catalog.setConfig({
    catalog_entity: 'sensor.catalog', todo_list: 'todo.shopping',
    categories: ['Dairy', 'Grains'], show_category_tabs: false, show_search: false, show_title: false,
  });
  await settle();
  assert.deepEqual(visibleProducts(catalog).map(card => card._config.title), ['Milk', 'Rice']);
  assert.equal(catalog.shadowRoot.querySelectorAll('shopping-list-card').length, 2);
  assert.equal(catalog.shadowRoot.querySelector('.catalog-tabs').hidden, true);
  assert.equal(catalog.shadowRoot.querySelector('.catalog-search').hidden, true);
  assert.equal(catalog.shadowRoot.querySelector('.catalog-title').hidden, true);
  assert.equal(search.value, '');
  assert.equal(catalog.shadowRoot.querySelector('.catalog-content').getAttribute('role'), 'region');
  assert.equal(catalog.shadowRoot.querySelector('.catalog-content').hasAttribute('aria-labelledby'), false);
  assert.equal(setup.services.length, 0);
});

test('catalog can show all categories without tabs and never exposes excluded categories', async context => {
  const environment = createEnvironment(context);
  const setup = createHass();
  catalogSource(setup, { Fruits: [{ title: 'Apple' }], Dairy: [{ title: 'Milk' }] });
  const catalog = mountCatalog(environment, setup.hass, { show_category_tabs: false });
  await settle();
  assert.equal(visibleProducts(catalog).length, 2);
  catalog.setConfig({ catalog_entity: 'sensor.catalog', todo_list: 'todo.shopping', categories: ['Missing'] });
  assert.equal(visibleProducts(catalog).length, 0);
  assert.equal(catalog.shadowRoot.querySelectorAll('shopping-list-card').length, 0);
  catalogSource(setup, { Fruits: [{ title: 'Apple' }], Missing: [{ title: 'Bread' }] });
  catalog.hass = { ...setup.hass };
  await settle();
  assert.deepEqual(visibleProducts(catalog).map(card => card._config.title), ['Bread']);
  assert.equal(setup.services.length, 0);
});

test('catalog editor saves category restrictions and independent visibility options', context => {
  const environment = createEnvironment(context);
  const setup = createHass();
  catalogSource(setup, { Fruits: [{ title: 'Apple' }], Dairy: [{ title: 'Milk' }] });
  const editor = environment.document.createElement('shopping-list-catalog-editor');
  editor.setConfig({ catalog_entity: 'sensor.catalog', todo_list: 'todo.shopping', item_options: { haptic: true } });
  editor.hass = setup.hass;
  const changes = [];
  editor.addEventListener('config-changed', event => {
    changes.push(JSON.parse(JSON.stringify(event.detail.config)));
    editor.setConfig(event.detail.config);
  });
  const root = editor.shadowRoot;
  const all = root.querySelector('.catalog-all-categories');
  assert.equal(all.checked, true);
  all.checked = false;
  all.dispatchEvent(new environment.window.Event('change'));
  assert.deepEqual(changes.at(-1).categories, ['Fruits', 'Dairy']);
  const fruits = [...root.querySelectorAll('.catalog-category-option input')].find(input => input.value === 'Fruits');
  fruits.checked = false;
  fruits.dispatchEvent(new environment.window.Event('change'));
  assert.deepEqual(changes.at(-1).categories, ['Dairy']);
  for (const option of ['show_category_tabs', 'show_search', 'show_title', 'show_list_button', 'show_add_button']) {
    const control = root.getElementById(option);
    control.checked = false;
    control.dispatchEvent(new environment.window.Event('change'));
    assert.equal(changes.at(-1)[option], false);
  }
  assert.deepEqual(changes.at(-1).item_options, { haptic: true });
  editor.hass = { ...setup.hass, states: {} };
  assert.equal(root.querySelector('.catalog-category-option input').value, 'Dairy');
  assert.equal(root.querySelector('.catalog-category-option input').checked, true);
  all.checked = true;
  all.dispatchEvent(new environment.window.Event('change'));
  assert.equal('categories' in changes.at(-1), false);
  assert.equal(root.querySelector('.catalog-category-options').hidden, true);
  assert.equal(setup.services.length, 0);
});

test('the list button opens the native full list independently of catalog filters', async context => {
  const environment = createEnvironment(context);
  const setup = createHass([item('Milk'), item('Not in the catalog')]);
  catalogSource(setup, { Dairy: [{ title: 'Milk' }], Fruits: [{ title: 'Apple' }] });
  const created = [];
  environment.window.loadCardHelpers = async () => ({ createCardElement(config) {
    const card = environment.document.createElement('hui-todo-list-card');
    card.setConfig = () => {};
    created.push({ card, config });
    return card;
  } });
  const catalog = mountCatalog(environment, setup.hass, { categories: ['Fruits'], show_title: false, show_category_tabs: false });
  let moreInfo = 0;
  catalog.addEventListener('hass-more-info', () => { moreInfo++; });
  await settle();
  const button = catalog.shadowRoot.querySelector('.catalog-open-list');
  button.click();
  await settle();
  assert.equal(created.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(created[0].config)), { type: 'todo-list', entity: 'todo.shopping' });
  assert.equal(created[0].card.hass, setup.hass);
  assert.equal(catalog.shadowRoot.querySelector('.catalog-list-panel').hidden, false);
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.equal(created[0].card.isConnected, true);
  assert.equal(moreInfo, 0);
  assert.equal(setup.services.length, 0);
  const updatedHass = { ...setup.hass };
  catalog.hass = updatedHass;
  assert.equal(created[0].card.hass, updatedHass);
  catalog.shadowRoot.querySelector('.catalog-close-list').click();
  assert.equal(catalog.shadowRoot.querySelector('.catalog-list-panel').hidden, true);
  assert.equal(created[0].card.isConnected, false);
  assert.equal(catalog.shadowRoot.activeElement, button);
});

test('late native-list loading is discarded after close, list switch, or disconnect', async context => {
  const environment = createEnvironment(context);
  const setup = createHass();
  catalogSource(setup, { Products: [{ title: 'Milk' }] });
  const catalog = mountCatalog(environment, setup.hass);
  await settle();
  for (const action of ['close', 'switch', 'disconnect']) {
    let resolveHelpers;
    let creations = 0;
    environment.window.loadCardHelpers = () => new Promise(resolve => { resolveHelpers = resolve; });
    catalog.shadowRoot.querySelector('.catalog-open-list').click();
    if (action === 'close') catalog.shadowRoot.querySelector('.catalog-close-list').click();
    else if (action === 'switch') catalog.setConfig({ catalog_entity: 'sensor.catalog', todo_list: 'todo.other' });
    else catalog.remove();
    resolveHelpers({ createCardElement() { creations++; return environment.document.createElement('hui-todo-list-card'); } });
    await settle();
    assert.equal(creations, 0);
    assert.equal(catalog.shadowRoot.querySelector('.catalog-list-content').children.length, 0);
  }
});

test('native list loading failures are visible and retry never writes to the list', async context => {
  const environment = createEnvironment(context);
  const setup = createHass();
  catalogSource(setup, { Products: [{ title: 'Milk' }] });
  environment.window.loadCardHelpers = async () => { throw new Error('Load failed <b>test</b>'); };
  const catalog = mountCatalog(environment, setup.hass);
  await settle();
  catalog.shadowRoot.querySelector('.catalog-open-list').click();
  await settle();
  const container = catalog.shadowRoot.querySelector('.catalog-list-content');
  assert.match(container.textContent, /Load failed <b>test<\/b>/);
  assert.equal(container.querySelectorAll('b').length, 0);
  environment.window.loadCardHelpers = async () => ({ createCardElement: () => {
    const card = environment.document.createElement('hui-todo-list-card');
    card.setConfig = () => {};
    return card;
  } });
  container.querySelector('button').click();
  await settle();
  assert.equal(container.querySelectorAll('hui-todo-list-card').length, 1);
  assert.equal(setup.services.length, 0);
});

test('native list lazy-load rebuilds are handled without recreating the catalog', async context => {
  const environment = createEnvironment(context);
  const setup = createHass();
  catalogSource(setup, { Products: [{ title: 'Milk' }] });
  let calls = 0;
  environment.window.loadCardHelpers = async () => ({ createCardElement() {
    const card = environment.document.createElement(++calls === 1 ? 'hui-error-card' : 'hui-todo-list-card');
    card.setConfig = () => {};
    return card;
  } });
  const catalog = mountCatalog(environment, setup.hass);
  await settle();
  const tile = catalog.shadowRoot.querySelector('shopping-list-card');
  catalog.shadowRoot.querySelector('.catalog-open-list').click();
  await settle();
  catalog.shadowRoot.querySelector('hui-error-card').dispatchEvent(new environment.window.Event('ll-rebuild', { bubbles: true, composed: true }));
  await settle();
  assert.equal(calls, 2);
  assert.equal(catalog.shadowRoot.querySelectorAll('hui-todo-list-card').length, 1);
  assert.equal(catalog.shadowRoot.querySelector('shopping-list-card'), tile);
});

test('native list waits for custom-element upgrade and cancels its loading timer', async context => {
  const environment = createEnvironment(context);
  const setup = createHass();
  catalogSource(setup, { Products: [{ title: 'Milk' }] });
  environment.window.loadCardHelpers = async () => ({ createCardElement: () => environment.document.createElement('hui-todo-list-card') });
  const catalog = mountCatalog(environment, setup.hass);
  await settle();
  catalog.shadowRoot.querySelector('.catalog-open-list').click();
  await settle();
  assert.match(catalog.shadowRoot.querySelector('.catalog-list-content').textContent, /Loading shopping list/);
  assert.ok([...environment.timers.values()].some(timer => timer.delay === 10000));
  catalog.shadowRoot.querySelector('.catalog-close-list').click();
  assert.equal([...environment.timers.values()].some(timer => timer.delay === 10000), false);
  catalog.shadowRoot.querySelector('.catalog-open-list').click();
  await settle();
  environment.window.customElements.define('hui-todo-list-card', class extends environment.window.HTMLElement {
    setConfig(config) { this.config = config; }
  });
  await settle();
  const native = catalog.shadowRoot.querySelector('hui-todo-list-card');
  assert.equal(native.config.entity, 'todo.shopping');
  assert.equal(native.hass, setup.hass);
  assert.equal([...environment.timers.values()].some(timer => timer.delay === 10000), false);
});

test('native list reports a lazy-load timeout instead of leaving a blank section', async context => {
  const environment = createEnvironment(context);
  const setup = createHass();
  catalogSource(setup, { Products: [{ title: 'Milk' }] });
  environment.window.loadCardHelpers = async () => ({ createCardElement: () => environment.document.createElement('hui-todo-list-card') });
  const catalog = mountCatalog(environment, setup.hass);
  await settle();
  catalog.shadowRoot.querySelector('.catalog-open-list').click();
  await settle();
  [...environment.timers.values()].find(timer => timer.delay === 10000).callback();
  await settle();
  assert.match(catalog.shadowRoot.querySelector('.catalog-list-content').textContent, /timed out/);
  assert.equal(catalog.shadowRoot.querySelectorAll('.catalog-list-content button').length, 1);
});

function quickAdd(environment, catalog, name) {
  const root = catalog.shadowRoot;
  const form = root.querySelector('.catalog-add-form');
  if (form.hidden) root.querySelector('.catalog-add-toggle').click();
  const input = root.querySelector('.catalog-add-input');
  input.value = name;
  input.dispatchEvent(new environment.window.Event('input'));
  form.dispatchEvent(new environment.window.Event('submit', { bubbles: true, cancelable: true }));
}

test('quick-add writes a missing item to the existing list without changing the catalog', async context => {
  const environment = createEnvironment(context);
  const setup = createHass([], { service(domain, service, data) {
    assert.equal(domain, 'todo');
    assert.equal(service, 'add_item');
    setup.push([item(data.item)]);
  } });
  catalogSource(setup, { Products: [{ title: 'Milk' }] });
  const source = JSON.stringify(setup.hass.states['sensor.catalog']);
  const first = mountCatalog(environment, setup.hass);
  const second = mountCatalog(environment, setup.hass);
  await settle();
  quickAdd(environment, first, '  Dishwasher tablets  ');
  await settle();
  assert.equal(setup.services.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(setup.services[0].data)), { entity_id: 'todo.shopping', item: 'Dishwasher tablets' });
  assert.equal(second._snapshot.items[0].summary, 'Dishwasher tablets');
  assert.equal(first.shadowRoot.querySelector('.catalog-add-input').value, '');
  assert.match(first.shadowRoot.querySelector('.catalog-add-message').textContent, /Added Dishwasher tablets/);
  assert.equal(first.shadowRoot.querySelector('.catalog-add-form').getAttribute('aria-busy'), 'false');
  assert.equal(JSON.stringify(setup.hass.states['sensor.catalog']), source);
  assert.equal(first.shadowRoot.querySelectorAll('shopping-list-card').length, 1);
  quickAdd(environment, first, ' ');
  await settle();
  assert.equal(setup.services.length, 1);
});

test('quick-add ignores repeated submits and shares its pending guard with product tiles', async context => {
  const environment = createEnvironment(context);
  let finish;
  const setup = createHass([], { service: () => new Promise(resolve => { finish = resolve; }) });
  catalogSource(setup, { Products: [{ title: 'Milk' }] });
  const first = mountCatalog(environment, setup.hass);
  const second = mountCatalog(environment, setup.hass);
  await settle();
  quickAdd(environment, first, 'Milk');
  await settle();
  setup.push([item('Bread')]);
  quickAdd(environment, first, 'Milk');
  quickAdd(environment, second, 'Milk');
  second.shadowRoot.querySelector('shopping-list-card .card-container').click();
  await settle();
  assert.equal(setup.services.length, 1);
  assert.equal(first.shadowRoot.querySelector('.catalog-add-input').disabled, true);
  assert.equal(second.shadowRoot.querySelector('.catalog-add-submit').disabled, true);
  setup.push([item('Bread'), item('Milk')]);
  finish();
  await settle();
  assert.equal(first.shadowRoot.querySelector('.catalog-add-input').value, '');
  assert.equal(first.shadowRoot.querySelector('.catalog-add-input').disabled, false);
});

test('quick-add preserves drafts and escapes rejected-write errors without replaying writes', async context => {
  const environment = createEnvironment(context);
  const setup = createHass([], { service: () => { throw new Error('Denied <img src=x>'); } });
  catalogSource(setup, { Products: [{ title: 'Milk' }] });
  const catalog = mountCatalog(environment, setup.hass);
  await settle();
  quickAdd(environment, catalog, 'Bread');
  await settle();
  assert.equal(catalog.shadowRoot.querySelector('.catalog-add-input').value, 'Bread');
  assert.match(catalog.shadowRoot.querySelector('.catalog-add-message').textContent, /Denied <img src=x>/);
  assert.equal(catalog.shadowRoot.querySelectorAll('.catalog-add-message img').length, 0);
  assert.equal(catalog.shadowRoot.querySelector('.catalog-add-message').dataset.error, 'true');
  await catalog._store.refresh();
  assert.equal(setup.services.length, 1);
});

test('quick-add rejects offline and read-only requests and does not duplicate existing quantities', async context => {
  const environment = createEnvironment(context);
  const setup = createHass([item('MILK (3)')]);
  catalogSource(setup, { Products: [{ title: 'Milk' }] });
  const catalog = mountCatalog(environment, setup.hass);
  await settle();
  quickAdd(environment, catalog, 'Milk');
  await settle();
  assert.match(catalog.shadowRoot.querySelector('.catalog-add-message').textContent, /already on the list/);
  catalog.hass = { ...setup.hass, connected: false };
  quickAdd(environment, catalog, 'Bread');
  await settle();
  assert.equal(catalog.shadowRoot.querySelector('.catalog-add-submit').disabled, true);
  assert.equal(catalog.shadowRoot.querySelector('.catalog-add-input').value, 'Bread');
  catalog.hass = { ...setup.hass, states: { ...setup.hass.states, 'todo.shopping': { state: '1', attributes: { supported_features: 0 } } } };
  await settle();
  quickAdd(environment, catalog, 'Bread');
  assert.equal(catalog.shadowRoot.querySelector('.catalog-add-toggle').disabled, true);
  assert.equal(setup.services.length, 0);
});

test('late quick-add results cannot clear a draft entered for another list', async context => {
  const environment = createEnvironment(context);
  let finish;
  const setup = createHass([], { service: () => new Promise(resolve => { finish = resolve; }) });
  catalogSource(setup, { Products: [{ title: 'Milk' }] });
  const catalog = mountCatalog(environment, setup.hass);
  await settle();
  quickAdd(environment, catalog, 'Bread');
  await settle();
  catalog.setConfig({ catalog_entity: 'sensor.catalog', todo_list: 'todo.other' });
  await settle();
  catalog.shadowRoot.querySelector('.catalog-add-toggle').click();
  catalog.shadowRoot.querySelector('.catalog-add-input').value = 'Rice';
  setup.state.items = [item('Bread')];
  finish();
  await settle();
  assert.equal(catalog.shadowRoot.querySelector('.catalog-add-input').value, 'Rice');
  assert.equal(catalog.shadowRoot.querySelector('.catalog-add-message').textContent, '');
  assert.equal(setup.services[0].data.entity_id, 'todo.shopping');
  assert.equal(setup.services.length, 1);
});