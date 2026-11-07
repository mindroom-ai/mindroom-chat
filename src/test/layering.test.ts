import { readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import {
  APP_ROOT,
  REPO_ROOT,
  appFile,
  pathExists,
  repoFile,
  walkProductionSources,
} from './architecture';

// The domain layers of .eslintrc.cjs, checked by linting probe text under made-up paths (as
// surfaceImports.test.ts does). import/no-restricted-paths skips every import it cannot resolve,
// so without these probes a broken resolver setting or a missing zone would pass in silence.
const RULE = 'import/no-restricted-paths';
const eslint = new ESLint({ cwd: REPO_ROOT });

type Extension = '.ts' | '.tsx';
type LayeringOptions = { basePath: string; zones: { target: string; from: string[] }[] };

const domainPath = (domain: string): string =>
  domain.startsWith('src/') ? repoFile(domain) : appFile(domain);

const probeIn = (domain: string, name = 'layeringProbe.ts'): string =>
  resolve(domainPath(domain), name);

// A real module of `domain` with the given extension, imported from the folder of `probe` the way
// the code writes it (without the extension), so the probe also proves the resolver finds it.
const moduleOf = (domain: string, extension: Extension, probe: string): string => {
  const module = walkProductionSources(domainPath(domain))
    .sort()
    .find((path) => path.endsWith(extension));
  if (module === undefined) throw new Error(`${domain} has no ${extension} module`);
  const specifier = relative(dirname(probe), module).slice(0, -extension.length);
  return specifier.startsWith('.') ? specifier : `./${specifier}`;
};

async function layeringMessages(source: string, probe: string) {
  // The resolver resolves nothing from a folder that does not exist, which would leave the rule
  // silent and every expectation below met.
  expect(pathExists(dirname(probe))).toBe(true);
  const [result] = await eslint.lintText(source, { filePath: probe });
  expect(result?.fatalErrorCount).toBe(0);
  return (result?.messages ?? []).filter((message) => message.ruleId === RULE);
}

// The rule's options for a file, or undefined where the rule is not configured.
async function layeringOptions(path: string): Promise<LayeringOptions | undefined> {
  const config = (await eslint.calculateConfigForFile(path)) as {
    rules: Partial<Record<string, [unknown, LayeringOptions]>>;
  };
  return config.rules[RULE]?.[1];
}

describe('domain layering lint', () => {
  it.each<[string, string, Extension]>([
    ['lib', 'shell', '.tsx'],
    ['lib', 'shell', '.ts'],
    ['rooms', 'threads', '.ts'],
    ['ui', 'ui-actions', '.tsx'],
    ['src/sw', 'matrix', '.ts'],
    // The client SDK is for plugins: the app imports the modules it re-exports.
    ['shell', 'src/client-sdk', '.ts'],
  ])('reports an import from %s into %s (a %s module)', async (domain, other, extension) => {
    const probe = probeIn(domain);
    const source = `import '${moduleOf(other, extension, probe)}';`;
    expect(await layeringMessages(source, probe)).toEqual([
      expect.objectContaining({
        // An error, so `just lint` fails on it.
        severity: 2,
        message: expect.stringContaining(`restricted zone. ${domain} (layer `),
      }),
    ]);
  });

  it.each([
    "import type { Probe } from 'MODULE';\n\nexport type { Probe };",
    "export * from 'MODULE';",
    "export { probe } from 'MODULE';",
    "export const load = () => import('MODULE');",
  ])('counts every kind of import: %s', async (template) => {
    const probe = probeIn('lib');
    const source = template.replace('MODULE', moduleOf('shell', '.tsx', probe));
    expect(await layeringMessages(source, probe)).toHaveLength(1);
  });

  it.each([
    ['shell', 'lib'],
    ['ui-actions', 'ui'],
    ['event-store/cache', 'event-store/engine'],
  ])('lets %s import %s', async (domain, other) => {
    const probe = probeIn(domain);
    const source = `import '${moduleOf(other, '.ts', probe)}';`;
    expect(await layeringMessages(source, probe)).toEqual([]);
  });

  it.each([
    'layeringProbe.test.ts',
    'layeringProbe.test.tsx',
    'layeringProbe.test.shared.ts',
    '__tests__/layeringProbe.ts',
    'test-utils/layeringProbe.ts',
    'testUtils.ts',
  ])('lets tests import any layer: lib/%s', async (name) => {
    expect(await layeringOptions(probeIn('lib', name))).toBeUndefined();
  });

  it('gives everything in src/app a layer and names only paths that exist', async () => {
    const options = await layeringOptions(probeIn('lib'));
    if (options === undefined) throw new Error(`${RULE} is not configured for src/app`);
    const absolute = (path: string) => resolve(options.basePath, path);

    const targets = options.zones.map((zone) => absolute(zone.target));
    const entries = readdirSync(APP_ROOT)
      .filter((name) => !name.startsWith('.'))
      .map(appFile);
    expect(entries.filter((entry) => !targets.includes(entry))).toEqual([]);

    const named = options.zones.flatMap((zone) => [zone.target, ...zone.from]).map(absolute);
    expect(named.filter((path) => !pathExists(path))).toEqual([]);
  });
});
