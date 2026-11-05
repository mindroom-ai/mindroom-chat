import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// The lint rule that keeps Lane C's module-level atoms on jotai's `atom`, which the account state
// test follows. It belongs to the type-aware Lane C block, which covers files on disk only, so the
// text is linted as an existing Lane C module.
const eslint = new ESLint({ cwd: fileURLToPath(new URL('../../../', import.meta.url)) });
const LANE_C_MODULE = 'src/app/shell/accountState.ts';

const restrictedImports = async (source: string) => {
  const [result] = await eslint.lintText(source, { filePath: LANE_C_MODULE });
  expect(result?.fatalErrorCount).toBe(0);
  return (result?.messages ?? []).filter((message) => message.ruleId === 'no-restricted-imports');
};

describe('atoms the account state test follows', () => {
  it.each([
    "import { atomWithStorage } from 'jotai/utils';\n\nexport const a = atomWithStorage('k', 1);",
    "import { atomWithReset } from 'jotai/utils';\n\nexport const a = atomWithReset(1);",
    "import { atomWithDefault } from 'jotai/utils';\n\nexport const a = atomWithDefault(() => 1);",
    "import { atom } from 'jotai/vanilla';\n\nexport const a = atom(1);",
    "import { atomWithReducer } from 'jotai/vanilla/utils';\n\nexport const a = atomWithReducer(1, (v: number) => v);",
  ])(
    'rejects an atom made past the recording: %s',
    async (source) => {
      expect(await restrictedImports(source)).toEqual([
        expect.objectContaining({
          severity: 2,
          message: expect.stringContaining('accountState.test'),
        }),
      ]);
    },
    60_000
  );

  it.each([
    "import { atom } from 'jotai';\n\nexport const a = atom(1);",
    "import { atomFamily, selectAtom } from 'jotai/utils';\n\nexport const f = atomFamily((id: string) => selectAtom(base(id), (v) => v));\ndeclare const base: (id: string) => never;",
  ])(
    'allows jotai atom, keyed families and derived atoms: %s',
    async (source) => {
      expect(await restrictedImports(source)).toEqual([]);
    },
    60_000
  );
});
