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
  const catalog = environment.document.createElement('shopping-list-catalog-card');
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

function mountCatalog(environment, hass, config = {}) {
  const catalog = environment.document.createElement('shopping-list-catalog-card');
  catalog.setConfig({ catalog_entity: 'sensor.catalog', todo_list: 'todo.shopping', ...config });
  catalog.hass = hass;
  environment.document.body.append(catalog);
  return catalog;
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

test('catalog metadata renders as text and opening the list only raises more-info', async context => {
  const environment = createEnvironment(context);
  const setup = createHass();
  catalogSource(setup, { '<img src=x>': [{ title: '<b>Milk</b>' }] });
  const catalog = mountCatalog(environment, setup.hass, { title: '<script>test</script>' });
  await settle();
  assert.equal(catalog.shadowRoot.querySelector('.catalog-title').textContent, '<script>test</script>');
  assert.equal(catalog.shadowRoot.querySelector('.catalog-category-title img'), null);
  assert.equal(catalog.shadowRoot.querySelector('script'), null);
  const events = [];
  catalog.addEventListener('hass-more-info', event => events.push(event.detail));
  catalog.shadowRoot.querySelector('.catalog-open-list').click();
  assert.equal(events.length, 1);
  assert.equal(events[0].entityId, 'todo.shopping');
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
  const Catalog = environment.window.customElements.get('shopping-list-catalog-card');
  const editor = Catalog.getConfigElement();
  const initial = {
    type: 'custom:shopping-list-catalog-card', catalog_entity: 'sensor.catalog', todo_list: 'todo.shopping',
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

test('catalog picker suggestions use real entities instead of guessing catalog IDs', context => {
  const environment = createEnvironment(context);
  const setup = createHass();
  setup.hass.states['sensor.actual_products'] = { state: '1', attributes: { Dairy: [{ title: 'Milk' }] } };
  const Catalog = environment.window.customElements.get('shopping-list-catalog-card');
  const suggestion = Catalog.getStubConfig(setup.hass);
  assert.equal(suggestion.catalog_entity, 'sensor.actual_products');
  assert.equal(suggestion.todo_list, 'todo.shopping');
  assert.equal(Catalog.getStubConfig({ states: {} }).catalog_entity, '');
  assert.equal(environment.window.customCards.filter(card => card.type === 'shopping-list-catalog-card').length, 1);
});