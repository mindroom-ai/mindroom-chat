import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The release tooling and its READMEs call `npm run <script>`; each one must exist in package.json,
// or fastlane, Xcode Cloud or a person following the README stops at "Missing script".
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const packageScripts = new Set(
  Object.keys(JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).scripts)
);

const filesIn = (directory: string, pattern: RegExp) =>
  readdirSync(join(repoRoot, directory))
    .filter((name) => pattern.test(name))
    .map((name) => join(directory, name));

const callers = [
  'ios/App/fastlane/Fastfile',
  'ios/App/fastlane/screenshots/README.md',
  ...filesIn('ios/App/ci_scripts', /\.sh$/),
  ...filesIn('scripts', /\.sh$/),
];

const namedScripts = (path: string) =>
  [
    ...readFileSync(join(repoRoot, path), 'utf8').matchAll(/\bnpm (?:run ([\w:.-]+)|(test)\b)/g),
  ].flatMap((match) => match[1] ?? match[2] ?? []);

describe('npm scripts named by the release tooling', () => {
  it('finds the App Store commands the screenshot README names', () => {
    expect(namedScripts('ios/App/fastlane/screenshots/README.md')).toEqual(
      expect.arrayContaining(['appstore:screenshots', 'appstore:fixture'])
    );
  });

  it.each(callers)('%s names only scripts that package.json defines', (path) => {
    expect(namedScripts(path).filter((name) => !packageScripts.has(name))).toEqual([]);
  });
});
