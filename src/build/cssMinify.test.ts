import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import { build } from 'vite';
import { afterAll, describe, expect, it } from 'vitest';
import viteConfig from '../../vite.config.js';
const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const findWebkitOnlyBackdropRules = (css: string): string[] => {
  const offending: string[] = [];
  for (const match of css.matchAll(/([^{};@][^{}]*?)\{([^{}]+)\}/g)) {
    const declarations = match[2] ?? '';
    const hasWebkit = /(?:^|[;\s])-webkit-backdrop-filter\s*:/.test(declarations);
    const hasUnprefixed = /(?:^|[;\s])backdrop-filter\s*:/.test(declarations);
    if (hasWebkit && !hasUnprefixed) {
      offending.push(`${(match[1] ?? '').trim()} { ${declarations.trim()} }`);
    }
  }
  return offending;
};

describe('production CSS minification', () => {
  it('keeps unprefixed backdrop-filter on every rule that sets -webkit-backdrop-filter', async () => {
    const workDir = mkdtempSync(path.join(tmpdir(), 'mindroom-css-minify-'));
    tempDirs.push(workDir);
    const entryFile = path.join(workDir, 'entry.ts');
    const outDir = path.join(workDir, 'out');
    const glassCssPath = path.resolve('src/app/ui/styles/Glass.css.ts');
    writeFileSync(
      entryFile,
      `import * as glass from ${JSON.stringify(glassCssPath)};\nexport { glass };\n`,
      'utf8'
    );

    await build({
      configFile: false,
      logLevel: 'silent',
      root: process.cwd(),
      plugins: [vanillaExtractPlugin()],
      build: {
        outDir,
        emptyOutDir: true,
        target: viteConfig.build?.target,
        cssMinify: viteConfig.build?.cssMinify,
        rolldownOptions: {
          input: entryFile,
        },
      },
    });

    const assetsDir = path.join(outDir, 'assets');
    const cssFiles = readdirSync(assetsDir).filter((file) => file.endsWith('.css'));
    expect(cssFiles.length).toBeGreaterThan(0);

    const css = cssFiles.map((file) => readFileSync(path.join(assetsDir, file), 'utf8')).join('\n');
    expect(css).toMatch(/(?:^|[;\s])-webkit-backdrop-filter\s*:/);
    expect(findWebkitOnlyBackdropRules(css)).toEqual([]);
  });
});
