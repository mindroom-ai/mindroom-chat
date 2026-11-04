import type { Rollup } from 'vite';
import { describe, expect, it } from 'vitest';
import { startupFiles, startupPrecache } from '../scripts/precache-plan.mjs';

type ChunkShape = {
  moduleIds?: string[];
  isEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
  css?: string[];
  assets?: string[];
};

type OutputBundle = Rollup.OutputBundle;

const chunk = (fileName: string, shape: ChunkShape): Rollup.OutputChunk =>
  ({
    type: 'chunk',
    fileName,
    isEntry: shape.isEntry ?? false,
    moduleIds: shape.moduleIds ?? [],
    imports: shape.imports ?? [],
    dynamicImports: shape.dynamicImports ?? [],
    viteMetadata: {
      importedCss: new Set(shape.css ?? []),
      importedAssets: new Set(shape.assets ?? []),
    },
  } as unknown as Rollup.OutputChunk);

const asset = (fileName: string): Rollup.OutputAsset =>
  ({ type: 'asset', fileName } as unknown as Rollup.OutputAsset);

/** An entry, a signed-in page chunk and the crypto chunk that share one chunk, and lazy parts. */
const bundle = (): OutputBundle => {
  const outputs = [
    chunk('assets/index-e1.js', {
      isEntry: true,
      moduleIds: ['/repo/src/index.tsx'],
      imports: ['assets/shared-s1.js'],
      dynamicImports: ['assets/clientPages-c1.js', 'assets/crypto-k1.js', 'assets/katex-m1.js'],
      css: ['assets/index-e1.css'],
      assets: ['assets/inter-latin-i1.woff2', 'assets/mindroom-logo-l1.png'],
    }),
    chunk('assets/shared-s1.js', { moduleIds: ['/repo/src/app/state/sessions.ts'] }),
    chunk('assets/clientPages-c1.js', {
      moduleIds: ['/repo/src/app/pages/client/clientPages.tsx'],
      imports: ['assets/shared-s1.js', 'assets/calls-t1.js'],
      dynamicImports: ['assets/emoji-j1.js'],
      css: ['assets/clientPages-c1.css'],
      assets: ['assets/notification-n1.ogg'],
    }),
    chunk('assets/calls-t1.js', { moduleIds: ['/repo/src/app/features/calls/callStore.ts'] }),
    chunk('assets/crypto-k1.js', {
      moduleIds: ['C:\\repo\\node_modules\\matrix-js-sdk\\lib\\rust-crypto\\index.js'],
      imports: ['assets/shared-s1.js'],
      assets: ['assets/matrix_sdk_crypto_wasm_bg-w1.wasm'],
    }),
    chunk('assets/emoji-j1.js', {
      moduleIds: ['/repo/src/app/plugins/emoji.ts'],
      imports: ['assets/shared-s1.js'],
    }),
    chunk('assets/katex-m1.js', {
      moduleIds: ['/repo/node_modules/katex/dist/katex.mjs'],
      css: ['assets/katex-m1.css'],
      assets: ['assets/KaTeX_Main-Regular-f1.woff2'],
    }),
    asset('assets/index-e1.css'),
    asset('assets/clientPages-c1.css'),
    asset('assets/katex-m1.css'),
    asset('assets/mindroom-logo-l1.png'),
  ];
  return Object.fromEntries(outputs.map((output) => [output.fileName, output]));
};

const STARTUP = ['src/app/pages/client/clientPages.tsx', 'matrix-js-sdk/lib/rust-crypto/index.js'];

const entry = (url: string) => ({ url, revision: url.startsWith('assets/') ? null : 'r', size: 1 });

describe('startupFiles', () => {
  it('takes the entry and the startup modules with their static imports, styles, fonts and wasm', () => {
    expect([...startupFiles(bundle(), STARTUP)].sort()).toEqual([
      'assets/calls-t1.js',
      'assets/clientPages-c1.css',
      'assets/clientPages-c1.js',
      'assets/crypto-k1.js',
      'assets/index-e1.css',
      'assets/index-e1.js',
      'assets/inter-latin-i1.woff2',
      'assets/matrix_sdk_crypto_wasm_bg-w1.wasm',
      'assets/shared-s1.js',
    ]);
  });

  it('leaves out chunks reached only by a dynamic import, with their styles and fonts', () => {
    const files = startupFiles(bundle(), STARTUP);
    ['assets/emoji-j1.js', 'assets/katex-m1.js', 'assets/katex-m1.css'].forEach((file) =>
      expect(files.has(file)).toBe(false)
    );
    expect(files.has('assets/KaTeX_Main-Regular-f1.woff2')).toBe(false);
    expect(files.has('assets/mindroom-logo-l1.png')).toBe(false);
    expect(files.has('assets/notification-n1.ogg')).toBe(false);
  });

  it('fails when a startup module is in no chunk, so a rename cannot drop it silently', () => {
    expect(() => startupFiles(bundle(), ['src/app/pages/client/ClientPages.tsx'])).toThrow(
      'no chunk holds the startup module src/app/pages/client/ClientPages.tsx'
    );
  });
});

describe('startupPrecache', () => {
  const plan = () => {
    const { plugin, manifestTransform } = startupPrecache({
      startupModules: STARTUP,
      shellFiles: ['index.html', 'pdf-frame.html'],
    });
    const generateBundle = plugin.generateBundle as unknown as (
      options: unknown,
      output: OutputBundle
    ) => void;
    return { generateBundle, manifestTransform };
  };

  it('keeps only the shell and the startup files in the precache list', () => {
    const { generateBundle, manifestTransform } = plan();
    generateBundle({}, bundle());
    const globbed = [
      'index.html',
      'pdf-frame.html',
      'favicon.ico',
      'res/branding/mindroom-logo.png',
      ...Object.keys(bundle()),
      'assets/inter-latin-i1.woff2',
      'assets/matrix_sdk_crypto_wasm_bg-w1.wasm',
      'assets/KaTeX_Main-Regular-f1.woff2',
    ].map(entry);
    const { manifest } = manifestTransform(globbed);
    expect(manifest.map((item) => item.url).sort()).toEqual([
      'assets/calls-t1.js',
      'assets/clientPages-c1.css',
      'assets/clientPages-c1.js',
      'assets/crypto-k1.js',
      'assets/index-e1.css',
      'assets/index-e1.js',
      'assets/inter-latin-i1.woff2',
      'assets/matrix_sdk_crypto_wasm_bg-w1.wasm',
      'assets/shared-s1.js',
      'index.html',
      'pdf-frame.html',
    ]);
    expect(manifest.find((item) => item.url === 'index.html')).toEqual(entry('index.html'));
  });

  it('fails when a startup file never reached the precache globs', () => {
    const { generateBundle, manifestTransform } = plan();
    generateBundle({}, bundle());
    expect(() =>
      manifestTransform(['index.html', 'pdf-frame.html', 'assets/index-e1.js'].map(entry))
    ).toThrow('startup files outside the precache globs: assets/index-e1.css');
  });

  it('fails when the worker is built before the bundle was seen', () => {
    expect(() => plan().manifestTransform([entry('index.html')])).toThrow(
      'the build never reported its bundle'
    );
  });
});
