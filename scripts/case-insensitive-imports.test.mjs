import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const MODULE_EXTENSION_RE = /\.(?:[cm]?[jt]sx?)$/;

// A folder's index module is imported by the folder's path.
const importPath = (file) => file.replace(MODULE_EXTENSION_RE, '').replace(/\/index$/, '');

// macOS builds (Xcode Cloud) resolve extensionless imports on a case-insensitive disk, so
// `./Foo` can pick `foo.ts` or `foo/index.ts` over `Foo.tsx` there while Linux CI resolves it correctly.
const ambiguousImports = (files) => {
  const modulesByImportPath = new Map();
  for (const file of files.filter((name) => MODULE_EXTENSION_RE.test(name))) {
    const key = importPath(file).toLowerCase();
    modulesByImportPath.set(key, [...(modulesByImportPath.get(key) ?? []), file]);
  }
  return [...modulesByImportPath.values()].filter(
    (modules) => new Set(modules.map(importPath)).size > 1
  );
};

test('flags modules whose import paths differ only by letter case', () => {
  assert.deepEqual(ambiguousImports(['a/Bar.tsx', 'a/bar.ts']), [['a/Bar.tsx', 'a/bar.ts']]);
  assert.deepEqual(ambiguousImports(['a/Dir.tsx', 'a/dir/index.ts']), [
    ['a/Dir.tsx', 'a/dir/index.ts'],
  ]);
  assert.deepEqual(
    ambiguousImports(['a/Foo.tsx', 'a/foo.css.ts', 'b/foo.ts', 'b/foo.test.ts', 'b/foo/index.ts']),
    []
  );
});

test('no two modules in src differ only by letter case once the extension is dropped', () => {
  const files = execFileSync('git', ['ls-files', '-z', 'src'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).split('\0');
  assert.deepEqual(ambiguousImports(files), []);
});
