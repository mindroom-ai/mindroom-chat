import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const MODULE_EXTENSION_RE = /\.(?:[cm]?[jt]sx?)$/;

// macOS builds (Xcode Cloud) resolve extensionless imports on a case-insensitive disk, so
// `./Foo` can pick `foo.ts` over `Foo.tsx` there while Linux CI resolves it correctly.
test('no two modules differ only by letter case once the extension is dropped', () => {
  const modulesByImportPath = new Map();
  const files = execFileSync('git', ['ls-files', '-z', 'src'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\0')
    .filter((file) => MODULE_EXTENSION_RE.test(file));
  for (const file of files) {
    const importPath = file.replace(MODULE_EXTENSION_RE, '').toLowerCase();
    modulesByImportPath.set(importPath, [...(modulesByImportPath.get(importPath) ?? []), file]);
  }
  const ambiguous = [...modulesByImportPath.values()].filter(
    (modules) => new Set(modules.map((file) => file.replace(MODULE_EXTENSION_RE, ''))).size > 1
  );
  assert.deepEqual(ambiguous, []);
});
