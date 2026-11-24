import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';
import { TYPE_AWARE_RULES } from '../../scripts/eslint-shared.mjs';
import { REPO_ROOT } from './architecture';

const eslint = new ESLint({
  cwd: REPO_ROOT,
  overrideConfig: {
    files: ['**/*.{ts,tsx,js,jsx,mjs,cjs}'],
    languageOptions: { parserOptions: { project: null } },
    rules: Object.fromEntries(Object.keys(TYPE_AWARE_RULES).map((rule) => [rule, 'off'])),
  },
});

const ruleIds = async (source: string, filePath: string) => {
  const [result] = await eslint.lintText(source, { filePath });
  expect(result?.fatalErrorCount).toBe(0);
  return (result?.messages ?? []).map(({ ruleId }) => ruleId);
};

describe('eslint.config.mjs runtime globals', () => {
  beforeAll(async () => {
    await eslint.calculateConfigForFile('scripts/x.mjs');
  }, 30_000);

  it.each([
    [
      'Node script rejects browser-only model',
      'scripts/x.mjs',
      'console.log(model);\n',
      ['no-undef'],
    ],
    [
      'Node e2e helper rejects browser-only model',
      'e2e/rtc/x.mjs',
      'console.log(model);\n',
      ['no-undef'],
    ],
    ['Node script accepts process', 'scripts/x.mjs', 'console.log(process.pid);\n', []],
    ['browser src JS accepts document', 'src/x.js', 'console.log(document.title);\n', []],
    ['browser src JS rejects process', 'src/x.js', 'console.log(process);\n', ['no-undef']],
    [
      'public browser JS accepts document',
      'public/viewport.js',
      'console.log(document.title);\n',
      [],
    ],
    [
      'e2e fixture .mjs accepts document',
      'e2e/fixtures/page.mjs',
      'console.log(document.title);\n',
      [],
    ],
    [
      'e2e fixture .mjs rejects process',
      'e2e/fixtures/page.mjs',
      'console.log(process);\n',
      ['no-undef'],
    ],
    [
      'AudioWorklet accepts worklet globals',
      'src/app/composer/dictation/dictationCaptureWorklet.js',
      'console.log(AudioWorkletProcessor, registerProcessor, sampleRate);\n',
      [],
    ],
    [
      'AudioWorklet rejects window',
      'src/app/composer/dictation/dictationCaptureWorklet.js',
      'console.log(window);\n',
      ['no-undef'],
    ],
    [
      'service worker JS accepts serviceworker globals',
      'src/sw/x.mjs',
      'console.log(clients, skipWaiting);\n',
      [],
    ],
    ['service worker JS rejects window', 'src/sw/x.mjs', 'console.log(window);\n', ['no-undef']],
    [
      'preload TS guards window assignment',
      'electron/preload.ts',
      'window = 1;\n',
      ['no-global-assign'],
    ],
    [
      'main TS guards window assignment',
      'electron/main/index.ts',
      'window = 1;\n',
      ['no-global-assign'],
    ],
    [
      'vitest config TS guards window assignment',
      'vitest.config.ts',
      'window = 1;\n',
      ['no-global-assign'],
    ],
  ])('%s', async (_label, filePath, source, expected) => {
    expect(await ruleIds(source, filePath)).toEqual(expected);
  });
});
