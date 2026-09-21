import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('package, lockfile, source, and distributed card use the same version', () => {
  const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
  const manifest = JSON.parse(read('../package.json'));
  const lock = JSON.parse(read('../package-lock.json'));
  assert.equal(lock.version, manifest.version);
  assert.equal(lock.packages[''].version, manifest.version);
  for (const filename of ['../src/shopping-list-card.js', '../shopping-list-card.js']) {
    assert.match(read(filename), new RegExp(`const CARD_VERSION = '${manifest.version.replaceAll('.', '\\.')}';`));
  }
  assert.equal(manifest.main, 'shopping-list-card.js');
  assert.doesNotMatch(read('../shopping-list-card.js'), /^import\s/m);
});