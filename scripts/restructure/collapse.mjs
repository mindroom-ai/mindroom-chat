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

// Whether a module provides a name at run time: a value, not re-exported through `export type`.
function isRuntimeExport(file, name) {
  const symbol = checker.tryGetMemberInModuleExports(name, moduleSymbolOf(file));
  if (!symbol) return false;
  // Resolving the alias first records whether a type-only re-export is on its way.
  const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  if (checker.getTypeOnlyAliasDeclaration(symbol)) return false;
  return Boolean(target.flags & ts.SymbolFlags.Value);
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
const report = { files: [], warnings, droppedKeys: [], noOpMocks: [] };
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

// What a mock factory returns: the object literal, the statements before its `return` (a block
// body), and where the body starts; or a reason it has no such shape.
function factoryShape(factory) {
  if (!ts.isArrowFunction(factory) && !ts.isFunctionExpression(factory)) {
    return { reason: 'factory is not a function' };
  }
  let body = factory.body;
  let prelude = [];
  if (ts.isBlock(body)) {
    const last = body.statements[body.statements.length - 1];
    if (!last || !ts.isReturnStatement(last))
      return { reason: 'factory body does not end in a return' };
    prelude = body.statements.slice(0, -1);
    if (prelude.some((statement) => ts.isReturnStatement(statement))) {
      return { reason: 'factory body returns early' };
    }
    body = last.expression;
  }
  while (body && ts.isParenthesizedExpression(body)) body = body.expression;
  if (!body || !ts.isObjectLiteralExpression(body)) {
    return { reason: 'factory does not return an object literal' };
  }
  return { object: body, prelude };
}

// The module whose real exports a spread property copies: `...(await importOriginal())` (the
// mocked module itself, returned as null), `...(await vi.importActual('x'))`, `...(await
// import('x'))`; undefined for any other spread.
function spreadModule(property, factory, fromFile) {
  let expression = property.expression;
  while (ts.isParenthesizedExpression(expression)) expression = expression.expression;
  if (!ts.isAwaitExpression(expression)) return undefined;
  let call = expression.expression;
  while (ts.isParenthesizedExpression(call)) call = call.expression;
  if (!ts.isCallExpression(call)) return undefined;
  const parameter = factory.parameters[0]?.name;
  if (ts.isIdentifier(call.expression) && parameter && ts.isIdentifier(parameter)) {
    return call.expression.text === parameter.text && call.arguments.length === 0
      ? null
      : undefined;
  }
  const argument = call.arguments[0];
  if (call.arguments.length !== 1 || !ts.isStringLiteralLike(argument)) return undefined;
  if (
    !isVi(call.expression, ['importActual']) &&
    call.expression.kind !== ts.SyntaxKind.ImportKeyword
  ) {
    return undefined;
  }
  return resolveSpecifier(argument.text, fromFile) ?? undefined;
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

// The names a statement declares (variables, functions, classes).
function declaredNames(statement) {
  const names = [];
  const collect = (name) => {
    if (ts.isIdentifier(name)) names.push(name.text);
    else
      for (const element of name.elements)
        if (!ts.isOmittedExpression(element)) collect(element.name);
  };
  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) collect(declaration.name);
  } else if (
    (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
    statement.name
  ) {
    names.push(statement.name.text);
  }
  return names;
}

const identifiersIn = (text) => new Set(text.match(/[A-Za-z_$][\w$]*/g) ?? []);

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

  // Every string literal under a node that names the listed module, for re-pointing.
  const literalsNaming = (node, listedFile) => {
    const found = [];
    const walk = (child) => {
      if (ts.isStringLiteralLike(child) && resolveSpecifier(child.text, file) === listedFile) {
        found.push(child);
      }
      ts.forEachChild(child, walk);
    };
    walk(node);
    return found;
  };
  const repointLiterals = (literals, target) => {
    for (const literal of literals) {
      edits.push({
        start: literal.getStart(sf),
        end: literal.getEnd(),
        text: `'${specifierFor(file, target)}'`,
      });
    }
  };

  // The one module a set of names of the listed module comes from, or undefined.
  const singleTarget = (listedFile, names) => {
    const targets = new Set();
    for (const name of names) {
      const resolved = resolveName(listedFile, name);
      if (!resolved || resolved.unresolved || resolved.name !== name) return undefined;
      targets.add(resolved.file);
    }
    return targets.size === 1 ? [...targets][0] : undefined;
  };

  // `const { a } = await import('<listed>')` or `await vi.importActual<typeof import('<listed>')>(...)`,
  // and `import('<listed>').then((module) => ... module.a ...)`, when the names come from one module.
  const repointDynamicImport = (call, listedFile) => {
    let names;
    const awaited = call.parent;
    const declaration = awaited && ts.isAwaitExpression(awaited) ? awaited.parent : undefined;
    if (
      declaration &&
      ts.isVariableDeclaration(declaration) &&
      ts.isObjectBindingPattern(declaration.name)
    ) {
      names = [];
      for (const element of declaration.name.elements) {
        const name = element.propertyName ?? element.name;
        if (element.dotDotDotToken || !ts.isIdentifier(name)) return false;
        names.push(name.text);
      }
    } else if (
      ts.isPropertyAccessExpression(call.parent) &&
      call.parent.name.text === 'then' &&
      ts.isCallExpression(call.parent.parent) &&
      call.parent.parent.arguments.length === 1
    ) {
      const callback = call.parent.parent.arguments[0];
      const parameter =
        (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
        callback.parameters[0]?.name;
      if (!parameter || !ts.isIdentifier(parameter) || callback.parameters.length !== 1)
        return false;
      names = [];
      let other = false;
      const walk = (node) => {
        if (ts.isIdentifier(node) && node.text === parameter.text && node !== parameter) {
          if (ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node)
            names.push(node.parent.name.text);
          else other = true;
        }
        ts.forEachChild(node, walk);
      };
      walk(callback.body);
      if (other || !names.length) return false;
    } else {
      return false;
    }
    const target = singleTarget(listedFile, names);
    if (!target) return false;
    if (target !== listedFile) repointLiterals(literalsNaming(call, listedFile), target);
    importCount += 1;
    return true;
  };

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
      const isImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isViCall = isVi(node.expression, [
        'mock',
        'doMock',
        'unmock',
        'doUnmock',
        'importActual',
        'importMock',
      ]);
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      const target = spec && (isImport || isViCall || isRequire) && resolveSpecifier(spec, file);
      if (target && listed.has(target)) {
        if (isVi(node.expression, ['mock', 'doMock']) && ts.isExpressionStatement(node.parent)) {
          const outcome = splitMock(node, target, spec);
          // A factory re-pointed in place may still name other listed modules.
          if (outcome === 'in place' || outcome === 'unchanged') ts.forEachChild(node, visit);
          if (outcome) return;
        } else if (isImport || isVi(node.expression, ['importActual'])) {
          if (repointDynamicImport(node, target)) return;
          warn(sf, node, `${node.expression.getText(sf)}() of ${rel(target)}`);
        } else {
          warn(sf, node, `${node.expression.getText(sf)}() of ${rel(target)}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  const splitMock = (call, listedFile, listedSpec) => {
    const factory = call.arguments[1];
    const statement = call.parent;
    const indent = indentOf(sf, statement);
    const callee = call.expression.getText(sf);
    const where = `${callee} of ${rel(listedFile)}`;
    if (call.arguments.length > 2) {
      warn(sf, call, `${where} with options`);
      return false;
    }
    const modules = reExportedModules(listedFile);
    const replaceWith = (lines) => {
      edits.push({
        start: statement.getStart(sf),
        end: statement.getEnd(),
        text: format(lines.join('\n'), indent),
      });
      mockCount += 1;
      return 'reprinted';
    };
    if (!factory) {
      if (modules.some((target) => mockedModules.has(target))) {
        warn(sf, call, `automock ${where}: the file already mocks one of its modules`);
        return false;
      }
      return replaceWith(modules.map((target) => `${callee}('${specifierFor(file, target)}');`));
    }
    const { object, prelude, reason } = factoryShape(factory);
    if (!object) {
      warn(sf, call, `${where}: ${reason}`);
      return false;
    }
    const groups = new Map();
    const groupFor = (target) => {
      if (!groups.has(target))
        groups.set(target, { target, members: [], real: false, order: undefined });
      return groups.get(target);
    };
    let realListed = false;
    let realListedByImport = false;
    const dropped = [];
    for (const property of object.properties) {
      if (ts.isSpreadAssignment(property)) {
        const real = spreadModule(property, factory, file);
        if (real === null || real === listedFile) {
          realListed = true;
          // `await import()` of the module inside its own factory would load the mock.
          if (/\bimport\(/.test(property.getText(sf))) realListedByImport = true;
        } else if (real && modules.includes(real)) {
          groupFor(real).real = true;
        } else {
          warn(
            sf,
            property,
            `${where}: spread ${property.getText(sf).slice(0, 60)} is not understood`
          );
          return false;
        }
        continue;
      }
      const name = propertyName(property);
      if (!name) {
        warn(
          sf,
          property,
          `${where}: property ${property.getText(sf).slice(0, 40)} has no plain name`
        );
        return false;
      }
      if (!isRuntimeExport(listedFile, name)) {
        dropped.push(name);
        continue;
      }
      const resolved = resolveName(listedFile, name);
      if (!resolved || resolved.unresolved || resolved.name !== name) {
        warn(
          sf,
          property,
          `${where}: property ${name} does not resolve to a name of the same spelling`
        );
        return false;
      }
      const group = groupFor(resolved.file);
      const order = resolved.file === listedFile ? [-1] : resolved.order;
      if (!group.order || compareOrder(order, group.order) < 0) group.order = order;
      group.members.push(
        sf.text
          .slice(property.getFullStart(), property.getEnd())
          .replace(/^\s*\n/, '')
          .trim()
      );
    }
    for (const name of dropped)
      report.droppedKeys.push(`${at(sf, call)}: ${where}: ${name} (not exported at run time)`);
    for (const group of groups.values()) {
      if (!group.order) group.order = [1000 + modules.indexOf(group.target)];
    }
    if (!groups.size) {
      if (realListed || object.properties.length) {
        warn(sf, call, `${where} keeps the real module only`);
        return false;
      }
      // `() => ({})`: none of the listed module's modules loads.
      if (modules.some((target) => mockedModules.has(target))) {
        warn(sf, call, `${where} (empty): the file already mocks one of its modules`);
        return false;
      }
      return replaceWith(
        modules.map((target) => `${callee}('${specifierFor(file, target)}', () => ({}));`)
      );
    }
    const sorted = [...groups.values()].sort((a, b) => compareOrder(a.order, b.order));
    if (sorted.length === 1 && sorted[0].target === listedFile && !dropped.length)
      return 'unchanged';
    if (sorted.some((group) => group.target !== listedFile && mockedModules.has(group.target))) {
      warn(sf, call, `${where}: the file already mocks a declaring module`);
      return false;
    }
    // One declaring module and nothing to drop or copy: only the module names change.
    if (sorted.length === 1 && !dropped.length && !sorted[0].real && !realListedByImport) {
      const [only] = sorted;
      repointLiterals(literalsNaming(call, listedFile), only.target);
      mockCount += 1;
      return 'in place';
    }
    const others = [...listed].filter(
      (other) => other !== listedFile && literalsNaming(factory, other).length
    );
    if (others.length) {
      warn(sf, call, `${where}: its factory also names ${others.map(rel).join(', ')}`);
      return false;
    }
    // A hoisted mock that only copies the real module changes nothing: it goes.
    const kept = sorted.filter((group) => {
      const noOp = callee === 'vi.mock' && !group.members.length && (group.real || realListed);
      if (noOp) report.noOpMocks.push(`${at(sf, call)}: ${where}: ${rel(group.target)}`);
      return !noOp;
    });
    if (!kept.length) {
      const end =
        sf.text[statement.getEnd()] === '\n' ? statement.getEnd() + 1 : statement.getEnd();
      edits.push({ start: statement.getStart(sf), end, text: '' });
      mockCount += 1;
      return 'removed';
    }
    const arrowEnd = ts.isArrowFunction(factory)
      ? factory.equalsGreaterThanToken.getEnd()
      : factory.body.getStart(sf);
    const head = sf.text.slice(factory.getStart(sf), arrowEnd).trim();
    const multiline = /^\{[ \t]*\n/.test(object.getText(sf));
    const lines = kept.map((group) => {
      const spec = group.target === listedFile ? listedSpec : specifierFor(file, group.target);
      const real = group.real || realListed;
      const members = [
        ...(real ? [`...(await importOriginal<typeof import('${spec}')>())`] : []),
        ...group.members,
      ];
      const objectText = multiline ? `{\n${members.join(',\n')},\n}` : `{ ${members.join(', ')} }`;
      // The statements before the return that this group's properties need, in their order.
      const needed = new Set();
      let used = identifiersIn(group.members.join('\n'));
      for (let changed = true; changed; ) {
        changed = false;
        for (const statementBefore of prelude) {
          if (needed.has(statementBefore)) continue;
          const names = declaredNames(statementBefore);
          if (!names.length || names.some((name) => used.has(name))) {
            needed.add(statementBefore);
            used = new Set([...used, ...identifiersIn(statementBefore.getText(sf))]);
            changed = true;
          }
        }
      }
      const kept = prelude.filter((statementBefore) => needed.has(statementBefore));
      const factoryHead = real ? 'async (importOriginal) =>' : head;
      const body = ts.isBlock(factory.body)
        ? `{\n${kept
            .map((statementBefore) => statementBefore.getText(sf))
            .join('\n')}\nreturn ${objectText};\n}`
        : `(${objectText})`;
      return `${callee}('${spec}', ${factoryHead} ${body});`;
    });
    return replaceWith(lines);
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
for (const line of report.droppedKeys) console.log(`collapse: dropped mock key: ${line}`);
for (const line of report.noOpMocks) console.log(`collapse: dropped no-op mock: ${line}`);
for (const line of warnings) console.log(`collapse: warning: ${line}`);
if (opts.report) fs.writeFileSync(opts.report, `${JSON.stringify(report, null, 2)}\n`);
