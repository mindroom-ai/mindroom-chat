import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build, type Plugin, type Rollup } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { afterAll, describe, expect, it } from 'vitest';
import { buildInventory, startupFiles, startupPrecache } from '../../scripts/precache-plan.mjs';

type ChunkShape = {
  facade?: string;
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
    facadeModuleId: shape.facade ?? null,
    moduleIds: shape.moduleIds ?? [],
    imports: shape.imports ?? [],
    dynamicImports: shape.dynamicImports ?? [],
    viteMetadata: {
      importedCss: new Set(shape.css ?? []),
      importedAssets: new Set(shape.assets ?? []),
    },
  } as unknown as Rollup.OutputChunk);

const asset = (fileName: string, source?: string): Rollup.OutputAsset =>
  ({
    type: 'asset',
    fileName,
    originalFileNames: source ? [source] : [],
  } as unknown as Rollup.OutputAsset);

/** An entry, a signed-in page chunk and the crypto chunk that share one chunk, and lazy parts. */
const bundle = (): OutputBundle => {
  const outputs = [
    chunk('assets/index-e1.js', {
      isEntry: true,
      facade: '/repo/src/index.tsx',
      // English's overlay ships in the entry chunk.
      moduleIds: ['/repo/src/index.tsx', '/repo/src/app/i18n/locales/additions/en.json'],
      imports: ['assets/shared-s1.js'],
      dynamicImports: ['assets/clientPages-c1.js', 'assets/crypto-k1.js', 'assets/katex-m1.js'],
      css: ['assets/index-e1.css'],
      assets: ['assets/inter-latin-i1.woff2', 'assets/mindroom-logo-l1.png'],
    }),
    chunk('assets/shared-s1.js', { moduleIds: ['/repo/src/app/matrix/session/sessions.ts'] }),
    chunk('assets/clientPages-c1.js', {
      moduleIds: ['/repo/src/app/shell/clientPages.tsx'],
      imports: ['assets/shared-s1.js', 'assets/calls-t1.js'],
      dynamicImports: ['assets/emoji-j1.js'],
      css: ['assets/clientPages-c1.css'],
      assets: ['assets/notification-n1.ogg', 'assets/thinking-mark-t1.svg'],
    }),
    chunk('assets/calls-t1.js', { moduleIds: ['/repo/src/app/calls/callStore.ts'] }),
    chunk('assets/crypto-k1.js', {
      moduleIds: ['C:\\repo\\node_modules\\matrix-js-sdk\\lib\\rust-crypto\\index.js'],
      imports: ['assets/shared-s1.js'],
      assets: ['assets/matrix_sdk_crypto_wasm_bg-w1.wasm'],
    }),
    chunk('assets/emoji-j1.js', {
      moduleIds: ['/repo/src/app/emoji/emoji.ts'],
      imports: ['assets/shared-s1.js'],
    }),
    chunk('assets/katex-m1.js', {
      moduleIds: ['/repo/node_modules/katex/dist/katex.mjs'],
      css: ['assets/katex-m1.css'],
      assets: ['assets/KaTeX_Main-Regular-f1.woff2'],
    }),
    chunk('assets/de-o1.js', {
      facade: '/repo/src/app/i18n/locales/additions/de.json',
      moduleIds: ['/repo/src/app/i18n/locales/additions/de.json'],
    }),
    chunk('assets/zh-TW-o2.js', {
      facade: 'C:\\repo\\src\\app\\i18n\\locales\\additions\\zh-TW.json',
      moduleIds: ['C:\\repo\\src\\app\\i18n\\locales\\additions\\zh-TW.json'],
    }),
    asset('assets/index-e1.css'),
    asset('assets/clientPages-c1.css'),
    asset('assets/katex-m1.css'),
    asset('assets/mindroom-logo-l1.png', 'public/res/branding/mindroom-logo.png'),
    asset('assets/thinking-mark-t1.svg', 'src/app/messages/agent-run/thinking-mark.svg'),
  ];
  return Object.fromEntries(outputs.map((output) => [output.fileName, output]));
};

const STARTUP = ['src/app/shell/clientPages.tsx', 'matrix-js-sdk/lib/rust-crypto/index.js'];
const ON_DEMAND = ['src/app/messages/agent-run/thinking-mark.svg'];

const entry = (url: string) => ({ url, revision: url.startsWith('assets/') ? null : 'r', size: 1 });

const LOCALE_ADDITIONS = 'src/app/i18n/locales/additions/en.json'.replace(/[^/]+$/, '');
const OVERLAY = new RegExp(`/${LOCALE_ADDITIONS}([A-Za-z-]+)\\.json$`);

describe('startupFiles', () => {
  it('takes the entry and the startup modules with their static imports, styles, fonts, images and wasm', () => {
    expect([...startupFiles(bundle(), STARTUP)].sort()).toEqual([
      'assets/calls-t1.js',
      'assets/clientPages-c1.css',
      'assets/clientPages-c1.js',
      'assets/crypto-k1.js',
      'assets/index-e1.css',
      'assets/index-e1.js',
      'assets/inter-latin-i1.woff2',
      'assets/matrix_sdk_crypto_wasm_bg-w1.wasm',
      'assets/mindroom-logo-l1.png',
      'assets/shared-s1.js',
      'assets/thinking-mark-t1.svg',
    ]);
  });

  it('leaves out the images listed as on demand, and fails for a listed image the build lacks', () => {
    const files = startupFiles(bundle(), STARTUP, ON_DEMAND);
    expect(files.has('assets/thinking-mark-t1.svg')).toBe(false);
    expect(files.has('assets/mindroom-logo-l1.png')).toBe(true);
    expect(() =>
      startupFiles(bundle(), STARTUP, ['src/app/messages/agent-run/thinking-marks.svg'])
    ).toThrow(
      'no build file comes from the on-demand asset src/app/messages/agent-run/thinking-marks.svg'
    );
  });

  it('leaves out chunks reached only by a dynamic import, with their styles and fonts, and sounds', () => {
    const files = startupFiles(bundle(), STARTUP);
    ['assets/emoji-j1.js', 'assets/katex-m1.js', 'assets/katex-m1.css', 'assets/de-o1.js'].forEach(
      (file) => expect(files.has(file)).toBe(false)
    );
    expect(files.has('assets/KaTeX_Main-Regular-f1.woff2')).toBe(false);
    expect(files.has('assets/notification-n1.ogg')).toBe(false);
  });

  it('fails when a startup module is in no chunk, so a rename cannot drop it silently', () => {
    expect(() => startupFiles(bundle(), ['src/app/shell/ClientPages.tsx'])).toThrow(
      'no chunk holds the startup module src/app/shell/ClientPages.tsx'
    );
  });
});

describe('buildInventory', () => {
  it('lists every file under the assets directory and the overlay chunk of each language', () => {
    const output = { ...bundle(), 'index.html': asset('index.html') };
    const inventory = buildInventory(output, 'assets', OVERLAY);
    expect(inventory.files).toEqual(Object.keys(bundle()).sort());
    expect(inventory.files).not.toContain('index.html');
    expect(inventory.localeOverlays).toEqual({
      de: 'assets/de-o1.js',
      'zh-TW': 'assets/zh-TW-o2.js',
    });
  });
});

describe('startupPrecache', () => {
  const plan = () => {
    const { plugin, manifestTransform, workerPlugin } = startupPrecache({
      startupModules: STARTUP,
      onDemandAssets: ON_DEMAND,
      shellFiles: ['index.html', 'pdf-frame.html'],
      localeOverlay: OVERLAY,
    });
    const generateBundle = plugin.generateBundle as unknown as (
      options: unknown,
      output: OutputBundle
    ) => void;
    const renderWorker = workerPlugin.renderChunk as unknown as (code: string) => { code: string };
    return { generateBundle, manifestTransform, renderWorker };
  };

  it('writes the build inventory into the worker in place of its marker', () => {
    const { generateBundle, renderWorker } = plan();
    generateBundle({}, bundle());
    const { code } = renderWorker('const inventory = self.__MINDROOM_BUILD_INVENTORY;');
    const written = JSON.parse(code.slice('const inventory = '.length, -1)) as {
      files: string[];
      localeOverlays: Record<string, string>;
    };
    expect(written.files).toContain('assets/emoji-j1.js');
    expect(written.localeOverlays.de).toBe('assets/de-o1.js');
  });

  it('fails a worker that does not read the inventory once, or is built before the bundle', () => {
    expect(() => plan().renderWorker('self.__MINDROOM_BUILD_INVENTORY')).toThrow(
      'the build never reported its bundle'
    );
    const { generateBundle, renderWorker } = plan();
    generateBundle({}, bundle());
    expect(() => renderWorker('const inventory = undefined;')).toThrow('0 times, not once');
  });

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
      'assets/mindroom-logo-l1.png',
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

describe('a build that fails before its bundle is written', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'precache-plan-'));
  const dist = path.join(dir, 'dist');
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(path.join(dir, 'index.html'), '<script type="module" src="./main.js"></script>\n');
  writeFileSync(path.join(dir, 'main.js'), 'export {};\n');
  writeFileSync(
    path.join(dir, 'sw.js'),
    'console.log(self.__WB_MANIFEST, self.__MINDROOM_BUILD_INVENTORY);\n'
  );

  /** A build with the plan wired into the service worker build as vite.config.js wires it. */
  const buildWith = (failing: Plugin, outDir = dist) => {
    const startup = startupPrecache({
      startupModules: [],
      shellFiles: ['index.html'],
      localeOverlay: /^$/,
    });
    return build({
      configFile: false,
      root: dir,
      logLevel: 'silent',
      plugins: [
        failing,
        startup.plugin,
        VitePWA({
          strategies: 'injectManifest',
          srcDir: dir,
          filename: 'sw.js',
          injectManifest: {
            rollupFormat: 'iife',
            injectionPoint: 'self.__WB_MANIFEST',
            manifestTransforms: [startup.manifestTransform],
            buildPlugins: { vite: [startup.workerPlugin] },
          },
          devOptions: { enabled: false },
          injectRegister: false,
          manifest: false,
        }),
      ],
      build: { outDir },
    });
  };

  it("ends with the build's own error, not the service worker build's", async () => {
    // As the third-party notices fail for a client plugin with installed packages but no lockfile.
    const generateBundle = () => {
      throw new Error('the build failed for its own reason');
    };
    await expect(buildWith({ name: 'fails', generateBundle })).rejects.toThrow(
      'the build failed for its own reason'
    );
  }, 60_000);

  // A failure in buildEnd as scripts/package-copies.mjs fails a build that holds two copies of
  // one package version.
  it.each(['buildStart', 'buildEnd'])(
    'writes no worker into the output of an earlier build when it fails in %s',
    async (hook) => {
      mkdirSync(dist, { recursive: true });
      writeFileSync(path.join(dist, 'sw.js'), 'the earlier build');
      const fail = () => {
        throw new Error(`the build failed in ${hook}`);
      };
      await expect(buildWith({ name: 'fails', [hook]: fail })).rejects.toThrow(
        `the build failed in ${hook}`
      );
      expect(readFileSync(path.join(dist, 'sw.js'), 'utf8')).toBe('the earlier build');
    },
    60_000
  );

  it('writes no worker over an earlier build it keeps when it fails while it renders', async () => {
    // Vite keeps an output directory outside the root as it is.
    const kept = mkdtempSync(path.join(tmpdir(), 'precache-plan-kept-'));
    writeFileSync(path.join(kept, 'sw.js'), 'the earlier build');
    const generateBundle = () => {
      throw new Error('the build failed for its own reason');
    };
    try {
      await expect(buildWith({ name: 'fails', generateBundle }, kept)).rejects.toThrow();
      expect(readFileSync(path.join(kept, 'sw.js'), 'utf8')).toBe('the earlier build');
    } finally {
      rmSync(kept, { recursive: true, force: true });
    }
  }, 60_000);
});
