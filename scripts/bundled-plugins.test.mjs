// @ts-check
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseBundledPlugins } from './bundled-plugins.mjs';

const SHA = '7a6975db7e7629e5b38e7ac0f43e7497019395b1';

test('reads repositories and commits, skipping comments and blank lines', () => {
  const text = `# a comment\n\nhttps://github.com/a/one ${SHA} # why\nhttps://github.com/b/two.git ${SHA}\n`;
  assert.deepEqual(parseBundledPlugins(text), [
    { owner: 'a', repository: 'one', commit: SHA },
    { owner: 'b', repository: 'two', commit: SHA },
  ]);
});

test('refuses a branch, a short commit, another host and a repository listed twice', () => {
  for (const line of [
    'https://github.com/a/one main',
    `https://github.com/a/one ${SHA.slice(0, 12)}`,
    `https://gitlab.com/a/one ${SHA}`,
    'https://github.com/a/one',
  ]) {
    assert.throws(() => parseBundledPlugins(line), /^Error: bundled-plugins\.txt:1: expected/);
  }
  assert.throws(
    () => parseBundledPlugins(`https://github.com/a/one ${SHA}\nhttps://github.com/b/one ${SHA}`),
    /^Error: bundled-plugins\.txt:2: one is listed twice$/
  );
});

test('the committed list is valid', () => {
  const text = readFileSync(new URL('../bundled-plugins.txt', import.meta.url), 'utf8');
  assert.ok(parseBundledPlugins(text).length > 0);
});
