import { execFile } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { ESLint } from 'eslint';
import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';
import { CLIENT_PLUGIN_API_VERSION, SHARED_PACKAGES } from '../../scripts/client-plugins.mjs';
import { TYPE_AWARE_RULES } from '../../scripts/eslint-shared.cjs';

// The configs a client plugin outside this repository uses (docs/development.md "A client plugin in
// its own repository"), tried on made-up plugins that link the app in as `.mindroom-chat`.
const ROOT = realpathSync(fileURLToPath(new URL('../..', import.meta.url)));
// A link elsewhere in some checkouts.
const NODE_MODULES = realpathSync(path.join(ROOT, 'node_modules'));

const madeDirs: string[] = [];
afterAll(() => madeDirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** A new plugin directory with these files (path in it to text) and the app linked in. */
const pluginDir = (files: Record<string, string>): string => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'plugin-configs-')));
  madeDirs.push(dir);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), text);
  }
  symlinkSync(ROOT, path.join(dir, '.mindroom-chat'));
  return dir;
};

describe('tsconfig.plugin.strict.json', () => {
  const dir = pluginDir({
    'tsconfig.json': JSON.stringify({
      extends: './.mindroom-chat/tsconfig.plugin.strict.json',
      include: ['src'],
    }),
    'src/index.ts': 'export {};\n',
    // A copy of a shared package the plugin installed, which its types must not come from.
    'node_modules/jotai/package.json': JSON.stringify({ name: 'jotai', types: 'index.d.ts' }),
    'node_modules/jotai/index.d.ts': 'export {};\n',
  });
  const parsed = ts.getParsedCommandLineOfConfigFile(path.join(dir, 'tsconfig.json'), undefined, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
    },
  });
  if (!parsed) throw new Error('no tsconfig.json');
  const realpath = (file: string | undefined) => (file ? realpathSync(file) : '');
  const resolve = (name: string) =>
    ts.resolveModuleName(name, path.join(dir, 'src/index.ts'), parsed.options, ts.sys)
      .resolvedModule?.resolvedFileName;

  it("resolves the client SDK, the testing subpath included, to the app's modules", () => {
    expect(parsed.errors).toEqual([]);
    expect(realpath(resolve('@mindroom/client-sdk/core'))).toBe(
      path.join(ROOT, 'src/client-sdk/core.ts')
    );
    expect(realpath(resolve('@mindroom/client-sdk/testing'))).toBe(
      path.join(ROOT, 'src/client-sdk/testing.ts')
    );
  });

  it.each([...SHARED_PACKAGES, 'vitest'])("takes the types of %s from the app's copy", (name) => {
    expect(realpath(resolve(name)).startsWith(`${NODE_MODULES}/`)).toBe(true);
  });

  it("compiles the plugin's files with the app's ambient types and strict flags", () => {
    const ambient = readdirSync(path.join(ROOT, 'src/types')).map((name) =>
      path.join(ROOT, 'src/types', name)
    );
    expect(parsed.fileNames.map(realpath)).toEqual(
      expect.arrayContaining([
        path.join(dir, 'src/index.ts'),
        ...ambient,
        path.join(NODE_MODULES, 'vite/client.d.ts'),
      ])
    );
    expect(parsed.options.noUncheckedIndexedAccess).toBe(true);
    expect(parsed.options.noUnusedLocals).toBe(true);
  });
});

describe('.eslintrc.plugin.cjs', () => {
  // A plugin's own config that extends it, linted from the plugin's directory as docs/development.md
  // says. Without a TypeScript program here, the type-aware rules stay off.
  const dir = pluginDir({
    '.eslintrc.cjs':
      "module.exports = { root: true, extends: ['./.mindroom-chat/.eslintrc.plugin.cjs'] };\n",
    // The resolver resolves nothing from a folder that does not exist, which would leave the
    // boundary rule silent.
    'src/panel.tsx': '',
  });
  const eslint = new ESLint({
    cwd: dir,
    resolvePluginsRelativeTo: ROOT,
    overrideConfig: {
      parserOptions: { project: null },
      rules: Object.fromEntries(Object.keys(TYPE_AWARE_RULES).map((rule) => [rule, 'off'])),
    },
  });
  const lint = async (source: string) => {
    const [result] = await eslint.lintText(source, { filePath: path.join(dir, 'src/panel.tsx') });
    expect(result?.fatalErrorCount).toBe(0);
    return (result?.messages ?? []).map(({ ruleId, message }) => ({ ruleId, message }));
  };
  const BOUNDARY = {
    ruleId: 'import/no-restricted-paths',
    message: expect.stringContaining(
      'A plugin imports the app only through @mindroom/client-sdk/<subpath>'
    ),
  };

  it.each([
    '../.mindroom-chat/src/client-sdk/core',
    '../.mindroom-chat/src/app/plugins/registry',
    '../.mindroom-chat/e2e/helpers/matrix',
    path.join(ROOT, 'src/app/plugins/registry'),
  ])('refuses an import of %s, which reaches into the app', async (specifier) => {
    expect(await lint(`import * as app from '${specifier}';\nexport { app };\n`)).toEqual([
      BOUNDARY,
    ]);
  });

  it('passes imports of the client SDK', async () => {
    expect(
      await lint(
        "import { PopOut } from '@mindroom/client-sdk/ui';\nimport { usePluginConfig } from '@mindroom/client-sdk/core';\nexport { PopOut, usePluginConfig };\n"
      )
    ).toEqual([]);
  });

  it("refuses folds' own PopOut and physical sides in a style", async () => {
    const messages = await lint(
      "import { PopOut } from 'folds';\nexport const Panel = () => <PopOut style={{ paddingLeft: 4 }} />;\n"
    );
    expect(messages.map(({ ruleId }) => ruleId)).toEqual([
      'no-restricted-imports',
      'no-restricted-syntax',
    ]);
  });
});

describe("a listed plugin's unit tests", () => {
  // A plugin whose test imports a package name its build module's resolveId maps to a file of its
  // own, and whose build-only transform would break the test if the unit tests ran it.
  const dir = pluginDir({
    'package.json': JSON.stringify({
      name: 'tested-plugin',
      version: '1.0.0',
      mindroomClientPlugin: {
        id: 'tested',
        apiVersion: CLIENT_PLUGIN_API_VERSION,
        entry: './index.js',
        build: './build.mjs',
      },
    }),
    'index.js': 'export default {};\n',
    'build.mjs':
      "import { fileURLToPath } from 'node:url';\n" +
      "const greeting = fileURLToPath(new URL('./compat/greeting.js', import.meta.url));\n" +
      'export default [\n' +
      "  { name: 'alias', enforce: 'pre', resolveId: (source) => (source === 'old-greeting' ? greeting : null) },\n" +
      "  { name: 'built', apply: 'build', transform: (code) => code.replace('Hello', 'Built') },\n" +
      '];\n',
    'compat/greeting.js': 'export const greeting = (name) => `Hello, ${name}`;\n',
    'src/greeting.test.ts':
      "import { expect, it } from 'vitest';\nimport { greeting } from 'old-greeting';\n" +
      "it('greets', () => expect(greeting('Ada')).toBe('Hello, Ada'));\n",
  });
  const TEST = path.join(dir, 'src/greeting.test.ts');

  /** Runs this app's Vitest with these arguments and variables, without those of this run. */
  const vitest = (args: string[], env: Record<string, string>) =>
    promisify(execFile)(
      process.execPath,
      [path.join(ROOT, 'node_modules/vitest/vitest.mjs'), ...args],
      {
        cwd: ROOT,
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(([name]) => !name.startsWith('VITEST'))
          ),
          MINDROOM_CLIENT_PLUGINS: dir,
          ...env,
        },
        maxBuffer: 64 * 1024 * 1024,
      }
    );

  it("runs only them with MINDROOM_CLIENT_PLUGIN_TESTS_ONLY=1, through the build module's resolveId", async () => {
    const report = path.join(dir, 'report.json');
    await vitest(['run', '--reporter=json', `--outputFile=${report}`], {
      MINDROOM_CLIENT_PLUGIN_TESTS_ONLY: '1',
    });
    const { testResults } = JSON.parse(readFileSync(report, 'utf8')) as {
      testResults: { name: string; status: string }[];
    };
    expect(testResults.map(({ name, status }) => [name, status])).toEqual([[TEST, 'passed']]);
  }, 120_000);

  it("collects them beside the app's own, and none through the plugin's link to the app", async () => {
    const { stdout } = await vitest(['list', '--filesOnly', '--json'], {});
    const files = (JSON.parse(stdout) as { file: string }[]).map(({ file }) => file);
    expect(files).toContain(TEST);
    expect(files).toContain(path.join(ROOT, 'src/build/pluginConfigs.test.ts'));
    expect(files.filter((file) => file.startsWith(dir))).toEqual([TEST]);
  }, 120_000);
});
