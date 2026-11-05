import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT, readSource } from './architecture';

// A `vi.mock` of a path that resolves to no file does nothing and fails nothing: the test keeps
// passing against the real module. After a move this check lists every such path.
const VI_PATH_CALLS = new Set([
  'mock',
  'doMock',
  'unmock',
  'doUnmock',
  'importActual',
  'importMock',
]);
const RELATIVE_VI_PATH = /\bvi\.\w+\(\s*['"`]\./;
const EXTENSIONS = ['', '.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mjs', '.cjs', '.json'];

const isFile = (path: string): boolean =>
  statSync(path, { throwIfNoEntry: false })?.isFile() === true;

const resolvesToFile = (fromFile: string, specifier: string, exists: (path: string) => boolean) => {
  const base = resolve(dirname(fromFile), specifier.replace(/\?.*$/, ''));
  const bases = /\.jsx?$/.test(base) ? [base, base.replace(/\.jsx?$/, '')] : [base];
  return bases.some((candidate) =>
    EXTENSIONS.some(
      (extension) => exists(candidate + extension) || exists(join(candidate, `index${extension}`))
    )
  );
};

/** The relative `vi.*` module paths in `source` that resolve to no file, as `line: call(path)`. */
const staleMockPaths = (
  fileName: string,
  source: string,
  exists: (path: string) => boolean = isFile
): string[] => {
  const kind = fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const stale: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'vi' &&
      VI_PATH_CALLS.has(node.expression.name.text)
    ) {
      const [first] = node.arguments;
      if (
        first &&
        (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)) &&
        first.text.startsWith('.') &&
        !resolvesToFile(fileName, first.text, exists)
      ) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(first.getStart(sourceFile));
        stale.push(`${line + 1}: vi.${node.expression.name.text}('${first.text}')`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return stale;
};

// Only files with a relative path in some `vi.*(` call are parsed, which keeps the walk fast.
const sourcesWithRelativeViPaths = (root: string): { path: string; source: string }[] =>
  readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((path) => /\.(ts|tsx|js|jsx|mjs)$/.test(path))
    .map((path) => ({ path: join(root, path), source: readSource(join(root, path)) }))
    .filter(({ source }) => RELATIVE_VI_PATH.test(source));

describe('vi.* module paths', () => {
  it('reports a mocked relative path that resolves to no file', () => {
    const probe = resolve(REPO_ROOT, 'src/test/probe.test.ts');
    const source = [
      "vi.mock('./architecture', () => ({}));",
      "vi.mock('./architecture.js');",
      "vi.doMock('./movedAway', () => ({}));",
      "await vi.importActual<typeof import('../app/gone')>('../app/gone');",
      "vi.mock('vitest');",
      "vi.mock('../app');",
      "// vi.mock('./inAComment');",
    ].join('\n');

    expect(staleMockPaths(probe, source)).toEqual([
      "3: vi.doMock('./movedAway')",
      "4: vi.importActual('../app/gone')",
      "6: vi.mock('../app')",
    ]);
  });

  it('finds none in the source tree', () => {
    const stale = sourcesWithRelativeViPaths(resolve(REPO_ROOT, 'src')).flatMap(
      ({ path, source }) =>
        staleMockPaths(path, source).map((entry) => `${relative(REPO_ROOT, path)}:${entry}`)
    );

    expect(stale).toEqual([]);
  });
});
