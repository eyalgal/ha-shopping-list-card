import assert from 'node:assert/strict';
import test from 'node:test';
import { getTodoStore } from '../src/todo-store.js';
import { planItemAction } from '../src/item-model.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
const item = (summary, uid = 'milk') => ({ summary, uid, status: 'needs_action' });
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
};

function fixture(context, options = {}) {
  const subscriptions = [];
  const fetches = [];
  const services = [];
  const state = { items: [], subscriptions, fetches, services };
  const hass = {
    connected: true,
    states: { 'todo.shopping': { state: '0' } },
    connection: {
      subscribeMessage(callback, message) {
        const record = { callback, message, active: true };
        subscriptions.push(record);
        if (options.subscribe) return options.subscribe(record);
        queueMicrotask(() => { if (record.active) callback({ items: state.items }); });
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
  const store = getTodoStore(hass, 'todo.shopping');
  const snapshots = [];
  const unsubscribe = store.subscribe(snapshot => snapshots.push(snapshot));
  context.after(unsubscribe);
  const push = items => {
    state.items = items;
    for (const subscription of subscriptions) {
      if (subscription.active) subscription.callback({ items });
    }
  };
  return { ...state, state, hass, store, snapshots, unsubscribe, push };
}

test('50 tiles share one initial subscription and no list fetches', async context => {
  const setup = fixture(context);
  const detach = [];
  for (let index = 0; index < 49; index++) {
    const store = getTodoStore({ ...setup.hass }, 'todo.shopping');
    assert.equal(store, setup.store);
    detach.push(store.subscribe(() => {}));
  }
  await settle();
  assert.equal(setup.subscriptions.length, 1);
  assert.equal(setup.fetches.length, 0);
  assert.equal(setup.store.ready, true);
  for (const unsubscribe of detach) unsubscribe();
  assert.equal(setup.subscriptions[0].active, true);
  setup.unsubscribe();
  assert.equal(setup.subscriptions[0].active, false);
});

test('a successful fallback fetch does not cancel subscription retries', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let attempts = 0;
  const setup = fixture(context, { subscribe(record) {
    attempts++;
    if (attempts === 1) return Promise.reject(new Error('Temporary error'));
    queueMicrotask(() => record.callback({ items: [item('Milk')] }));
    return Promise.resolve(() => { record.active = false; });
  } });
  await settle();
  assert.equal(setup.fetches.length, 1);
  assert.equal(setup.store.status, 'reconnecting');
  assert.notEqual(setup.store._retryTimer, null);
  context.mock.timers.tick(2000);
  await settle();
  assert.equal(attempts, 2);
  assert.equal(setup.store.ready, true);
  assert.equal(setup.store.items[0].summary, 'Milk');
  assert.equal(setup.store._retryTimer, null);
});

test('failed retries back off and disconnect clears the retry timer', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const setup = fixture(context, { subscribe: () => Promise.reject(new Error('Offline')) });
  await settle();
  assert.equal(setup.store._retryDelay, 2000);
  context.mock.timers.tick(2000);
  await settle();
  assert.equal(setup.store._retryDelay, 4000);
  setup.unsubscribe();
  context.mock.timers.tick(30000);
  await settle();
  assert.equal(setup.subscriptions.length, 2);
});

test('late fetches never overwrite newer pushed items', async context => {
  const fetch = deferred();
  const setup = fixture(context, { fetch: () => fetch.promise });
  await settle();
  const refresh = setup.store.refresh();
  setup.push([item('Milk (3)')]);
  fetch.resolve({ items: [item('Milk')] });
  await refresh;
  assert.equal(setup.store.items[0].summary, 'Milk (3)');
});

test('disposed requests cannot affect a replacement store', async context => {
  const fetch = deferred();
  const setup = fixture(context, { fetch: () => fetch.promise });
  await settle();
  const refresh = setup.store.refresh();
  setup.unsubscribe();
  const replacement = getTodoStore(setup.hass, 'todo.shopping');
  const detach = replacement.subscribe(() => {});
  context.after(detach);
  await settle();
  fetch.resolve({ items: [item('Old data')] });
  await refresh;
  assert.deepEqual(replacement.items, []);
  assert.equal(getTodoStore(setup.hass, 'todo.shopping'), replacement);
});

test('reconnect happens once per list and ignores the old subscription', async context => {
  const setup = fixture(context);
  await settle();
  const old = setup.subscriptions[0];
  setup.store.updateHass({ ...setup.hass, connected: false });
  assert.equal(setup.store.ready, false);
  for (let index = 0; index < 50; index++) setup.store.updateHass({ ...setup.hass });
  await settle();
  assert.equal(setup.subscriptions.length, 2);
  assert.equal(setup.fetches.length, 0);
  old.callback({ items: [item('Stale')] });
  assert.deepEqual(setup.store.items, []);
});

test('unrelated pushes and a second tile cannot unlock a pending add', async context => {
  const service = deferred();
  const setup = fixture(context, { service: () => service.promise });
  await settle();
  const action = items => [planItemAction({ title: 'Milk' }, items, null)];
  const first = setup.store.execute(['milk'], action);
  await settle();
  setup.push([item('Bread', 'bread')]);
  assert.equal(setup.store.pending.has('milk'), true);
  assert.equal(await setup.store.execute(['milk'], action), false);
  assert.equal(setup.services.length, 1);
  setup.push([item('Milk'), item('Bread', 'bread')]);
  service.resolve();
  await first;
  assert.equal(setup.store.pending.size, 0);
  assert.equal(setup.fetches.length, 0);
});

test('writes stay pending through a confirmation fetch', async context => {
  const fetch = deferred();
  const setup = fixture(context, { fetch: () => fetch.promise });
  await settle();
  const request = setup.store.execute(['milk'], items => [planItemAction({ title: 'Milk' }, items, null)]);
  await settle();
  assert.equal(setup.store.pending.has('milk'), true);
  fetch.resolve({ items: [item('Milk')] });
  await request;
  assert.equal(setup.store.pending.size, 0);
  assert.equal(setup.store.items[0].summary, 'Milk');
});

test('a write requires a fetch started after its service completes', async context => {
  const oldFetch = deferred();
  let reads = 0;
  const setup = fixture(context, { fetch: () => ++reads === 1 ? oldFetch.promise : { items: [item('Milk')] } });
  await settle();
  const refresh = setup.store.refresh();
  const write = setup.store.execute(['milk'], items => [planItemAction({ title: 'Milk' }, items, null)]);
  await settle();
  oldFetch.resolve({ items: [] });
  await Promise.all([refresh, write]);
  assert.equal(reads, 2);
  assert.equal(setup.store.items[0].summary, 'Milk');
});

test('unconfirmed updates are reported and never replayed', async context => {
  const setup = fixture(context);
  await settle();
  await assert.rejects(setup.store.execute(['milk'], items => [planItemAction({ title: 'Milk' }, items, null)]), /not confirmed/);
  assert.equal(setup.services.length, 1);
  assert.equal(setup.store.ready, false);
  assert.equal(setup.store.pending.size, 0);
});

test('bulk failure waits for all writes and refreshes without replaying them', async context => {
  const lastService = deferred();
  const setup = fixture(context, { service(domain, service, data) {
    if (data.item === 'milk') throw new Error('Permission denied');
    return lastService.promise;
  } });
  await settle();
  setup.push([item('Milk'), item('Bread', 'bread')]);
  const write = setup.store.execute(['milk', 'bread'], items => [
    planItemAction({ title: 'Milk' }, items, null, 'remove'),
    planItemAction({ title: 'Bread' }, items, null, 'remove'),
  ]);
  await settle();
  assert.equal(setup.store.pending.size, 2);
  setup.state.items = [item('Milk')];
  const failure = assert.rejects(write, /Permission denied/);
  lastService.resolve();
  await failure;
  assert.equal(setup.services.length, 2);
  assert.equal(setup.store.pending.size, 0);
  assert.equal(setup.store.items.length, 1);
});

test('detached stores remain shared until every outstanding write settles', async context => {
  const milk = deferred();
  const bread = deferred();
  const setup = fixture(context, { service: (domain, service, data) => data.item === 'Milk' ? milk.promise : bread.promise });
  await settle();
  const first = setup.store.execute(['milk'], items => [planItemAction({ title: 'Milk' }, items, null)]);
  const second = setup.store.execute(['bread'], items => [planItemAction({ title: 'Bread' }, items, null)]);
  await settle();
  setup.unsubscribe();
  setup.state.items = [item('Milk')];
  milk.resolve();
  await first;
  assert.equal(setup.store.closed, false);
  assert.equal(getTodoStore(setup.hass, 'todo.shopping'), setup.store);
  setup.state.items = [item('Milk'), item('Bread', 'bread')];
  bread.resolve();
  await second;
  assert.equal(setup.store.closed, true);
});