import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyRenames,
  changedLinePairs,
  normalize,
  onlyRenamed,
  parseTable,
} from './check-identifier-renames.mjs';

const renames = new Map([
  ['useMindroomThreadIndex', 'useThreadIndex'],
  ['MindroomThreadIndex', 'ThreadIndex'],
  ['withMindroomReasoning', 'withReasoning'],
]);

test('renames whole words only, the longer name first', () => {
  assert.equal(
    applyRenames('const index = useMindroomThreadIndex(room) as MindroomThreadIndex;', renames),
    'const index = useThreadIndex(room) as ThreadIndex;'
  );
  assert.equal(
    applyRenames('MindroomThreadIndexes $MindroomThreadIndex', renames),
    'MindroomThreadIndexes $MindroomThreadIndex'
  );
});

test('an alias or a destructured key left equal to its name counts as the plain name', () => {
  assert.equal(
    normalize("import { withReasoning as withReasoning } from './x';"),
    "import { withReasoning } from './x';"
  );
  assert.equal(
    normalize('const { useThreadIndex: useThreadIndex } = mod;'),
    'const { useThreadIndex } = mod;'
  );
  assert.equal(normalize('value.key: key'), 'value.key: key');
});

test('a line passes only when the renames explain every difference', () => {
  assert.ok(
    onlyRenamed(
      "import { withReasoning as withMindroomReasoning } from '../agent-run/Reasoning';",
      "import { withReasoning } from '../agent-run/Reasoning';",
      renames
    )
  );
  assert.ok(
    onlyRenamed(
      "describe('useMindroomThreadIndex', () => {",
      "describe('useThreadIndex', () => {",
      renames
    )
  );
  assert.ok(
    !onlyRenamed(
      'if (a) return useMindroomThreadIndex();',
      'if (b) return useThreadIndex();',
      renames
    )
  );
  assert.ok(!onlyRenamed('const x = 1;', 'const x = 2;', renames));
  // A renamed mock key beside a mock object's property that keeps its name.
  assert.ok(
    onlyRenamed(
      '  useMindroomThreadIndex: mocks.useMindroomThreadIndex,',
      '  useThreadIndex: mocks.useMindroomThreadIndex,',
      renames
    )
  );
  assert.ok(!onlyRenamed('  useMindroomThreadIndex: a,', '  useThreadIndex: b,', renames));
  // The local name of an import follows its export while a same-named local takes another name.
  const local = new Map([...renames, ['withReasoning', 'wrapWithReasoning']]);
  assert.ok(
    onlyRenamed(
      "import { withReasoning as withMindroomReasoning } from './Reasoning';",
      "import { withReasoning } from './Reasoning';",
      local
    )
  );
  assert.ok(
    onlyRenamed('  const withReasoning = (a) =>', '  const wrapWithReasoning = (a) =>', local)
  );
  assert.ok(
    onlyRenamed(
      'const { useMindroomThreadIndex } = mod;',
      'const { useThreadIndex } = mod;',
      renames
    )
  );
  assert.ok(!onlyRenamed('const { a } = mod;', 'const { a: b } = mod;', renames));
  // Quoted keys are not destructured names.
  assert.ok(
    onlyRenamed(
      "expect(useMindroomThreadIndex({ 'io.mindroom.x': 'a' })).toBe(1);",
      "expect(useThreadIndex({ 'io.mindroom.x': 'a' })).toBe(1);",
      renames
    )
  );
  // An alias that already had the export's new name.
  assert.ok(
    onlyRenamed(
      "import { useMindroomThreadIndex as useThreadIndex } from './x';",
      "import { useThreadIndex } from './x';",
      renames
    )
  );
});

test('reads the table and pairs the lines of each hunk', () => {
  assert.deepEqual(parseTable('old\tnew\tkind\nA\tB\texport\n\n'), [['A', 'B']]);
  const diff = [
    'diff --git a/src/a.ts b/src/a.ts',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -3 +3 @@',
    '-useMindroomThreadIndex();',
    '+useThreadIndex();',
    '@@ -9,2 +9 @@',
    '-one',
    '-two',
    '+three',
  ].join('\n');
  assert.deepEqual(changedLinePairs(diff), [
    {
      file: 'src/a.ts',
      line: 3,
      removed: ['useMindroomThreadIndex();'],
      added: ['useThreadIndex();'],
    },
    { file: 'src/a.ts', line: 9, removed: ['one', 'two'], added: ['three'] },
  ]);
});
