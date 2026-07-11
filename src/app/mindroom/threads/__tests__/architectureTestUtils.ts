import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

export const APP_ROOT = resolve(TEST_DIR, '../../..');
export const MINDROOM_ROOT = resolve(APP_ROOT, 'mindroom');
export const REPO_ROOT = resolve(APP_ROOT, '../..');

export const appFile = (relativePath: string): string => resolve(APP_ROOT, relativePath);
export const mindroomFile = (relativePath: string): string => resolve(MINDROOM_ROOT, relativePath);
export const repoFile = (relativePath: string): string => resolve(REPO_ROOT, relativePath);

export const pathExists = (path: string): boolean => existsSync(path);
export const readSource = (path: string): string => readFileSync(path, 'utf8');

const parseSourceFile = (path: string): ts.SourceFile =>
  ts.createSourceFile(
    path,
    readSource(path),
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );

export const moduleSpecifiers = (path: string): string[] => {
  const sourceFile = parseSourceFile(path);
  const specifiers: string[] = [];

  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }

    if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      specifiers.push(node.arguments[0].text);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return specifiers;
};

export const isReExportOnlyModule = (path: string): boolean => {
  const sourceFile = parseSourceFile(path);
  return (
    sourceFile.statements.length > 0 &&
    sourceFile.statements.every(
      (statement) =>
        ts.isExportDeclaration(statement) &&
        statement.moduleSpecifier !== undefined &&
        ts.isStringLiteral(statement.moduleSpecifier)
    )
  );
};

const resolveRelativeModule = (fromFile: string, specifier: string): string | undefined => {
  if (!specifier.startsWith('.')) return undefined;

  const base = resolve(dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    resolve(base, 'index.ts'),
    resolve(base, 'index.tsx'),
  ];

  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
};

export const resolvedDependencies = (path: string): Set<string> =>
  new Set(
    moduleSpecifiers(path)
      .map((specifier) => resolveRelativeModule(path, specifier))
      .filter((dependency): dependency is string => dependency !== undefined)
  );

export const calledMemberNames = (path: string): Set<string> => {
  const sourceFile = parseSourceFile(path);
  const names = new Set<string>();

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression)) names.add(node.expression.text);
      if (ts.isPropertyAccessExpression(node.expression)) names.add(node.expression.name.text);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return names;
};

export const walkProductionSources = (root: string): string[] => {
  const files: string[] = [];

  const visit = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const path = resolve(directory, entry);
      const stats = statSync(path);
      if (stats.isDirectory()) {
        if (entry === '__tests__' || entry === 'test-utils') continue;
        visit(path);
        continue;
      }
      if (
        !/\.(ts|tsx)$/.test(entry) ||
        /\.test\.(ts|tsx)$/.test(entry) ||
        entry.endsWith('.d.ts')
      ) {
        continue;
      }
      files.push(path);
    }
  };

  visit(root);
  return files;
};

export const appRelativePath = (path: string): string =>
  relative(APP_ROOT, path).replace(/\\/g, '/');
