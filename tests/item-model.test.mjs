import assert from 'node:assert/strict';
import test from 'node:test';
import { buildName, itemSummary, matchItem, planItemAction, updateTypeNames } from '../src/item-model.js';

const config = { title: 'Milk', enable_quantity: true };
const item = (summary, uid = 'milk') => ({ summary, uid, status: 'needs_action' });

test('names preserve prefixes, subtitles, and literal regex characters', () => {
  assert.equal(buildName({ title: 'Milk', list_prefix: 'Dairy' }, 'Whole'), 'Dairy - Milk - Whole');
  const name = 'A+B [large] (fresh)';
  assert.equal(matchItem([item(`${name} (3)`)], name, config).qty, 3);
  assert.equal(matchItem([item('MILK (2)')], 'Milk', config).qty, 2);
  assert.equal(matchItem([item('Milkshake')], 'Milk', config).present, false);
});

test('zero and one quantities keep the existing summary convention', () => {
  assert.equal(itemSummary(config, 'Milk', 1), 'Milk');
  assert.equal(itemSummary(config, 'Milk', 2), 'Milk (2)');
  assert.equal(itemSummary({ ...config, remove_zero: false }, 'Milk', 0), 'Milk (0)');
  assert.equal(itemSummary({ ...config, remove_zero: false }, 'Milk', 1), 'Milk (1)');
  assert.equal(itemSummary({ title: 'Milk' }, 'Milk', 4), 'Milk');
  assert.equal(matchItem([item('Milk (0)')], 'Milk', { ...config, remove_zero: false }).isOn, false);
});

test('quantity actions use the uid, configured step, and maximum', () => {
  const increment = planItemAction({ ...config, quantity_step: 2, quantity_max: 4 }, [item('Milk (3)')], null, 'increment');
  assert.deepEqual(increment.data, { item: 'milk', rename: 'Milk (4)' });
  assert.equal(increment.confirmed([item('Milk (4)')]), true);
  assert.equal(planItemAction({ ...config, quantity_max: 4 }, [item('Milk (4)')], null, 'increment'), null);
  const decrement = planItemAction({ ...config, quantity_step: 3 }, [item('Milk (2)')], null, 'decrement');
  assert.equal(decrement.data.rename, 'Milk');
});

test('toggle adds missing items and preserves multi-quantity tap behavior', () => {
  const add = planItemAction(config, [], null);
  assert.equal(add.service, 'add_item');
  assert.deepEqual(add.data, { item: 'Milk' });
  assert.equal(add.confirmed([item('MILK')]), true);
  assert.equal(planItemAction(config, [item('Milk (2)')], null), null);
  assert.equal(planItemAction(config, [item('Milk')], null).service, 'remove_item');
});

test('keep-zero toggles update existing items instead of adding or removing', () => {
  const keep = { ...config, remove_zero: false };
  assert.deepEqual(planItemAction(keep, [item('Milk (0)')], null).data, { item: 'milk', rename: 'Milk (1)' });
  assert.deepEqual(planItemAction(keep, [item('Milk (3)')], null).data, { item: 'milk', rename: 'Milk (0)' });
  assert.equal(planItemAction(keep, [item('Milk (1)')], null, 'decrement').data.rename, 'Milk (0)');
  assert.equal(planItemAction(keep, [item('Milk (0)')], null, 'remove').service, 'remove_item');
});

test('remove confirmation follows the target uid, not another matching item', () => {
  const remove = planItemAction(config, [item('Milk'), item('Milk', 'other')], null, 'remove');
  assert.equal(remove.confirmed([item('Milk', 'other')]), true);
  assert.equal(remove.confirmed([item('Milk')]), false);
});

test('summary-only entities remain supported', () => {
  const action = planItemAction(config, [{ summary: 'Milk' }], null, 'increment');
  assert.deepEqual(action.data, { item: 'Milk', rename: 'Milk (2)' });
  assert.equal(action.confirmed([{ summary: 'Milk (2)' }]), true);
});

test('variant metadata survives unrelated edits, reordering, and renaming', () => {
  const variants = [{ name: 'Whole', image: '/local/whole.png', icon: 'mdi:bottle-soda', custom: 1 }, 'Skim'];
  assert.deepEqual(updateTypeNames(variants, 'Whole\nSkim'), variants);
  assert.deepEqual(updateTypeNames(variants, 'Skim\nWhole'), ['Skim', variants[0]]);
  assert.deepEqual(updateTypeNames(variants, 'Organic\nSkim'), [{ ...variants[0], name: 'Organic' }, 'Skim']);
  assert.deepEqual(updateTypeNames(variants, 'Whole\nSkim\nOat'), [...variants, 'Oat']);
  assert.deepEqual(updateTypeNames(variants, 'Whole'), [variants[0]]);
  assert.deepEqual(updateTypeNames('Whole, Skim', 'Whole\nSkim'), ['Whole', 'Skim']);
  assert.deepEqual(updateTypeNames(variants, ''), []);
});