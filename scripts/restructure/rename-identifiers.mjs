#!/usr/bin/env node
// Rename identifiers across the repository with the TypeScript language service (restructure P4c,
// docs/architecture.md "Placement and naming").
//
// Usage:
//   node rename-identifiers.mjs --repo <checkout> --table <renames.tsv> [--keep-lane-p-names]
//                               [--dry-run] [--report <file.json>]
//
// Table: tab-separated rows `file<TAB>old<TAB>new`, the file being the one that declares `old`
// (a repository path); blank lines and `#` lines are skipped. Every declaration named `old` in
// that file is renamed with all its references in the files of tsconfig.json, as the language
// service finds them; a shorthand property keeps its key (`{ old }` becomes `{ old: renamed }`).
//
// Beyond the language service:
//   - `vi.mock` and `vi.doMock` factories of the declaring module: object literal keys named
//     `old` become `new` (a shorthand `{ old }` becomes `{ new: old }`, or `{ new }` when its
//     value is renamed too);
//   - `vi.spyOn(<namespace import of the declaring module>, 'old')`: the string becomes 'new';
//   - `import { new as new }` and `export { new as new }` left by a rename become `{ new }`;
//   - every other string or template literal that contains `old` as a word is printed for review.
//
// --keep-lane-p-names: Lane P files (scripts/provenance-paths.cjs) keep their own names. Their
// imports of a renamed export become `import { new as old }`, and only the places that name the
// declaring module's export itself change there (import and export specifiers, destructured
// `import()` names, `module.old`, `typeof import('...').old`, mock keys).
//
// Edits are text edits; nothing is staged.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

function parseArgs(argv) {
  const opts = { dryRun: false, keepLanePNames: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`${arg} needs a value`);
      return argv[i];
    };
    if (arg === '--repo') opts.repo = value();
    else if (arg === '--table') opts.table = value();
    else if (arg === '--report') opts.report = value();
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--keep-lane-p-names') opts.keepLanePNames = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!opts.repo || !opts.table) {
    throw new Error(
      'usage: rename-identifiers.mjs --repo <checkout> --table <renames.tsv> [options]'
    );
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const repo = path.resolve(opts.repo);
const requireHere = createRequire(path.join(repo, 'package.json'));
const ts = requireHere('typescript');
const { lanePPaths } = requireHere(path.join(repo, 'scripts/provenance-paths.cjs'));
const rel = (file) => path.relative(repo, file).split(path.sep).join('/');
const laneP = lanePPaths(repo);
const isLaneP = (file) => laneP.has(rel(file));

const rows = fs
  .readFileSync(opts.table, 'utf8')
  .split('\n')
  .map((line) => line.replace(/\r$/, ''))
  .filter((line) => line.trim() && !line.startsWith('#'))
  .map((line, index) => {
    const [file, from, to] = line.split('\t');
    if (!file || !from || !to) throw new Error(`table row ${index + 1}: expected file, old, new`);
    if (!/^[A-Za-z_$][\w$]*$/.test(to))
      throw new Error(`table row ${index + 1}: ${to} is no identifier`);
    return { file: path.resolve(repo, file), from, to };
  });

const parsed = ts.parseJsonConfigFileContent(
  ts.readConfigFile(path.join(repo, 'tsconfig.json'), ts.sys.readFile).config,
  ts.sys,
  repo
);
const host = {
  getScriptFileNames: () => parsed.fileNames,
  getScriptVersion: () => '0',
  getScriptSnapshot: (file) =>
    fs.existsSync(file) ? ts.ScriptSnapshot.fromString(fs.readFileSync(file, 'utf8')) : undefined,
  getCurrentDirectory: () => repo,
  getCompilationSettings: () => parsed.options,
  getDefaultLibFileName: ts.getDefaultLibFilePath,
  fileExists: ts.sys.fileExists,
  readFile: ts.sys.readFile,
  readDirectory: ts.sys.readDirectory,
  directoryExists: ts.sys.directoryExists,
  getDirectories: ts.sys.getDirectories,
};
const service = ts.createLanguageService(host, ts.createDocumentRegistry());
const program = service.getProgram();

const resolveSpecifier = (specifier, fromFile) => {
  const resolved = ts.resolveModuleName(specifier, fromFile, parsed.options, ts.sys).resolvedModule;
  return resolved && !resolved.isExternalLibraryImport
    ? path.resolve(resolved.resolvedFileName)
    : undefined;
};

// The innermost identifier that starts at a position.
function identifierAt(sf, position) {
  let found;
  const visit = (node) => {
    if (position < node.getStart(sf) || position >= node.getEnd()) return;
    if (ts.isIdentifier(node) && node.getStart(sf) === position) found = node;
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

const declarationNames = (sf, name) => {
  const out = [];
  const visit = (node) => {
    if (
      (ts.isVariableDeclaration(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isEnumDeclaration(node) ||
        ts.isParameter(node) ||
        ts.isBindingElement(node)) &&
      node.name &&
      ts.isIdentifier(node.name) &&
      node.name.text === name
    ) {
      out.push(node.name);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
};

// ---------------------------------------------------------------------------------------------
// Edits: file -> Map(start -> { end, text, row })
// ---------------------------------------------------------------------------------------------

const edits = new Map();
const warnings = [];
const notes = [];
const at = (file, position) => {
  const sf = program.getSourceFile(file);
  return `${rel(file)}:${sf.getLineAndCharacterOfPosition(position).line + 1}`;
};
const addEdit = (file, start, end, text, row) => {
  if (!edits.has(file)) edits.set(file, new Map());
  const fileEdits = edits.get(file);
  const existing = fileEdits.get(start);
  if (existing && (existing.end !== end || existing.text !== text)) {
    throw new Error(
      `${at(file, start)}: two renames edit the same name (${existing.text}, ${text})`
    );
  }
  fileEdits.set(start, { end, text, row });
};

// Names each file's mocks of the declaring modules use, renamed by the mock pass.
const renamedExports = new Map(); // declaring file -> Map(old -> new)
let locationCount = 0;

for (const row of rows) {
  const sf = program.getSourceFile(row.file);
  if (!sf) throw new Error(`${rel(row.file)} is not part of tsconfig.json`);
  const declarations = declarationNames(sf, row.from);
  if (!declarations.length) throw new Error(`${rel(row.file)} declares no ${row.from}`);
  for (const declaration of declarations) {
    let statement = declaration;
    while (statement.parent && statement.parent !== sf) statement = statement.parent;
    const exported =
      (statement.parent === sf &&
        Boolean(
          statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
        )) ||
      sf.statements.some(
        (other) =>
          ts.isExportDeclaration(other) &&
          !other.moduleSpecifier &&
          other.exportClause &&
          ts.isNamedExports(other.exportClause) &&
          other.exportClause.elements.some(
            (element) => (element.propertyName ?? element.name).text === row.from
          )
      );
    if (exported) {
      if (!renamedExports.has(row.file)) renamedExports.set(row.file, new Map());
      renamedExports.get(row.file).set(row.from, row.to);
    }
    const locations =
      service.findRenameLocations(row.file, declaration.getStart(sf), false, false, {
        providePrefixAndSuffixTextForRename: true,
      }) ?? [];
    for (const location of locations) {
      const file = path.resolve(location.fileName);
      const start = location.textSpan.start;
      const end = start + location.textSpan.length;
      locationCount += 1;
      const prefix = location.prefixText ?? '';
      const suffix = location.suffixText ?? '';
      if (!(opts.keepLanePNames && isLaneP(file) && file !== row.file)) {
        addEdit(file, start, end, `${prefix}${row.to}${suffix}`, row);
        continue;
      }
      // A Lane P file that keeps its names: change only what names the export itself.
      const locationFile = program.getSourceFile(file);
      const node = identifierAt(locationFile, start);
      const parent = node?.parent;
      if (!node) {
        warnings.push(`${at(file, start)}: no identifier at a rename location of ${row.from}`);
      } else if (
        (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) &&
        parent.propertyName === node
      ) {
        addEdit(file, start, end, row.to, row);
      } else if (
        (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) &&
        !parent.propertyName
      ) {
        addEdit(file, start, end, `${row.to} as ${row.from}`, row);
      } else if (ts.isBindingElement(parent) && parent.propertyName === node) {
        addEdit(file, start, end, row.to, row);
      } else if (
        ts.isBindingElement(parent) &&
        !parent.propertyName &&
        ts.isObjectBindingPattern(parent.parent)
      ) {
        addEdit(file, start, end, `${row.to}: ${row.from}`, row);
      } else if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
        addEdit(file, start, end, row.to, row);
      } else if (ts.isQualifiedName(parent) || ts.isImportTypeNode(parent)) {
        addEdit(file, start, end, row.to, row);
      }
      // Anything else uses the file's own name for the import and stays.
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Mock keys, spyOn names, string mentions
// ---------------------------------------------------------------------------------------------

const isVi = (expression, names) =>
  ts.isPropertyAccessExpression(expression) &&
  ts.isIdentifier(expression.expression) &&
  expression.expression.text === 'vi' &&
  names.includes(expression.name.text);

const returnedObjects = (factory) => {
  const out = [];
  if (!ts.isArrowFunction(factory) && !ts.isFunctionExpression(factory)) return out;
  const unwrap = (expression) => {
    let current = expression;
    while (current && ts.isParenthesizedExpression(current)) current = current.expression;
    return current && ts.isObjectLiteralExpression(current) ? current : undefined;
  };
  if (!ts.isBlock(factory.body)) {
    const object = unwrap(factory.body);
    if (object) out.push(object);
    return out;
  }
  const visit = (node) => {
    if (ts.isFunctionLike(node) && node !== factory) return;
    if (ts.isReturnStatement(node)) {
      const object = unwrap(node.expression);
      if (object) out.push(object);
    }
    ts.forEachChild(node, visit);
  };
  visit(factory.body);
  return out;
};

const allOldNames = new Map(); // old -> new (for string mentions)
for (const row of rows) allOldNames.set(row.from, row.to);
const wordPattern = new RegExp(
  `\\b(${[...allOldNames.keys()].map((name) => name.replace(/\$/g, '\\$')).join('|')})\\b`
);

for (const sf of program.getSourceFiles()) {
  const file = path.resolve(sf.fileName);
  if (
    sf.isDeclarationFile ||
    !file.startsWith(`${repo}${path.sep}`) ||
    file.includes(`${path.sep}node_modules${path.sep}`)
  ) {
    continue;
  }
  const namespaceImports = new Map(); // local namespace name -> module file
  for (const statement of sf.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      statement.importClause?.namedBindings &&
      ts.isNamespaceImport(statement.importClause.namedBindings)
    ) {
      const target = resolveSpecifier(statement.moduleSpecifier.text, file);
      if (target) namespaceImports.set(statement.importClause.namedBindings.name.text, target);
    }
  }
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      isVi(node.expression, ['mock', 'doMock']) &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      node.arguments[1]
    ) {
      const target = resolveSpecifier(node.arguments[0].text, file);
      const renames = target && renamedExports.get(target);
      if (renames) {
        for (const object of returnedObjects(node.arguments[1])) {
          for (const property of object.properties) {
            const name = property.name;
            if (
              !name ||
              !(ts.isIdentifier(name) || ts.isStringLiteral(name)) ||
              !renames.has(name.text)
            )
              continue;
            const to = renames.get(name.text);
            const start = name.getStart(sf);
            if (ts.isShorthandPropertyAssignment(property)) {
              // The language service may already have renamed the value (keeping the key).
              const existing = edits.get(file)?.get(start);
              const value = existing ? existing.text.replace(/^.*:\s*/, '') : name.text;
              if (existing) edits.get(file).delete(start);
              addEdit(file, start, name.getEnd(), value === to ? to : `${to}: ${value}`, {
                from: name.text,
                to,
              });
            } else {
              addEdit(file, start, name.getEnd(), ts.isStringLiteral(name) ? `'${to}'` : to, {
                from: name.text,
                to,
              });
            }
          }
        }
      }
    }
    if (
      ts.isCallExpression(node) &&
      isVi(node.expression, ['spyOn']) &&
      node.arguments.length >= 2 &&
      ts.isIdentifier(node.arguments[0]) &&
      ts.isStringLiteralLike(node.arguments[1])
    ) {
      const target = namespaceImports.get(node.arguments[0].text);
      const to = target && renamedExports.get(target)?.get(node.arguments[1].text);
      if (to) {
        const literal = node.arguments[1];
        addEdit(file, literal.getStart(sf), literal.getEnd(), `'${to}'`, {
          from: literal.text,
          to,
        });
        return;
      }
    }
    if (
      (ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)) &&
      !ts.isImportDeclaration(node.parent) &&
      !ts.isExportDeclaration(node.parent)
    ) {
      const match = wordPattern.exec(node.text);
      if (match && !edits.get(file)?.has(node.getStart(sf))) {
        notes.push(
          `${at(file, node.getStart(sf))}: string mentions ${match[1]}: ${JSON.stringify(
            node.text.slice(0, 100)
          )}`
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

// ---------------------------------------------------------------------------------------------
// Apply, then collapse `{ x as x }`
// ---------------------------------------------------------------------------------------------

const report = { rows: rows.length, locations: locationCount, files: [], warnings, notes };
for (const [file, fileEdits] of edits) {
  const sorted = [...fileEdits]
    .map(([start, edit]) => ({ start, ...edit }))
    .sort((a, b) => b.start - a.start);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].end > sorted[i - 1].start)
      throw new Error(`${at(file, sorted[i].start)}: overlapping edits`);
  }
  let text = fs.readFileSync(file, 'utf8');
  for (const edit of sorted) text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  const after = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const collapses = [];
  const visit = (node) => {
    if (
      (ts.isImportSpecifier(node) || ts.isExportSpecifier(node)) &&
      node.propertyName &&
      node.propertyName.text === node.name.text
    ) {
      collapses.push({
        start: node.propertyName.getStart(after),
        end: node.name.getEnd(),
        text: node.name.text,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(after);
  for (const collapse of collapses.sort((a, b) => b.start - a.start)) {
    text = text.slice(0, collapse.start) + collapse.text + text.slice(collapse.end);
  }
  report.files.push({ file: rel(file), edits: sorted.length, collapsed: collapses.length });
  if (!opts.dryRun) fs.writeFileSync(file, text);
}

console.log(
  `rename: ${rows.length} rows, ${locationCount} locations, ${edits.size} files${
    opts.dryRun ? ' (dry run)' : ''
  }`
);
for (const line of warnings) console.log(`rename: warning: ${line}`);
for (const line of notes) console.log(`rename: note: ${line}`);
if (opts.report) fs.writeFileSync(opts.report, `${JSON.stringify(report, null, 2)}\n`);
