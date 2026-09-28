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
  assert.equal(setup.store.snapshot.undo.count, 1);
  assert.equal(setup.store.snapshot.undo.summary, 'Bread');
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

test('Undo restores a confirmed removal batch with quantities and item details', async context => {
  const originals = [
    { ...item('Milk (2)', 'milk'), description: 'Whole milk', due: '2026-10-01' },
    item('Milk - Lactose-free (3)', 'lactose-free'),
  ];
  let nextUid = 1;
  const setup = fixture(context, { service(domain, service, data) {
    assert.equal(domain, 'todo');
    if (service === 'remove_item') setup.push(setup.state.items.filter(entry => entry.uid !== data.item));
    else if (service === 'add_item') {
      setup.push([...setup.state.items, {
        ...item(data.item, `restored-${nextUid++}`),
        ...(data.description === undefined ? {} : { description: data.description }),
        ...(data.due_date === undefined ? {} : { due: data.due_date }),
      }]);
    } else assert.fail(`Unexpected service ${service}`);
  } });
  await settle();
  setup.push(originals);
  const config = { title: 'Milk', enable_quantity: true };
  await setup.store.execute(['milk', 'milk - lactose-free'], items => [
    planItemAction(config, items, null, 'remove'),
    planItemAction(config, items, 'Lactose-free', 'remove'),
  ]);
  assert.deepEqual(setup.store.items, []);
  assert.equal(setup.store.snapshot.undo.count, 2);
  assert.equal(getTodoStore(setup.hass, 'todo.shopping').snapshot.undo.count, 2);
  assert.equal(await setup.store.undoLastRemoval(), true);
  assert.deepEqual(setup.services.slice(2), [
    { domain: 'todo', service: 'add_item', data: { entity_id: 'todo.shopping', item: 'Milk (2)', description: 'Whole milk', due_date: '2026-10-01' } },
    { domain: 'todo', service: 'add_item', data: { entity_id: 'todo.shopping', item: 'Milk - Lactose-free (3)' } },
  ]);
  assert.deepEqual(setup.store.items.map(entry => ({ ...entry, uid: undefined })), originals.map(entry => ({ ...entry, uid: undefined })));
  assert.equal(setup.store.snapshot.undo, null);
  assert.equal(setup.store.pending.size, 0);
  assert.equal(setup.fetches.length, 1);
});

test('Undo does not overwrite an item re-added on another device', async context => {
  const setup = fixture(context, { service(domain, service) {
    assert.equal(service, 'remove_item');
    setup.push([]);
  } });
  await settle();
  setup.push([item('Milk (2)')]);
  await setup.store.execute(['milk'], items => [planItemAction({ title: 'Milk' }, items, null, 'remove')]);
  assert.equal(setup.store.snapshot.undo.count, 1);
  setup.state.items = [item('Milk (5)', 'remote-milk')];
  await assert.rejects(setup.store.undoLastRemoval(), /changed|already/i);
  assert.equal(setup.services.length, 1);
  assert.equal(setup.store.items[0].summary, 'Milk (5)');
  assert.equal(setup.store.snapshot.undo.count, 1);
});

test('Undo restores kept-zero quantities by UID and does not undo unrelated quantity edits', async context => {
  const setup = fixture(context, { service(domain, service, data) {
    assert.equal(service, 'update_item');
    setup.push([item(data.rename, 'original')]);
  } });
  await settle();
  setup.push([item('Milk (3)', 'original')]);
  const config = { title: 'Milk', enable_quantity: true, remove_zero: false };
  await setup.store.execute(['milk'], items => [planItemAction(config, items, null)]);
  assert.equal(setup.store.items[0].summary, 'Milk (0)');
  assert.equal(setup.store.snapshot.undo.count, 1);
  await setup.store.undoLastRemoval();
  assert.equal(setup.store.items[0].summary, 'Milk (3)');
  assert.equal(setup.services[1].data.item, 'original');
  assert.equal(setup.store.snapshot.undo, null);
  await setup.store.execute(['milk'], items => [planItemAction(config, items, null, 'decrement')]);
  assert.equal(setup.store.items[0].summary, 'Milk (2)');
  assert.equal(setup.store.snapshot.undo, null);
});

test('Undo retries only the failed part of a restore and never replays it automatically', async context => {
  let denyBread = true;
  const setup = fixture(context, { service(domain, service, data) {
    if (service === 'remove_item') setup.push(setup.state.items.filter(entry => entry.uid !== data.item));
    else {
      if (data.item === 'Bread' && denyBread) throw new Error('Restore denied');
      setup.push([...setup.state.items, item(data.item, `${data.item}-restored`)]);
    }
  } });
  await settle();
  setup.push([item('Milk'), item('Bread', 'bread')]);
  await setup.store.execute(['milk', 'bread'], items => [
    planItemAction({ title: 'Milk' }, items, null, 'remove'),
    planItemAction({ title: 'Bread' }, items, null, 'remove'),
  ]);
  await assert.rejects(setup.store.undoLastRemoval(), /Restore denied/);
  assert.deepEqual(setup.store.items.map(entry => entry.summary), ['Milk']);
  assert.equal(setup.store.snapshot.undo.count, 1);
  assert.equal(setup.store.snapshot.undo.summary, 'Bread');
  setup.push([...setup.state.items]);
  await settle();
  assert.equal(setup.services.length, 4);
  denyBread = false;
  await setup.store.undoLastRemoval();
  assert.equal(setup.services.length, 5);
  assert.equal(setup.services[4].data.item, 'Bread');
  assert.equal(setup.store.snapshot.undo, null);
  assert.deepEqual(setup.store.items.map(entry => entry.summary), ['Milk', 'Bread']);
});

test('Undo serializes repeat clicks and blocks overlapping card changes during restoration', async context => {
  const restore = deferred();
  const setup = fixture(context, { async service(domain, service, data) {
    if (service === 'remove_item') setup.push([]);
    else {
      await restore.promise;
      setup.push([item(data.item, 'restored')]);
    }
  } });
  await settle();
  setup.push([item('Milk')]);
  await setup.store.execute(['milk'], items => [planItemAction({ title: 'Milk' }, items, null, 'remove')]);
  const undo = setup.store.undoLastRemoval();
  await settle();
  assert.equal(setup.store.snapshot.undo.busy, true);
  assert.equal(await setup.store.undoLastRemoval(), false);
  assert.equal(await setup.store.execute(['bread'], items => [planItemAction({ title: 'Bread' }, items, null)]), false);
  setup.store.dismissUndo();
  assert.equal(setup.store.snapshot.undo.count, 1);
  assert.equal(setup.services.length, 2);
  restore.resolve();
  assert.equal(await undo, true);
  assert.equal(setup.store.snapshot.undo, null);
  assert.equal(await setup.store.undoLastRemoval(), false);
});

test('Undo refuses changed kept-zero items and unsupported metadata before writing', async context => {
  const setup = fixture(context, { service(domain, service, data) {
    setup.push(service === 'remove_item' ? [] : [item(data.rename, 'milk')]);
  } });
  await settle();
  setup.push([item('Milk (2)')]);
  const config = { title: 'Milk', enable_quantity: true, remove_zero: false };
  await setup.store.execute(['milk'], items => [planItemAction(config, items, null)]);
  setup.push([item('Milk (4)')]);
  await assert.rejects(setup.store.undoLastRemoval(), /changed/);
  assert.equal(setup.services.length, 1);
  setup.store.dismissUndo();
  const original = { ...item('Milk'), description: 'Keep this note', due: '2026-10-01T09:30:00+00:00' };
  setup.push([original]);
  await setup.store.execute(['milk'], items => [planItemAction(config, items, null, 'remove')]);
  setup.hass.states['todo.shopping'].attributes = { supported_features: 1 };
  await assert.rejects(setup.store.undoLastRemoval(), /descriptions/);
  assert.equal(setup.services.length, 2);
  assert.equal(setup.store.snapshot.undo.count, 1);
  setup.hass.states['todo.shopping'].attributes.supported_features = 127;
  const action = setup.store._restoreAction(setup.store._undo.records[0]);
  assert.deepEqual(action.data, { item: 'Milk', description: 'Keep this note', due_datetime: original.due });
});

test('Undo is unavailable offline, can be dismissed, and disappears when the shared store closes', async context => {
  const setup = fixture(context, { service() { setup.push([]); } });
  await settle();
  setup.push([item('Milk')]);
  await setup.store.execute(['milk'], items => [planItemAction({ title: 'Milk' }, items, null, 'remove')]);
  setup.store.updateHass({ ...setup.hass, connected: false });
  await assert.rejects(setup.store.undoLastRemoval(), /Disconnected/);
  assert.equal(setup.services.length, 1);
  setup.store.updateHass(setup.hass);
  await settle();
  assert.equal(setup.store.snapshot.undo.count, 1);
  setup.store.dismissUndo();
  assert.equal(setup.store.snapshot.undo, null);
  setup.push([item('Milk')]);
  await setup.store.execute(['milk'], items => [planItemAction({ title: 'Milk' }, items, null, 'remove')]);
  setup.unsubscribe();
  assert.equal(setup.store.closed, true);
  assert.equal(setup.store.snapshot.undo, null);
});

test('Undo does not mistake a completed item for a confirmed deletion', async context => {
  const setup = fixture(context, { service() { setup.push([{ ...item('Milk'), status: 'completed' }]); } });
  await settle();
  setup.push([item('Milk')]);
  await setup.store.execute(['milk'], items => [planItemAction({ title: 'Milk' }, items, null, 'remove')]);
  assert.equal(setup.store.snapshot.undo, null);
});

test('Undo keeps the most recent removal when concurrent batches finish out of order', async context => {
  const first = deferred();
  const setup = fixture(context, { async service(domain, service, data) {
    if (data.item === 'milk') await first.promise;
    setup.push(setup.state.items.filter(entry => entry.uid !== data.item));
  } });
  await settle();
  setup.push([item('Milk'), item('Bread', 'bread')]);
  const milk = setup.store.execute(['milk'], items => [planItemAction({ title: 'Milk' }, items, null, 'remove')]);
  await setup.store.execute(['bread'], items => [planItemAction({ title: 'Bread' }, items, null, 'remove')]);
  assert.equal(setup.store.snapshot.undo.summary, 'Bread');
  first.resolve();
  await milk;
  assert.equal(setup.store.snapshot.undo.summary, 'Bread');
  assert.equal(setup.store.snapshot.undo.count, 1);
});