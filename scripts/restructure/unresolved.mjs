#!/usr/bin/env node
// Lists relative module specifiers (imports, import(), typeof import(), vi.* paths, require) that
// resolve to no tracked file, the way move.mjs resolves them. Usage: node unresolved.mjs <checkout>
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const repo = path.resolve(process.argv[2] ?? '.');
const ts = createRequire(path.join(repo, 'package.json'))('typescript');
const tracked = new Set(execFileSync('git', ['-C', repo, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1 << 30 }).split('\0').filter(Boolean));
const EXTS = ['.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mjs', '.cjs', '.json'];
const exists = (p) => tracked.has(p) || (fs.existsSync(path.join(repo, p)) && fs.statSync(path.join(repo, p)).isFile());
const resolves = (from, spec) => {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec.split('?')[0]));
  return exists(base) || EXTS.some((ext) => exists(base + ext) || exists(`${base}/index${ext}`)) ||
    (/\.jsx?$/.test(base) && ['.ts', '.tsx'].some((ext) => exists(base.replace(/\.jsx?$/, ext))));
};
for (const file of [...tracked].filter((f) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f) && !f.startsWith('docs/'))) {
  const sf = ts.createSourceFile(file, fs.readFileSync(path.join(repo, file), 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const check = (kind, node) => {
    if (!node || !(ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) return;
    const spec = node.text;
    if (!(spec.startsWith('./') || spec.startsWith('../') || spec === '.' || spec === '..')) return;
    if (!resolves(file, spec)) console.log(`${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}\t${kind}\t${spec}`);
  };
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) check('import', node.moduleSpecifier);
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) check('typeof import()', node.argument.literal);
    else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword) check('import()', node.arguments[0]);
      else if (ts.isIdentifier(callee) && callee.text === 'require') check('require', node.arguments[0]);
      else if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'vi') check(`vi.${callee.name.text}`, node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}
