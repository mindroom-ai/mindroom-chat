import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import { afterAll, describe, expect, it, vi } from 'vitest';

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('production CJS interop', () => {
  it('bundles keyboard.ts so preventScrollWithArrowKey handles ArrowDown without throwing', async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'mindroom-cjs-interop-'));
    tempDirs.push(outDir);

    await build({
      configFile: false,
      logLevel: 'silent',
      root: process.cwd(),
      build: {
        outDir,
        emptyOutDir: true,
        lib: {
          entry: path.resolve('src/app/lib/keyboard.ts'),
          formats: ['es'],
          fileName: () => 'keyboard.mjs',
        },
      },
    });

    const built = (await import(pathToFileURL(path.join(outDir, 'keyboard.mjs')).href)) as {
      preventScrollWithArrowKey: (event: unknown) => void;
    };

    const arrowPreventDefault = vi.fn();
    built.preventScrollWithArrowKey({
      key: 'ArrowDown',
      which: 40,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      preventDefault: arrowPreventDefault,
    });
    expect(arrowPreventDefault).toHaveBeenCalledTimes(1);

    const letterPreventDefault = vi.fn();
    built.preventScrollWithArrowKey({
      key: 'a',
      which: 65,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      preventDefault: letterPreventDefault,
    });
    expect(letterPreventDefault).not.toHaveBeenCalled();
  });
});
