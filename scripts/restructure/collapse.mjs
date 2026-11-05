#!/usr/bin/env node
// Point imports and `vi.mock` calls that go through a re-exporting module at the modules that
// declare the names (restructure P4a and P4b, docs/architecture.md).
//
// Usage:
//   node collapse.mjs --repo <checkout> --modules <list> [--dry-run] [--report <file.json>]
//
// List: one repository path per line, each a module whose re-exports are bypassed (a barrel, or a
// module that re-exports a few names beside its own). Blank lines and `#` lines are skipped.
//
// A name's declaring module is the first module along its re-export chain that is not listed, so a
// re-export inside an unlisted module stays in use. In every file of tsconfig.json except the
// listed modules:
//   - `import { a, type B } from '<listed>'` becomes one import per declaring module, at the place
//     of the old one and in the order the listed module re-exports them; names the listed module
//     declares itself stay imported from it, first; `import type` stays type-only. When the file
//     already imports the declaring module earlier, with the same type-only form, the names join
//     that import instead (module evaluation order then stays as it was);
//   - `export { a } from '<listed>'` is split the same way;
//   - `vi.mock` and `vi.doMock` of a listed module with a factory that returns an object literal
//     (`() => ({ ... })`, or a block with only `return { ... }`) become one call per declaring
//     module with that module's properties. A first property `...(await importOriginal())` or
//     `...(await vi.importActual('<listed>'))` is kept in every new call, pointed at its module.
//     Without a factory (automock), every module the listed one re-exports is mocked;
//   - anything else that names a listed module (namespace imports, `export *`, `import()`,
//     `typeof import()`, `vi.importActual` elsewhere, other factory shapes, a property the module
//     does not export, a file that already mocks a declaring module) is a warning for a hand fix
//     and stays as it is.
// Edits are text edits; only the new statements are printed, with the repository's Prettier
// settings. Nothing is staged.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

const posix = path.posix;

function parseArgs(argv) {
  const opts = { dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`${arg} needs a value`);
      return argv[i];
    };
    if (arg === '--repo') opts.repo = value();
    else if (arg === '--modules') opts.modules = value();
    else if (arg === '--report') opts.report = value();
    else if (arg === '--dry-run') opts.dryRun = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!opts.repo || !opts.modules) {
    throw new Error(
      'usage: collapse.mjs --repo <checkout> --modules <list> [--dry-run] [--report <file>]'
    );
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const repo = path.resolve(opts.repo);
const requireHere = createRequire(path.join(repo, 'package.json'));
const ts = requireHere('typescript');
const prettier = requireHere('prettier');
const prettierOptions = {
  ...JSON.parse(fs.readFileSync(path.join(repo, '.prettierrc'), 'utf8')),
  parser: 'typescript',
};
const rel = (file) => path.relative(repo, file).split(path.sep).join('/');

const listed = new Set(
  fs
    .readFileSync(opts.modules, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const file = path.resolve(repo, line);
      if (!fs.existsSync(file)) throw new Error(`${line} does not exist`);
      return file;
    })
);

const parsed = ts.parseJsonConfigFileContent(
  ts.readConfigFile(path.join(repo, 'tsconfig.json'), ts.sys.readFile).config,
  ts.sys,
  repo
);
const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
const checker = program.getTypeChecker();
for (const file of listed) {
  if (!program.getSourceFile(file)) throw new Error(`${rel(file)} is not part of tsconfig.json`);
}

const resolutionCache = new Map();
const resolveSpecifier = (specifier, fromFile) => {
  const key = `${fromFile}\0${specifier}`;
  if (!resolutionCache.has(key)) {
    const result = ts.resolveModuleName(specifier, fromFile, parsed.options, ts.sys);
    const resolved = result.resolvedModule;
    resolutionCache.set(
      key,
      resolved && !resolved.isExternalLibraryImport
        ? path.resolve(resolved.resolvedFileName)
        : undefined
    );
  }
  return resolutionCache.get(key);
};

const moduleSymbolOf = (file) => checker.getSymbolAtLocation(program.getSourceFile(file));

// ---------------------------------------------------------------------------------------------
// Where each name of a listed module is declared
// ---------------------------------------------------------------------------------------------

// { file, name, order } for a name exported by a listed module: file is the declaring module (the
// listed module itself for its own declarations), name the name there, order the position of the
// providing statement along the chain (to keep the listed module's order). undefined: not exported.
const resolvedNames = new Map();
function resolveName(file, name, depth = 0) {
  const key = `${file}\0${name}`;
  if (resolvedNames.has(key)) return resolvedNames.get(key);
  if (depth > 20) throw new Error(`re-export chain too deep at ${rel(file)} ${name}`);
  const sf = program.getSourceFile(file);
  const moduleSymbol = moduleSymbolOf(file);
  const exported = moduleSymbol && checker.tryGetMemberInModuleExports(name, moduleSymbol);
  let result;
  if (!exported) {
    result = undefined;
  } else {
    const statements = sf.statements;
    const through = (statement, target, targetName) => {
      const index = statements.indexOf(statement);
      if (!target) return { unresolved: true };
      if (!listed.has(target)) return { file: target, name: targetName, order: [index] };
      const inner = resolveName(target, targetName, depth + 1);
      return inner && { ...inner, order: [index, ...(inner.order ?? [])] };
    };
    const ownDeclaration = exported.declarations?.find((d) => d.getSourceFile() === sf);
    if (ownDeclaration && ts.isExportSpecifier(ownDeclaration)) {
      const exportDeclaration = ownDeclaration.parent.parent;
      const sourceName = (ownDeclaration.propertyName ?? ownDeclaration.name).text;
      if (exportDeclaration.moduleSpecifier) {
        // export { a as b } from './x'
        const target = resolveSpecifier(exportDeclaration.moduleSpecifier.text, file);
        result = through(exportDeclaration, target, sourceName);
      } else {
        // import { a } from './x'; export { a as b };  or a local declaration exported by name
        const local = checker.getExportSpecifierLocalTargetSymbol(ownDeclaration);
        const importSpecifier = local?.declarations?.find(
          (d) => ts.isImportSpecifier(d) && d.getSourceFile() === sf
        );
        if (importSpecifier) {
          const importDeclaration = importSpecifier.parent.parent.parent;
          const target = resolveSpecifier(importDeclaration.moduleSpecifier.text, file);
          result = through(
            exportDeclaration,
            target,
            (importSpecifier.propertyName ?? importSpecifier.name).text
          );
        } else {
          result = { file, name, order: [statements.indexOf(exportDeclaration)] };
        }
      }
    } else if (ownDeclaration) {
      let statement = ownDeclaration;
      while (statement.parent !== sf) statement = statement.parent;
      result = { file, name, order: [statements.indexOf(statement)] };
    } else {
      // Through `export * from './x'`: the first such statement whose module exports the name.
      result = { unresolved: true };
      for (const statement of statements) {
        if (
          !ts.isExportDeclaration(statement) ||
          statement.exportClause ||
          !statement.moduleSpecifier
        ) {
          continue;
        }
        const target = resolveSpecifier(statement.moduleSpecifier.text, file);
        const targetSymbol = target && moduleSymbolOf(target);
        if (targetSymbol && checker.tryGetMemberInModuleExports(name, targetSymbol)) {
          result = through(statement, target, name);
          break;
        }
      }
    }
  }
  resolvedNames.set(key, result);
  return result;
}

// Every module a listed module re-exports, in its order (for automocks).
function reExportedModules(file, depth = 0) {
  const out = [];
  for (const statement of program.getSourceFile(file).statements) {
    if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier) continue;
    const target = resolveSpecifier(statement.moduleSpecifier.text, file);
    if (!target) continue;
    if (listed.has(target) && depth < 20) out.push(...reExportedModules(target, depth + 1));
    else out.push(target);
  }
  return [...new Set(out)];
}

const compareOrder = (a, b) => {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] === undefined) return -1;
    if (b[i] === undefined) return 1;
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
};

// ---------------------------------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------------------------------

const specifierFor = (fromFile, target) => {
  let spec = posix.relative(
    posix.dirname(fromFile.split(path.sep).join('/')),
    target.split(path.sep).join('/')
  );
  spec = spec.replace(/\.(d\.ts|tsx?|jsx?|mjs)$/, '').replace(/\/index$/, '');
  if (spec === 'index') spec = '.';
  return spec.startsWith('.') ? spec : `./${spec}`;
};

// Prettier output for statements written at the given indentation.
function format(code, indent) {
  const depth = indent.length / 2;
  if (!Number.isInteger(depth)) throw new Error(`odd indentation ${JSON.stringify(indent)}`);
  const wrapped = `${'{'.repeat(depth)}\n${code}\n${'}'.repeat(depth)}`;
  let out = prettier.format(wrapped, prettierOptions).trimEnd().split('\n');
  out = depth ? out.slice(depth, out.length - depth) : out;
  return out.join('\n').trimStart();
}

const indentOf = (sf, node) => {
  const lineStart = sf.text.lastIndexOf('\n', node.getStart(sf) - 1) + 1;
  return sf.text.slice(lineStart, node.getStart(sf)).match(/^\s*/)[0];
};

// ---------------------------------------------------------------------------------------------
// The pass over every file
// ---------------------------------------------------------------------------------------------

const warnings = [];
const report = { files: [], warnings };
const at = (sf, node) =>
  `${rel(sf.fileName)}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`;
const warn = (sf, node, text) => warnings.push(`${at(sf, node)}: ${text}`);
let importCount = 0;
let mockCount = 0;

const isVi = (expression, names) =>
  ts.isPropertyAccessExpression(expression) &&
  ts.isIdentifier(expression.expression) &&
  expression.expression.text === 'vi' &&
  names.includes(expression.name.text);

// The object literal a mock factory returns, with its shape, or a reason it has none.
function factoryObject(factory) {
  if (!ts.isArrowFunction(factory) && !ts.isFunctionExpression(factory))
    return { reason: 'factory is not a function' };
  let body = factory.body;
  if (ts.isBlock(body)) {
    if (body.statements.length !== 1 || !ts.isReturnStatement(body.statements[0])) {
      return { reason: 'factory body has statements besides one return' };
    }
    body = body.statements[0].expression;
  }
  while (body && ts.isParenthesizedExpression(body)) body = body.expression;
  if (!body || !ts.isObjectLiteralExpression(body))
    return { reason: 'factory does not return an object literal' };
  return { object: body };
}

// `...(await importOriginal())`, `...(await importOriginal<typeof import('x')>())`,
// `...(await vi.importActual('x'))`: the spread of the real module.
function actualSpread(property, factory) {
  if (!ts.isSpreadAssignment(property)) return false;
  let expression = property.expression;
  while (ts.isParenthesizedExpression(expression)) expression = expression.expression;
  if (!ts.isAwaitExpression(expression)) return false;
  let call = expression.expression;
  while (ts.isParenthesizedExpression(call)) call = call.expression;
  if (!ts.isCallExpression(call)) return false;
  const parameter = factory.parameters[0]?.name;
  if (ts.isIdentifier(call.expression) && parameter && ts.isIdentifier(parameter)) {
    return call.expression.text === parameter.text && call.arguments.length === 0;
  }
  return isVi(call.expression, ['importActual']) && call.arguments.length === 1;
}

const propertyName = (property) => {
  if (ts.isShorthandPropertyAssignment(property)) return property.name.text;
  if (
    (ts.isPropertyAssignment(property) ||
      ts.isMethodDeclaration(property) ||
      ts.isGetAccessor(property)) &&
    (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
  ) {
    return property.name.text;
  }
  return undefined;
};

// Replaces the module named in the spread of the real module (type argument and importActual).
const retargetSpread = (text, listedSpec, spec) =>
  text.split(`'${listedSpec}'`).join(`'${spec}'`).split(`"${listedSpec}"`).join(`'${spec}'`);

for (const sf of program.getSourceFiles()) {
  const file = path.resolve(sf.fileName);
  if (sf.isDeclarationFile || file.includes(`${path.sep}node_modules${path.sep}`)) continue;
  if (!file.startsWith(`${repo}${path.sep}`) || listed.has(file)) continue;
  const edits = [];
  const merges = new Map(); // earlier ImportDeclaration of a declaring module -> specifier texts
  const importsOf = new Map(); // resolved module -> its ImportDeclarations in this file
  const mockedModules = new Set();
  for (const statement of sf.statements) {
    if (ts.isImportDeclaration(statement)) {
      const target = resolveSpecifier(statement.moduleSpecifier.text, file);
      if (target) importsOf.set(target, [...(importsOf.get(target) ?? []), statement]);
    }
  }
  const visitMocks = (node) => {
    if (
      ts.isCallExpression(node) &&
      isVi(node.expression, ['mock', 'doMock']) &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      const target = resolveSpecifier(node.arguments[0].text, file);
      if (target) mockedModules.add(target);
    }
    ts.forEachChild(node, visitMocks);
  };
  visitMocks(sf);

  // Groups names by declaring module; returns [{ target, specifiers, order }] or undefined.
  const groupSpecifiers = (listedFile, elements, node) => {
    const groups = new Map();
    for (const element of elements) {
      const imported = (element.propertyName ?? element.name).text;
      const local = element.name.text;
      const resolved = resolveName(listedFile, imported);
      if (!resolved || resolved.unresolved) {
        warn(sf, node, `${imported} is not resolved through ${rel(listedFile)}`);
        return undefined;
      }
      const name = resolved.name === local ? local : `${resolved.name} as ${local}`;
      const text = `${element.isTypeOnly ? 'type ' : ''}${name}`;
      const ownName = resolved.file === listedFile;
      const group = groups.get(resolved.file) ?? {
        target: resolved.file,
        specifiers: [],
        order: ownName ? [-1] : resolved.order,
      };
      group.specifiers.push(text);
      if (!ownName && compareOrder(resolved.order, group.order) < 0) group.order = resolved.order;
      groups.set(resolved.file, group);
    }
    return [...groups.values()].sort((a, b) => compareOrder(a.order, b.order));
  };

  for (const statement of sf.statements) {
    if (
      ts.isImportDeclaration(statement) ||
      (ts.isExportDeclaration(statement) && statement.moduleSpecifier)
    ) {
      const listedFile = resolveSpecifier(statement.moduleSpecifier.text, file);
      if (!listedFile || !listed.has(listedFile)) continue;
      const isImport = ts.isImportDeclaration(statement);
      const clause = isImport ? statement.importClause : statement;
      const bindings = isImport ? clause?.namedBindings : statement.exportClause;
      if (
        !clause ||
        (isImport && clause.name) ||
        !bindings ||
        !(ts.isNamedImports(bindings) || ts.isNamedExports(bindings))
      ) {
        warn(
          sf,
          statement,
          `${isImport ? 'import' : 'export'} of ${rel(listedFile)} without named bindings`
        );
        continue;
      }
      const groups = groupSpecifiers(listedFile, bindings.elements, statement);
      if (!groups) continue;
      // Only names the listed module declares itself: nothing to change.
      if (groups.length === 1 && groups[0].target === listedFile) continue;
      const keyword = isImport ? 'import' : 'export';
      const typeOnly = clause.isTypeOnly ? ' type' : '';
      const lines = [];
      for (const group of groups) {
        const earlier =
          isImport && !listed.has(group.target)
            ? (importsOf.get(group.target) ?? []).find(
                (other) =>
                  other.end <= statement.getStart(sf) &&
                  other.importClause &&
                  !other.importClause.isTypeOnly === !clause.isTypeOnly &&
                  other.importClause.namedBindings &&
                  ts.isNamedImports(other.importClause.namedBindings)
              )
            : undefined;
        if (earlier) {
          merges.set(earlier, [...(merges.get(earlier) ?? []), ...group.specifiers]);
          continue;
        }
        const spec =
          group.target === listedFile
            ? statement.moduleSpecifier.text
            : specifierFor(file, group.target);
        lines.push(`${keyword}${typeOnly} { ${group.specifiers.join(', ')} } from '${spec}';`);
      }
      const indent = indentOf(sf, statement);
      edits.push({
        start: statement.getStart(sf),
        end: statement.getEnd(),
        text: lines.length ? format(lines.join('\n'), indent) : '',
      });
      if (!lines.length) {
        // The whole statement went into earlier imports: drop its line.
        const last = edits[edits.length - 1];
        if (sf.text[last.end] === '\n') last.end += 1;
      }
      importCount += 1;
    }
  }

  for (const [declaration, extra] of merges) {
    const clause = declaration.importClause;
    const current = clause.namedBindings.elements.map((element) => element.getText(sf));
    const head = clause.name ? `${clause.name.text}, ` : '';
    const text = `import${clause.isTypeOnly ? ' type' : ''} ${head}{ ${[...current, ...extra].join(
      ', '
    )} } from ${declaration.moduleSpecifier.getText(sf)};`;
    edits.push({
      start: declaration.getStart(sf),
      end: declaration.getEnd(),
      text: format(text, indentOf(sf, declaration)),
    });
  }

  const visit = (node) => {
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      const target = resolveSpecifier(node.argument.literal.text, file);
      if (target && listed.has(target)) warn(sf, node, `typeof import() of ${rel(target)}`);
    }
    if (ts.isCallExpression(node)) {
      const first = node.arguments[0];
      const spec = first && ts.isStringLiteralLike(first) ? first.text : undefined;
      const target = spec && resolveSpecifier(spec, file);
      if (target && listed.has(target)) {
        if (isVi(node.expression, ['mock', 'doMock']) && ts.isExpressionStatement(node.parent)) {
          const done = splitMock(node, target, spec);
          if (done) return;
        } else if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          if (!repointDynamicImport(node, target)) warn(sf, node, `import() of ${rel(target)}`);
        } else if (
          ts.isPropertyAccessExpression(node.expression) ||
          ts.isIdentifier(node.expression)
        ) {
          warn(sf, node, `${node.expression.getText(sf)}() of ${rel(target)}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  // `const { a, b } = await import('<listed>')` whose names all come from one module.
  const repointDynamicImport = (call, listedFile) => {
    const awaited = call.parent;
    const declaration = awaited && ts.isAwaitExpression(awaited) ? awaited.parent : undefined;
    if (
      !declaration ||
      !ts.isVariableDeclaration(declaration) ||
      !ts.isObjectBindingPattern(declaration.name)
    ) {
      return false;
    }
    const targets = new Set();
    for (const element of declaration.name.elements) {
      const name = element.propertyName ?? element.name;
      if (element.dotDotDotToken || !ts.isIdentifier(name)) return false;
      const resolved = resolveName(listedFile, name.text);
      if (!resolved || resolved.unresolved || resolved.name !== name.text) return false;
      targets.add(resolved.file);
    }
    if (targets.size !== 1) return false;
    const [target] = targets;
    if (target === listedFile) return true;
    const literal = call.arguments[0];
    edits.push({
      start: literal.getStart(sf),
      end: literal.getEnd(),
      text: `'${specifierFor(file, target)}'`,
    });
    importCount += 1;
    return true;
  };

  const splitMock = (call, listedFile, listedSpec) => {
    const factory = call.arguments[1];
    const statement = call.parent;
    const indent = indentOf(sf, statement);
    const callee = call.expression.getText(sf);
    if (call.arguments.length > 2) {
      warn(sf, call, `${callee} of ${rel(listedFile)} with options`);
      return false;
    }
    if (!factory) {
      const targets = reExportedModules(listedFile);
      const lines = targets.map((target) => `${callee}('${specifierFor(file, target)}');`);
      if (targets.some((target) => mockedModules.has(target))) {
        warn(sf, call, `automock of ${rel(listedFile)}: the file already mocks one of its modules`);
        return false;
      }
      edits.push({
        start: statement.getStart(sf),
        end: statement.getEnd(),
        text: format(lines.join('\n'), indent),
      });
      mockCount += 1;
      return true;
    }
    const { object, reason } = factoryObject(factory);
    if (!object) {
      warn(sf, call, `${callee} of ${rel(listedFile)}: ${reason}`);
      return false;
    }
    const properties = [...object.properties];
    const spread =
      properties[0] && actualSpread(properties[0], factory) ? properties.shift() : undefined;
    const groups = new Map();
    for (const property of properties) {
      const name = propertyName(property);
      const resolved = name && resolveName(listedFile, name);
      if (!resolved || resolved.unresolved) {
        warn(
          sf,
          property,
          `${callee} of ${rel(listedFile)}: property ${
            name ?? property.getText(sf).slice(0, 40)
          } is not an export it resolves`
        );
        return false;
      }
      const ownName = resolved.file === listedFile;
      const group = groups.get(resolved.file) ?? {
        target: resolved.file,
        properties: [],
        order: ownName ? [-1] : resolved.order,
      };
      if (resolved.name !== name) {
        warn(
          sf,
          property,
          `${callee} of ${rel(listedFile)}: property ${name} is ${resolved.name} in its module`
        );
        return false;
      }
      const text = sf.text
        .slice(property.getFullStart(), property.getEnd())
        .replace(/^\s*\n/, '')
        .trim();
      group.properties.push(text);
      if (!ownName && compareOrder(resolved.order, group.order) < 0) group.order = resolved.order;
      groups.set(resolved.file, group);
    }
    if (!groups.size) {
      warn(sf, call, `${callee} of ${rel(listedFile)} overrides nothing`);
      return false;
    }
    const sorted = [...groups.values()].sort((a, b) => compareOrder(a.order, b.order));
    if (sorted.length === 1 && sorted[0].target === listedFile) return true;
    if (sorted.some((group) => group.target !== listedFile && mockedModules.has(group.target))) {
      warn(sf, call, `${callee} of ${rel(listedFile)}: the file already mocks a declaring module`);
      return false;
    }
    const before = sf.text.slice(factory.getStart(sf), object.getStart(sf));
    const after = sf.text.slice(object.getEnd(), factory.getEnd());
    // Prettier keeps an object expanded when its first property starts on a new line.
    const multiline = /^\{[ \t]*\n/.test(object.getText(sf));
    const lines = sorted.map((group) => {
      const spec = group.target === listedFile ? listedSpec : specifierFor(file, group.target);
      const members = [
        ...(spread ? [retargetSpread(spread.getText(sf), listedSpec, spec)] : []),
        ...group.properties,
      ];
      const body = multiline ? `{\n${members.join(',\n')},\n}` : `{ ${members.join(', ')} }`;
      return `${callee}('${spec}', ${retargetSpread(before, listedSpec, spec)}${body}${after});`;
    });
    edits.push({
      start: statement.getStart(sf),
      end: statement.getEnd(),
      text: format(lines.join('\n'), indent),
    });
    mockCount += 1;
    return true;
  };

  ts.forEachChild(sf, visit);

  if (!edits.length) continue;
  edits.sort((a, b) => b.start - a.start);
  for (let i = 1; i < edits.length; i += 1) {
    if (edits[i].end > edits[i - 1].start) throw new Error(`${rel(file)}: overlapping edits`);
  }
  let text = sf.text;
  for (const edit of edits) text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  report.files.push({ file: rel(file), edits: edits.length });
  if (!opts.dryRun) fs.writeFileSync(file, text);
}

console.log(
  `collapse: ${
    report.files.length
  } files, ${importCount} import or export statements, ${mockCount} mocks${
    opts.dryRun ? ' (dry run)' : ''
  }`
);
for (const line of warnings) console.log(`collapse: warning: ${line}`);
if (opts.report) fs.writeFileSync(opts.report, `${JSON.stringify(report, null, 2)}\n`);
