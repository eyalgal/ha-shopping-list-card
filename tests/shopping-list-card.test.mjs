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