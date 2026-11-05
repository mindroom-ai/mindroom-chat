#!/usr/bin/env node
// Move files and directories in a git checkout and rewrite every reference to them.
//
// Usage:
//   node move.mjs --repo <checkout> --map <map.tsv> --batch <id> [options]
//
// Map: tab-separated rows `old<TAB>new`. `old` is a tracked file or a directory (every tracked
// file under it); `new` is the destination path, a destination ending in `/` keeps the old base
// name inside that directory, and `-` deletes. A file follows the most specific row that contains
// it. Blank lines and lines starting with `#` are skipped. A deleted path that another row moves a
// file onto is replaced: its importers keep their specifier (a re-export shim replaced by its module).
//
// What it rewrites (as text edits on the original files; nothing is reprinted or reformatted):
//   - module specifiers in TypeScript and JavaScript: static imports and re-exports (type ones
//     too), `import()`, `typeof import()` types, `import x = require()`, `require()`,
//     `require.resolve()`, `vi.mock`/`vi.doMock`/`vi.unmock`/`vi.doUnmock`/`vi.importActual`/
//     `vi.importMock`; query suffixes (`?raw`, `?url`, `?worker`) are kept, a directory import stays
//     a directory import, an omitted extension stays omitted;
//   - `import.meta.glob` patterns (relative or `/src/...`);
//   - path expressions anchored at the file: `new URL(<literal>, import.meta.url)`, template
//     literals there (the part before the last `/`), and `resolve`/`join` calls whose first
//     argument evaluates to a known directory (`dirname(fileURLToPath(import.meta.url))`,
//     `__dirname`, constants built from them, also imported ones), plus one-parameter helpers
//     built on them (`const appFile = (p) => resolve(APP_ROOT, p)`);
//   - repository paths written out anywhere in a text file (`src/app/x/y.tsx`, `/src/app/x/y.ts`
//     as the dev server serves it, with or without the extension, directories too): configs,
//     tests, e2e specs, scripts, index.html, NOTICE, AGENTS.md and docs, except the provenance
//     record (docs/provenance.md, docs/provenance/) and the historical plans and specs
//     (docs/baspowers/);
//   - relative `src`/`href` attributes in HTML pages;
//   - app-relative strings in tests that name a moved file (`'mindroom/threads/x.ts'` resolved
//     against src/app/mindroom, src/app or src); reported as heuristic edits.
// Then it runs `git rm` for deletions, `git mv` (one call per moved directory, else per file),
// writes the edited files, appends one row per moved or deleted file to
// docs/provenance/moves.tsv (old path, new path or empty, batch), appends deleted Lane P files to
// docs/provenance/dropped.tsv, stages exactly the paths it touched, and type-checks.
//
// Options:
//   --dry-run              plan and print the edits; change nothing
//   --report <file>        write the plan, every edit and every warning as JSON
//   --no-tsc               skip the type-check at the end
//   --full-tsc             also run `tsc -p .` (tests and e2e included) and count its errors
//   --allow-dirty          run although moved or edited paths have uncommitted changes
//   --drop-reason <text>   reason for deleted Lane P files in dropped.tsv (default: dead code)
//   --text-exclude <path>  another path prefix the text pass leaves alone (repeatable)
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

const posix = path.posix;
const started = Date.now();

// ---------------------------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { textExclude: [], dryRun: false, tsc: true, fullTsc: false, allowDirty: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`${arg} needs a value`);
      return argv[i];
    };
    if (arg === '--repo') opts.repo = value();
    else if (arg === '--map') opts.map = value();
    else if (arg === '--batch') opts.batch = value();
    else if (arg === '--report') opts.report = value();
    else if (arg === '--drop-reason') opts.dropReason = value();
    else if (arg === '--text-exclude') opts.textExclude.push(value());
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--no-tsc') opts.tsc = false;
    else if (arg === '--full-tsc') opts.fullTsc = true;
    else if (arg === '--allow-dirty') opts.allowDirty = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!opts.repo || !opts.map || !opts.batch) {
    throw new Error('usage: move.mjs --repo <checkout> --map <map.tsv> --batch <id> [options]');
  }
  if (/[\t\n]/.test(opts.batch)) throw new Error('--batch must not contain tabs or newlines');
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const repo = path.resolve(opts.repo);
const ts = createRequire(path.join(repo, 'package.json'))('typescript');
const git = (...args) =>
  execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 1 << 30 });

// ---------------------------------------------------------------------------------------------
// Repository state and the move plan
// ---------------------------------------------------------------------------------------------

const tracked = git('ls-files', '-z').split('\0').filter(Boolean);
const trackedSet = new Set(tracked);
const dirFiles = new Map(); // directory -> tracked files under it (any depth)
for (const file of tracked) {
  for (let dir = posix.dirname(file); dir !== '.'; dir = posix.dirname(dir)) {
    if (!dirFiles.has(dir)) dirFiles.set(dir, []);
    dirFiles.get(dir).push(file);
  }
}
const isDir = (p) => p === '' || dirFiles.has(p);
const dirOf = (p) => (posix.dirname(p) === '.' ? '' : posix.dirname(p));

const cleanPath = (raw, where) => {
  const trimmed = raw.trim().replace(/^\.\//, '');
  const keepSlash = trimmed.endsWith('/');
  const normal = posix.normalize(trimmed).replace(/\/+$/, '');
  if (!normal || normal === '.' || normal.startsWith('../') || normal === '..' || normal.startsWith('/')) {
    throw new Error(`${where}: ${JSON.stringify(raw)} is not a path inside the repository`);
  }
  return keepSlash ? `${normal}/` : normal;
};

const rows = fs
  .readFileSync(opts.map, 'utf8')
  .split('\n')
  .map((line, index) => ({ line: line.replace(/\r$/, ''), number: index + 1 }))
  .filter(({ line }) => line.trim() && !line.startsWith('#'))
  .map(({ line, number }) => {
    const [oldRaw, newRaw] = line.split('\t');
    const where = `${opts.map}:${number}`;
    if (newRaw === undefined) throw new Error(`${where}: expected two tab-separated columns`);
    const old = cleanPath(oldRaw, where).replace(/\/$/, '');
    if (!trackedSet.has(old) && !isDir(old)) throw new Error(`${where}: ${old} is not tracked`);
    if (newRaw.trim() === '-') return { old, new: null, number, matched: 0 };
    let dest = cleanPath(newRaw, where);
    if (dest.endsWith('/')) dest = `${dest}${posix.basename(old)}`;
    return { old, new: dest, number, matched: 0 };
  });
const bySpecificity = [...rows].sort((a, b) => b.old.length - a.old.length);
const rowFor = (p) => bySpecificity.find((row) => p === row.old || p.startsWith(`${row.old}/`));

const moves = new Map(); // old file -> new file, or null when deleted
for (const file of tracked) {
  const row = rowFor(file);
  if (!row) continue;
  row.matched += 1;
  const dest = row.new === null ? null : row.new + file.slice(row.old.length);
  if (dest !== file) moves.set(file, dest);
}

const errors = [];
for (const row of rows) if (row.matched === 0) errors.push(`map line ${row.number}: ${row.old} matches no tracked file`);
const destinations = new Map();
for (const [from, to] of moves) {
  if (to === null) continue;
  if (destinations.has(to)) errors.push(`${from} and ${destinations.get(to)} both move to ${to}`);
  destinations.set(to, from);
  if (trackedSet.has(to) && !moves.has(to)) errors.push(`${from}: destination ${to} is a tracked file that stays`);
  else if (!trackedSet.has(to) && fs.existsSync(path.join(repo, to))) errors.push(`${from}: destination ${to} exists on disk`);
  if (isDir(to)) errors.push(`${from}: destination ${to} is a directory`);
}
const newFiles = new Set(tracked.filter((file) => !moves.has(file)));
for (const to of destinations.keys()) newFiles.add(to);
for (const file of newFiles) {
  for (let dir = posix.dirname(file); dir !== '.'; dir = posix.dirname(dir)) {
    if (newFiles.has(dir)) errors.push(`${file} would sit under ${dir}, which is a file`);
  }
}
if (errors.length) fail(errors);

function fail(messages) {
  for (const message of messages) console.error(`move: ${message}`);
  process.exit(2);
}

// A deleted file whose path another file of the batch takes (a re-export shim replaced by the
// module it re-exported): its importers keep the path, which now holds that module.
const replaced = new Map([...moves].filter(([from, to]) => to === null && destinations.has(from)).map(([from]) => [from, destinations.get(from)]));

/** The new path of a file (null when deleted), or the file itself when it stays or is replaced. */
const movedFile = (file) => (moves.has(file) && !replaced.has(file) ? moves.get(file) : file);

const dirMoveCache = new Map();
/**
 * The new location of any repository path: a moved or staying file; a directory, which moves when
 * every tracked file under it moves by the same shift and otherwise stays, `partial` when some of
 * its files leave it; or an untracked path under a moved directory row. `path` is null when the
 * path is deleted.
 */
function movedPath(p) {
  if (trackedSet.has(p)) return { path: movedFile(p), partial: false };
  if (isDir(p)) {
    if (dirMoveCache.has(p)) return dirMoveCache.get(p);
    const files = p === '' ? tracked : dirFiles.get(p);
    const shifted = files.map((file) => movedFile(file));
    let result;
    if (shifted.every((dest) => dest === null)) result = { path: null, partial: false };
    else {
      const row = rowFor(p);
      const candidate = row && row.new !== null ? row.new + p.slice(row.old.length) : null;
      const whole = candidate !== null && shifted.every((dest, i) => dest === null || dest === candidate + files[i].slice(p.length));
      const dest = whole ? candidate : p;
      const inside = dest === '' ? () => true : (file) => file.startsWith(`${dest}/`);
      const leaving = shifted.filter((file) => file !== null && !inside(file)).length;
      result = { path: dest, partial: leaving > 0, emptied: shifted.every((file) => file === null || !inside(file)) };
    }
    dirMoveCache.set(p, result);
    return result;
  }
  const row = rowFor(p);
  if (!row) return { path: p, partial: false };
  return { path: row.new === null ? null : row.new + p.slice(row.old.length), partial: false };
}

// ---------------------------------------------------------------------------------------------
// Lane P (for the report and dropped.tsv): import-time paths from the portable lists, carried
// through the rows already in docs/provenance/moves.tsv.
// ---------------------------------------------------------------------------------------------

const PROV = 'docs/provenance';
const readText = (rel) => fs.readFileSync(path.join(repo, rel), 'utf8');
const portableLists = fs
  .readdirSync(path.join(repo, PROV))
  .filter((name) => /^portable.*\.tsv$/.test(name))
  .sort();
const importWave = new Map(); // import-time path -> wave number
for (const name of portableLists) {
  const wave = name === 'portable.tsv' ? 1 : Number(/wave(\d+)/.exec(name)?.[1] ?? 0);
  for (const line of readText(`${PROV}/${name}`).split('\n')) {
    const [file] = line.split('\t');
    if (file) importWave.set(file, wave);
  }
}
const MOVES_FILE = `${PROV}/moves.tsv`;
const MOVES_HEADER = 'old\tnew\tbatch';
const priorMoves = fs.existsSync(path.join(repo, MOVES_FILE))
  ? readText(MOVES_FILE).split('\n').slice(1).filter(Boolean).map((line) => line.split('\t'))
  : [];
const lanePByCurrent = new Map(); // current path -> import-time path
for (const file of importWave.keys()) lanePByCurrent.set(file, file);
for (const [from, to] of priorMoves) {
  if (!lanePByCurrent.has(from)) continue;
  const origin = lanePByCurrent.get(from);
  lanePByCurrent.delete(from);
  if (to) lanePByCurrent.set(to, origin);
}
const isLaneP = (file) => lanePByCurrent.has(file);

// ---------------------------------------------------------------------------------------------
// Files to scan
// ---------------------------------------------------------------------------------------------

const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const TEXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|json|md|html|css|scss|sh|py|rb|yaml|yml|toml|txt|tsv|nix|swift|plist|xml|gradle|pbxproj|cfg|ini|conf)$|(^|\/)(justfile|NOTICE|LICENSE|Dockerfile|Fastfile|Podfile|\.gitignore|\.prettierrc|\.eslintrc\.cjs)$/;
const TEXT_EXCLUDE = [
  'docs/provenance.md',
  'docs/provenance/',
  'docs/baspowers/',
  'package-lock.json',
  'patches/',
  'licenses/',
  ...opts.textExclude,
];
const textExcluded = (file) => TEXT_EXCLUDE.some((prefix) => file === prefix || file.startsWith(prefix));
// Symbolic links (CLAUDE.md -> AGENTS.md) are read and edited through their target only.
const scanned = tracked.filter(
  (file) => TEXT.test(file) && !textExcluded(file) && fs.lstatSync(path.join(repo, file), { throwIfNoEntry: false })?.isFile()
);

const contents = new Map();
const readFile = (file) => {
  if (!contents.has(file)) contents.set(file, fs.readFileSync(path.join(repo, file), 'utf8'));
  return contents.get(file);
};

// ---------------------------------------------------------------------------------------------
// Module resolution (bundler style, as tsconfig.json's moduleResolution says)
// ---------------------------------------------------------------------------------------------

const EXTS = ['.ts', '.tsx', '.d.ts', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'];
const JS_TO_TS = { '.js': ['.ts', '.tsx'], '.jsx': ['.tsx'], '.mjs': ['.mts'], '.cjs': ['.cts'] };
const existsOld = (p) => trackedSet.has(p) || (!p.startsWith('..') && fs.existsSync(path.join(repo, p)) && fs.statSync(path.join(repo, p)).isFile());
const splitQuery = (spec) => {
  const index = spec.indexOf('?');
  return index < 0 ? [spec, ''] : [spec.slice(0, index), spec.slice(index)];
};
const isRelative = (spec) => spec === '.' || spec === '..' || spec.startsWith('./') || spec.startsWith('../');
const join = (...parts) => posix.normalize(posix.join(...parts)).replace(/^\.$/, '').replace(/\/$/, '');
/** Whether a repository-relative path leaves the repository. */
const outside = (p) => p === '..' || p.startsWith('../') || p.startsWith('/');

/** Resolves a relative or root-absolute specifier written in `fromFile` to a file. */
function resolveModule(fromFile, spec) {
  const [bare, query] = splitQuery(spec);
  if (!isRelative(bare) && !bare.startsWith('/')) return null;
  const base = bare.startsWith('/') ? join(bare.slice(1)) : join(dirOf(fromFile), bare);
  const result = (target, style, ext = '') => ({ target, style, ext, query, rootAbsolute: bare.startsWith('/'), trailingSlash: bare.endsWith('/') });
  if (!bare.endsWith('/') && existsOld(base)) return result(base, 'exact');
  if (!bare.endsWith('/')) {
    for (const ext of EXTS) if (existsOld(base + ext)) return result(base + ext, 'ext', ext);
    const written = /\.(m|c)?jsx?$/.exec(base)?.[0];
    if (written) {
      const stem = base.slice(0, -written.length);
      for (const ext of JS_TO_TS[written] ?? []) if (existsOld(stem + ext)) return result(stem + ext, 'js', written);
    }
  }
  for (const ext of EXTS) if (existsOld(`${base}/index${ext}`)) return result(`${base}/index${ext}`, 'index');
  return { target: base, style: 'missing', ext: '', query, rootAbsolute: bare.startsWith('/'), trailingSlash: bare.endsWith('/') };
}

const stripExt = (file, ext) => {
  if (ext && file.endsWith(ext)) return file.slice(0, -ext.length);
  const known = EXTS.find((candidate) => file.endsWith(candidate));
  return known ? file.slice(0, -known.length) : file;
};

/** A relative specifier from `fromDir` to `target`, with `./` when it does not climb. */
function relativeSpec(fromDir, target, { dotSlash = true, trailingSlash = false } = {}) {
  let rel = posix.relative(fromDir, target);
  if (rel === '') rel = '.';
  else if (dotSlash && rel !== '..' && !rel.startsWith('../')) rel = `./${rel}`;
  if (trailingSlash && !rel.endsWith('/')) rel += '/';
  return rel;
}

// ---------------------------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------------------------

const edits = new Map(); // file -> [{ start, end, text, kind, before }]
const warnings = [];
let planning = false; // while true, passes only settle the new text of path literals
/** Records a warning; a `fatal` one (code that still uses a deleted file) stops the run. */
const warn = (file, node, sf, message, fatal = false) => {
  if (planning) return;
  const line = node && sf ? sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 : 0;
  warnings.push({ file, line, message, ...(fatal ? { fatal } : {}) });
};
function addEdit(file, start, end, text, kind) {
  if (planning) return;
  const before = readFile(file).slice(start, end);
  if (before === text) return;
  if (!edits.has(file)) edits.set(file, []);
  const list = edits.get(file);
  if (list.some((edit) => start < edit.end && edit.start < end)) return; // first edit wins
  list.push({ start, end, text, kind, before });
}

/** The inner range of a string literal or no-substitution template, when it has no escapes. */
function literalRange(node, sf) {
  if (!ts.isStringLiteral(node) && !ts.isNoSubstitutionTemplateLiteral(node)) return null;
  const start = node.getStart(sf) + 1;
  const end = node.getEnd() - 1;
  return sf.text.slice(start, end) === node.text ? { start, end, value: node.text } : null;
}

// ---------------------------------------------------------------------------------------------
// Pass 1: TypeScript and JavaScript syntax
// ---------------------------------------------------------------------------------------------

const VI_PATH_CALLS = new Set(['mock', 'doMock', 'unmock', 'doUnmock', 'importActual', 'importMock']);
const PATH_JOINS = new Set(['resolve', 'join']);
const isImportMetaUrl = (node) =>
  ts.isPropertyAccessExpression(node) &&
  ts.isMetaProperty(node.expression) &&
  node.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
  node.name.text === 'url';
const isImportMetaGlob = (node) =>
  ts.isPropertyAccessExpression(node) &&
  ts.isMetaProperty(node.expression) &&
  node.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
  node.name.text === 'glob';
const calleeName = (node) => {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  return null;
};

const parsed = new Map(); // old file -> SourceFile
const parse = (file) => {
  if (!parsed.has(file)) {
    const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.jsx') ? ts.ScriptKind.JSX : /\.(c|m)?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
    parsed.set(file, ts.createSourceFile(file, readFile(file), ts.ScriptTarget.Latest, true, kind));
  }
  return parsed.get(file);
};

// Path expressions evaluate to `{ path, dir }`, a repository-relative path in the old or the new
// layout. Constants and helpers are looked up by name per file (not by scope), also through named
// imports of relative modules.
const envCache = new Map();
function fileEnv(file) {
  if (envCache.has(file)) return envCache.get(file);
  const sf = parse(file);
  const env = { consts: new Map(), helpers: new Map(), imports: new Map() };
  envCache.set(file, env);
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const list = node.parent;
      if (ts.isVariableDeclarationList(list) && list.flags & ts.NodeFlags.Const) {
        const init = node.initializer;
        if ((ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && init.parameters.length >= 1) {
          env.helpers.set(node.name.text, init);
        } else {
          env.consts.set(node.name.text, init);
        }
      }
    }
    if (ts.isFunctionDeclaration(node) && node.name && node.parameters.length >= 1) env.helpers.set(node.name.text, node);
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
      const resolved = resolveModule(file, node.moduleSpecifier.text);
      if (resolved && resolved.style !== 'missing' && CODE.test(resolved.target) && trackedSet.has(resolved.target)) {
        for (const element of node.importClause.namedBindings.elements) {
          env.imports.set(element.name.text, { file: resolved.target, name: (element.propertyName ?? element.name).text });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return env;
}

function lookup(file, name, kind) {
  const env = fileEnv(file);
  if (env[kind].has(name)) return { file, node: env[kind].get(name) };
  const imported = env.imports.get(name);
  if (imported && imported.file !== file) {
    const target = fileEnv(imported.file);
    if (target[kind].has(imported.name)) return { file: imported.file, node: target[kind].get(imported.name) };
  }
  return null;
}

const newTextOfLiteral = new Map(); // `${file}:${start}` -> planned text
const literalValue = (file, node, sf, layout) => {
  const range = literalRange(node, sf);
  if (!range) return null;
  if (layout === 'new') {
    const planned = newTextOfLiteral.get(`${file}:${range.start}`);
    if (planned !== undefined) return planned;
  }
  return range.value;
};

/**
 * Evaluates a path expression in `file` to a repository-relative path in the old or the new
 * layout. Returns `{ path, dir }` or null. Paths may leave the repository only as null.
 */
function evalPath(file, node, layout, depth = 0) {
  if (!node || depth > 12) return null;
  const sf = parse(file);
  const self = layout === 'old' ? file : movedFile(file);
  if (self === null) return null;
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) return evalPath(file, node.expression, layout, depth + 1);
  if (isImportMetaUrl(node)) return { path: self, dir: false };
  if (ts.isIdentifier(node)) {
    if (node.text === '__dirname') return { path: dirOf(self), dir: true };
    if (node.text === '__filename') return { path: self, dir: false };
    const found = lookup(file, node.text, 'consts');
    return found ? evalPath(found.file, found.node, layout, depth + 1) : null;
  }
  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'URL' && node.arguments?.length === 2) {
    const base = evalPath(file, node.arguments[1], layout, depth + 1);
    const rel = literalValue(file, node.arguments[0], sf, layout);
    if (!base || rel === null) return null;
    const dir = base.dir ? base.path : dirOf(base.path);
    return { path: join(dir, rel), dir: rel === '' || rel.endsWith('/') || rel === '.' || rel === '..' };
  }
  if (ts.isCallExpression(node)) {
    const name = calleeName(node.expression);
    const [first] = node.arguments;
    if (name === 'fileURLToPath' && first) return evalPath(file, first, layout, depth + 1);
    if (name === 'dirname' && first) {
      const inner = evalPath(file, first, layout, depth + 1);
      return inner ? { path: dirOf(inner.path), dir: true } : null;
    }
    if (PATH_JOINS.has(name) && node.arguments.length >= 2) {
      const base = evalPath(file, first, layout, depth + 1);
      if (!base) return null;
      const rest = node.arguments.slice(1).map((arg) => literalValue(file, arg, sf, layout));
      if (rest.some((value) => value === null)) return null;
      return { path: join(base.path, ...rest), dir: false };
    }
  }
  return null;
}

/** Plans the new text of a literal that names `oldTarget` relative to a base directory. */
function planAnchored(file, literal, sf, baseOld, baseNew, kind, { dotSlash } = {}) {
  const range = literalRange(literal, sf);
  if (!range || baseOld === null || baseNew === null || outside(baseOld) || outside(baseNew)) return;
  const value = range.value;
  if (value.startsWith('/') || /^[a-z]+:/i.test(value)) return;
  const trailingSlash = value.endsWith('/') && value !== '/';
  const target = join(baseOld, value);
  if (outside(target)) return;
  let moved = movedPath(target);
  let ext = '';
  if (!trackedSet.has(target) && !isDir(target) && !fs.existsSync(path.join(repo, target))) {
    // Written without its extension, as a module path often is.
    const withExt = EXTS.find((candidate) => trackedSet.has(target + candidate));
    if (withExt) {
      ext = withExt;
      const dest = movedFile(target + withExt);
      moved = { path: dest === null ? null : stripExt(dest, withExt), partial: false };
    }
  }
  if (moved.path === null) {
    warn(file, literal, sf, `${kind}: ${value} names ${target}${ext}, which this batch deletes`, true);
    return;
  }
  if (moved.partial) warn(file, literal, sf, `${kind}: ${value} names directory ${target}, which this batch ${moved.emptied ? 'empties' : 'moves only in part'}`);
  const keepDot = dotSlash ?? value.startsWith('./');
  let text = posix.relative(baseNew, moved.path);
  if (text === '') text = value === '' ? '' : '.';
  else if (keepDot && !text.startsWith('../')) text = `./${text}`;
  if (trailingSlash && !text.endsWith('/')) text += '/';
  if (text === value) return;
  if (text.startsWith('../') && !value.startsWith('../') && kind.startsWith('helper')) {
    warn(file, literal, sf, `${kind}: ${value} now climbs out of its base (${text}); consider a helper with a wider base`);
  }
  newTextOfLiteral.set(`${file}:${range.start}`, text);
  addEdit(file, range.start, range.end, text, kind);
}

/** Template literal `prefix${...}rest` anchored at a directory: rewrites the part up to the last `/`. */
function planTemplateHead(file, template, sf, baseOld, baseNew, kind) {
  const head = template.head;
  const raw = head.rawText ?? head.text;
  if (raw !== head.text) return;
  const cut = raw.lastIndexOf('/');
  if (cut < 0) return;
  const prefix = raw.slice(0, cut + 1);
  if (prefix.startsWith('/') || /^[a-z]+:/i.test(prefix)) return;
  if (outside(baseOld) || outside(baseNew)) return;
  const target = join(baseOld, prefix);
  if (outside(target)) return;
  const moved = movedPath(target);
  if (moved.path === null) return warn(file, template, sf, `${kind}: template prefix ${prefix} names a deleted directory`);
  if (moved.partial) warn(file, template, sf, `${kind}: template prefix ${prefix} names directory ${target}, which this batch ${moved.emptied ? 'empties' : 'moves only in part'}`);
  let text = posix.relative(baseNew, moved.path);
  text = text === '' ? './' : `${!text.startsWith('../') && prefix.startsWith('./') ? './' : ''}${text}/`;
  const start = head.getStart(sf) + 1;
  newTextOfLiteral.set(`${file}:${start}`, text + raw.slice(prefix.length));
  if (text === prefix) return;
  addEdit(file, start, start + prefix.length, text, kind);
}

function planSpecifier(file, literal, sf, kind) {
  const range = literalRange(literal, sf);
  if (!range) return;
  const resolved = resolveModule(file, range.value);
  if (!resolved) return;
  const newFile = movedFile(file);
  let target;
  if (resolved.style === 'missing') {
    if (newFile === file) return;
    const dest = movedPath(resolved.target).path;
    target = dest === null ? resolved.target : dest;
    warn(file, literal, sf, `${kind}: ${range.value} resolves to no file; kept pointing at ${target}`);
  } else {
    const dest = movedFile(resolved.target);
    if (dest === null) {
      if (newFile !== null) warn(file, literal, sf, `${kind}: ${range.value} imports ${resolved.target}, which this batch deletes`, true);
      return;
    }
    if (dest === resolved.target && newFile === file) return;
    target = dest;
  }
  let written;
  switch (resolved.style) {
    case 'exact':
    case 'missing':
      written = target;
      break;
    case 'ext':
      written = stripExt(target, resolved.ext);
      break;
    case 'js':
      written = stripExt(target) + resolved.ext;
      break;
    case 'index':
      written = posix.basename(target) === posix.basename(resolved.target) ? dirOf(target) : stripExt(target);
      break;
    default:
      throw new Error(`unknown style ${resolved.style}`);
  }
  const text = resolved.rootAbsolute
    ? `/${written}${resolved.query}`
    : `${relativeSpec(dirOf(newFile), written, { trailingSlash: resolved.trailingSlash })}${resolved.query}`;
  newTextOfLiteral.set(`${file}:${range.start}`, text);
  addEdit(file, range.start, range.end, text, kind);
}

function planGlob(file, literal, sf) {
  const range = literalRange(literal, sf);
  if (!range) return;
  const negated = range.value.startsWith('!');
  const pattern = negated ? range.value.slice(1) : range.value;
  const segments = pattern.split('/');
  const firstGlob = segments.findIndex((segment) => /[*?{}[\]]/.test(segment));
  const prefix = segments.slice(0, firstGlob < 0 ? segments.length - 1 : firstGlob).join('/');
  const rest = segments.slice(firstGlob < 0 ? segments.length - 1 : firstGlob).join('/');
  const rootAbsolute = prefix.startsWith('/');
  if (!rootAbsolute && !isRelative(prefix)) return;
  const oldBase = rootAbsolute ? join(prefix.slice(1)) : join(dirOf(file), prefix);
  const moved = movedPath(oldBase);
  const newFile = movedFile(file);
  if (moved.path === null || newFile === null) return;
  if (moved.partial) warn(file, literal, sf, `import.meta.glob: ${range.value} covers directory ${oldBase}, which this batch ${moved.emptied ? 'empties' : 'moves only in part'}; the glob now misses the moved files`);
  const newPrefix = rootAbsolute ? `/${moved.path}` : relativeSpec(dirOf(newFile), moved.path);
  const text = `${negated ? '!' : ''}${newPrefix}/${rest}`;
  if (text === range.value) return;
  warn(file, literal, sf, `import.meta.glob: pattern ${range.value} became ${text}; the keys of its result change form too, check code that builds them`);
  addEdit(file, range.start, range.end, text, 'import.meta.glob');
}

/** A helper `(p) => resolve(BASE, p)` or `(p) => readFileSync(new URL(p, import.meta.url))`. */
const helperMemo = new Map();
let round = 0;
function helperBase(file, helper, layout) {
  const key = `${round}:${layout}:${helper.file}:${helper.node.pos}`;
  if (!helperMemo.has(key)) helperMemo.set(key, computeHelperBase(helper, layout));
  return helperMemo.get(key);
}
function computeHelperBase(helper, layout) {
  const param = helper.node.parameters[0];
  if (!param || !ts.isIdentifier(param.name)) return null;
  const paramName = param.name.text;
  const helperSf = parse(helper.file);
  let base = null;
  const visit = (node) => {
    if (base !== null) return;
    if (ts.isCallExpression(node) && PATH_JOINS.has(calleeName(node.expression)) && node.arguments.length === 2 && ts.isIdentifier(node.arguments[1]) && node.arguments[1].text === paramName) {
      const value = evalPath(helper.file, node.arguments[0], layout);
      if (value) base = value.path;
    } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'URL' && node.arguments?.length === 2 && isImportMetaUrl(node.arguments[1])) {
      const first = node.arguments[0];
      const self = layout === 'old' ? helper.file : movedFile(helper.file);
      if (ts.isIdentifier(first) && first.text === paramName) base = dirOf(self);
      else if (ts.isTemplateExpression(first) && first.templateSpans.length === 1 && ts.isIdentifier(first.templateSpans[0].expression) && first.templateSpans[0].expression.text === paramName && first.templateSpans[0].literal.text === '' && first.head.text.endsWith('/')) {
        const planned = layout === 'new' ? newTextOfLiteral.get(`${helper.file}:${first.head.getStart(helperSf) + 1}`) : undefined;
        base = join(dirOf(self), planned ?? first.head.text);
      }
    }
    if (base === null) ts.forEachChild(node, visit);
  };
  visit(helper.node.body ?? helper.node);
  return base;
}

function scanCode(file) {
  const sf = parse(file);
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      planSpecifier(file, node.moduleSpecifier, sf, ts.isImportDeclaration(node) ? 'import' : 'export from');
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      planSpecifier(file, node.moduleReference.expression, sf, 'import = require');
    } else if (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name) && isRelative(node.name.text)) {
      planSpecifier(file, node.name, sf, 'declare module');
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      planSpecifier(file, node.argument.literal, sf, 'import type node');
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const [first] = node.arguments;
      const name = calleeName(callee);
      if (callee.kind === ts.SyntaxKind.ImportKeyword && first) {
        if (ts.isTemplateExpression(first)) planTemplateHead(file, first, sf, dirOf(file), dirOf(movedFile(file) ?? file), 'import() template');
        else planSpecifier(file, first, sf, 'import()');
      } else if (ts.isIdentifier(callee) && callee.text === 'require' && first) {
        planSpecifier(file, first, sf, 'require');
      } else if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'require' && name === 'resolve' && first) {
        planSpecifier(file, first, sf, 'require.resolve');
      } else if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && ['vi', 'vitest'].includes(callee.expression.text) && VI_PATH_CALLS.has(name) && first) {
        planSpecifier(file, first, sf, `vi.${name}`);
      } else if (isImportMetaGlob(callee) && first) {
        const patterns = ts.isArrayLiteralExpression(first) ? first.elements : [first];
        for (const pattern of patterns) planGlob(file, pattern, sf);
      } else if (PATH_JOINS.has(name) && node.arguments.length >= 2) {
        const baseOld = evalPath(file, first, 'old');
        const baseNew = baseOld && evalPath(file, first, 'new');
        if (baseOld && baseNew) {
          if (node.arguments.length === 2) planAnchored(file, node.arguments[1], sf, baseOld.path, baseNew.path, `${name}() from a known directory`);
          else if (baseOld.path !== baseNew.path || node.arguments.slice(1).some((arg) => literalRange(arg, sf) && movedPath(join(baseOld.path, literalRange(arg, sf).value)).path !== join(baseOld.path, literalRange(arg, sf).value))) {
            warn(file, node, sf, `${name}() with several path segments from a known directory; check it by hand`);
          }
        }
      } else if (ts.isIdentifier(callee) && first && (literalRange(first, sf) || ts.isTemplateExpression(first))) {
        const helper = lookup(file, callee.text, 'helpers');
        if (helper) {
          const baseOld = helperBase(file, helper, 'old');
          const baseNew = baseOld === null ? null : helperBase(file, helper, 'new');
          if (baseOld !== null && baseNew !== null) {
            if (ts.isTemplateExpression(first)) planTemplateHead(file, first, sf, baseOld, baseNew, `helper ${callee.text}()`);
            else planAnchored(file, first, sf, baseOld, baseNew, `helper ${callee.text}()`, { dotSlash: false });
          }
        }
      }
    } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'URL' && node.arguments?.length === 2) {
      const base = evalPath(file, node.arguments[1], 'old');
      const baseNew = base && evalPath(file, node.arguments[1], 'new');
      if (base && baseNew) {
        const oldDir = base.dir ? base.path : dirOf(base.path);
        const newDir = baseNew.dir ? baseNew.path : dirOf(baseNew.path);
        const first = node.arguments[0];
        if (ts.isTemplateExpression(first)) planTemplateHead(file, first, sf, oldDir, newDir, 'new URL() template');
        else planAnchored(file, first, sf, oldDir, newDir, 'new URL()', {});
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

// ---------------------------------------------------------------------------------------------
// Pass 2: repository paths written out in any text file
// ---------------------------------------------------------------------------------------------

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentionTargets = new Map(); // written old path -> written new path (null when deleted)
for (const [from, to] of moves) {
  if (replaced.has(from)) continue;
  mentionTargets.set(from, to);
  const ext = EXTS.find((candidate) => from.endsWith(candidate));
  if (ext && /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(from)) {
    const stem = from.slice(0, -ext.length);
    if (!trackedSet.has(stem) && !isDir(stem) && !mentionTargets.has(stem)) mentionTargets.set(stem, to === null ? null : stripExt(to, ext));
  }
}
for (const row of rows) {
  if (!isDir(row.old)) continue;
  const moved = movedPath(row.old);
  if (!moved.partial) mentionTargets.set(row.old, moved.path);
}
const PATH_CHAR = /[A-Za-z0-9_.@$-]/;
const mentionPattern = mentionTargets.size
  ? new RegExp([...mentionTargets.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp).join('|'), 'g')
  : null;

function scanMentions(file, codeRanges) {
  if (!mentionPattern) return;
  const text = readFile(file);
  mentionPattern.lastIndex = 0;
  for (let match = mentionPattern.exec(text); match; match = mentionPattern.exec(text)) {
    const start = match.index;
    const end = start + match[0].length;
    const before = text[start - 1] ?? '';
    const after = text[end] ?? '';
    if (before && PATH_CHAR.test(before)) continue;
    // `./src/...` in a file at the repository root is a root path too (vitest.config.ts setupFiles).
    const dotSlashAtRoot = before === '/' && text[start - 2] === '.' && !PATH_CHAR.test(text[start - 3] ?? '') && text[start - 3] !== '/' && dirOf(file) === '';
    if (before === '/' && !dotSlashAtRoot && (PATH_CHAR.test(text[start - 2] ?? '') || text[start - 2] === '/')) continue;
    const dirMention = isDir(match[0]);
    if (after && /[A-Za-z0-9_$-]/.test(after)) continue;
    if (after === '.' && /[A-Za-z0-9_]/.test(text[end + 1] ?? '')) continue;
    if (after === '/' && !dirMention) continue;
    if (codeRanges?.some(([from, to]) => start < to && from < end)) continue;
    const target = mentionTargets.get(match[0]);
    if (target === null) {
      warnings.push({ file, line: text.slice(0, start).split('\n').length, message: `mentions ${match[0]}, which this batch deletes` });
      continue;
    }
    addEdit(file, start, end, target, 'path mention');
  }
}

// Pass 2b: relative `src` and `href` attributes in HTML pages (the e2e fixture pages).
function scanHtml(file) {
  const text = readFile(file);
  const attribute = /\b(?:src|href)=(["'])(\.{1,2}\/[^"'?#]*)/g;
  for (let match = attribute.exec(text); match; match = attribute.exec(text)) {
    const value = match[2];
    const start = match.index + match[0].length - value.length;
    const target = join(dirOf(file), value);
    const moved = movedPath(target);
    const newFile = movedFile(file);
    if (moved.path === null || newFile === null) continue;
    const rel = relativeSpec(dirOf(newFile), moved.path, { trailingSlash: value.endsWith('/') });
    if (rel !== value) addEdit(file, start, start + value.length, rel, 'html attribute');
  }
}

// Pass 3: strings in code that name a moved file relative to src/app/mindroom, src/app or src.
const HEURISTIC_BASES = ['src/app/mindroom', 'src/app', 'src'];
function scanAppRelativeStrings(file) {
  const sf = parse(file);
  const visit = (node) => {
    const range = literalRange(node, sf);
    const taken = range && (edits.get(file) ?? []).some((edit) => edit.start < range.end && range.start < edit.end);
    if (range && !taken && range.value.includes('/') && /^[\w@.\-/]+\.[a-z]+$/.test(range.value) && !isRelative(range.value) && !range.value.startsWith('src/')) {
      const hits = HEURISTIC_BASES.filter((base) => moves.has(`${base}/${range.value}`) && !replaced.has(`${base}/${range.value}`));
      if (hits.length === 1) {
        const [base] = hits;
        const dest = moves.get(`${base}/${range.value}`);
        if (dest === null) warn(file, node, sf, `string ${range.value} names a file this batch deletes`);
        else if (dest.startsWith(`${base}/`)) {
          addEdit(file, range.start, range.end, dest.slice(base.length + 1), `heuristic: ${base}-relative string`);
        } else {
          const wider = HEURISTIC_BASES.find((candidate) => dest.startsWith(`${candidate}/`) && base.startsWith(candidate));
          warn(file, node, sf, `string ${range.value} names ${base}/${range.value} (moved to ${dest}); ${wider ? `relative to ${wider} it is ${dest.slice(wider.length + 1)}` : 'outside its base'}; fix by hand`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

// ---------------------------------------------------------------------------------------------
// Run the passes
// ---------------------------------------------------------------------------------------------

/** Names a module exports by its own statements; null when it also has `export * from`. */
function exportedNames(file) {
  const names = new Set();
  for (const statement of parse(file).statements) {
    if (ts.isExportDeclaration(statement)) {
      if (!statement.exportClause) return null;
      if (ts.isNamedExports(statement.exportClause)) statement.exportClause.elements.forEach((element) => names.add(element.name.text));
    } else if (ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      if (ts.isVariableStatement(statement)) statement.declarationList.declarations.forEach((declaration) => ts.isIdentifier(declaration.name) && names.add(declaration.name.text));
      else if (statement.name) names.add(statement.name.text);
      if (ts.getModifiers(statement).some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)) names.add('default');
    } else if (ts.isExportAssignment(statement)) names.add('default');
  }
  return names;
}

// A replaced file should be a re-export of the file that takes its path, under the same names;
// otherwise its importers need names the new module may not export.
for (const [shim, taker] of replaced) {
  if (!CODE.test(shim)) continue;
  const sf = parse(shim);
  for (const statement of sf.statements) {
    if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier) {
      warn(shim, statement, sf, `replaced by ${taker}, but it is not only a re-export; check what its importers used`);
      continue;
    }
    const resolved = resolveModule(shim, statement.moduleSpecifier.text);
    if (resolved?.target !== taker) warn(shim, statement, sf, `replaced by ${taker}, but it re-exports ${statement.moduleSpecifier.text}`);
    const renames = statement.exportClause && ts.isNamedExports(statement.exportClause)
      ? statement.exportClause.elements.filter((element) => element.propertyName && element.propertyName.text !== element.name.text)
      : [];
    const takerNames = CODE.test(taker) ? exportedNames(taker) : null;
    for (const element of renames.filter((element) => takerNames && !takerNames.has(element.name.text))) {
      warn(shim, element, sf, `replaced by ${taker}, which exports ${element.propertyName.text} but not ${element.name.text}, the name importers use: rename the export or the importers`);
    }
  }
}

const codeFiles = scanned.filter((file) => CODE.test(file) && moves.get(file) !== null);
// Path constants may be built from other path literals, also across files (APP_ROOT from
// TEST_DIR), so the new text of every anchored literal is settled first, then edits are taken.
planning = true;
let settled = false;
for (round = 0; round < 6 && !settled; round += 1) {
  const before = JSON.stringify([...newTextOfLiteral]);
  for (const file of codeFiles) scanCode(file);
  const after = JSON.stringify([...newTextOfLiteral]);
  settled = after === before;
  if (process.env.MOVE_DEBUG) console.error(`move: planning round ${round}: ${newTextOfLiteral.size} literals, ${settled ? 'settled' : 'changed'} (${Date.now() - started} ms)`);
}
if (!settled) warnings.push({ file: '', line: 0, message: 'path literals did not settle in 6 planning rounds; check the anchored edits' });
planning = false;
round += 1;
for (const file of codeFiles) scanCode(file);
// Deleted files must have no importer left outside the deleted set.
const deleted = new Set([...moves].filter(([, to]) => to === null).map(([from]) => from));
const deletedImporters = warnings.filter((warning) => warning.fatal && !deleted.has(warning.file));
for (const file of scanned) {
  if (moves.get(file) === null) continue;
  const codeRanges = CODE.test(file) ? (edits.get(file) ?? []).map((edit) => [edit.start, edit.end]) : null;
  if (file.endsWith('.html')) scanHtml(file);
  scanMentions(file, codeRanges);
  if (CODE.test(file) && /\.test\.|__tests__|\.spec\./.test(file)) scanAppRelativeStrings(file);
}

// ---------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------

const lineOf = (file, offset) => readFile(file).slice(0, offset).split('\n').length;
const editList = [...edits].flatMap(([file, list]) =>
  list
    .sort((a, b) => a.start - b.start)
    .map((edit) => ({
      file,
      newFile: movedFile(file),
      line: lineOf(file, edit.start),
      kind: edit.kind,
      before: edit.before,
      after: edit.text,
      laneP: isLaneP(file),
    }))
);
const moveList = [...moves].map(([from, to]) => ({ from, to, laneP: isLaneP(from) }));
const kinds = {};
for (const edit of editList) kinds[edit.kind] = (kinds[edit.kind] ?? 0) + 1;
const summary = {
  batch: opts.batch,
  rows: rows.length,
  moved: moveList.filter((move) => move.to !== null).length,
  deleted: moveList.filter((move) => move.to === null).length,
  lanePMoved: moveList.filter((move) => move.laneP && move.to !== null).length,
  lanePDeleted: moveList.filter((move) => move.laneP && move.to === null).length,
  editedFiles: edits.size,
  edits: editList.length,
  lanePEditedFiles: new Set(editList.filter((edit) => edit.laneP).map((edit) => edit.file)).size,
  editKinds: kinds,
  warnings: warnings.length,
  planMs: Date.now() - started,
};
if (opts.report) {
  fs.writeFileSync(opts.report, JSON.stringify({ summary, moves: moveList, edits: editList, warnings }, null, 1));
}
console.log(`move: ${JSON.stringify(summary)}`);
for (const warning of warnings) console.log(`move: warning: ${warning.file}:${warning.line}: ${warning.message}`);
if (deletedImporters.length) {
  fail(deletedImporters.map((warning) => `${warning.file}:${warning.line} still uses a deleted file: ${warning.message}`));
}
if (opts.dryRun) {
  for (const edit of editList) console.log(`move: edit ${edit.file}:${edit.line} [${edit.kind}] ${edit.before} => ${edit.after}`);
  process.exit(0);
}

// ---------------------------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------------------------

const touched = new Set([...moves.keys(), ...edits.keys()]);
if (!opts.allowDirty) {
  const movedDirs = rows.filter((row) => isDir(row.old)).map((row) => `${row.old}/`);
  const pathspecs = [...new Set([...touched].map((file) => dirOf(file) || '.'))];
  const entries = git('status', '--porcelain', '-z', '--untracked-files=all', '--', ...pathspecs).split('\0').filter(Boolean);
  const relevant = entries.filter((entry) => /^[ MADRCU?!]{2} /.test(entry)).filter((entry) => {
    const file = entry.slice(3);
    return touched.has(file) || movedDirs.some((dir) => file.startsWith(dir));
  });
  if (relevant.length) fail(relevant.map((entry) => `uncommitted change in a moved or edited path: ${entry}`));
}

// New contents, keyed by the old path.
const newContents = new Map();
for (const [file, list] of edits) {
  let text = readFile(file);
  for (const edit of [...list].sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  newContents.set(file, text);
}

const run = (args) => {
  const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  if (result.status !== 0) fail([`git ${args.join(' ')} failed: ${result.stderr.trim()}`]);
};

// Deletions first (a moved file may take a deleted path), then whole directories (one `git mv`
// each), then single files.
const deletions = [...moves].filter(([, to]) => to === null).map(([from]) => from);
for (let i = 0; i < deletions.length; i += 200) run(['rm', '-q', '--', ...deletions.slice(i, i + 200)]);
const movedByDir = new Set();
for (const row of [...rows].sort((a, b) => a.old.length - b.old.length)) {
  if (row.new === null || !isDir(row.old)) continue;
  const files = dirFiles.get(row.old);
  if (files.some((file) => movedByDir.has(file))) continue;
  const whole = files.every((file) => moves.get(file) === row.new + file.slice(row.old.length));
  const untracked = git('ls-files', '--others', '-z', '--', row.old).split('\0').filter(Boolean);
  if (!whole || untracked.length || fs.existsSync(path.join(repo, row.new))) continue;
  fs.mkdirSync(path.dirname(path.join(repo, row.new)), { recursive: true });
  run(['mv', '--', row.old, row.new]);
  for (const file of files) movedByDir.add(file);
}
for (const [from, to] of moves) {
  if (movedByDir.has(from) || to === null) continue;
  fs.mkdirSync(path.dirname(path.join(repo, to)), { recursive: true });
  run(['mv', '--', from, to]);
}

// Directories left empty by the moves.
const emptied = new Set([...moves.keys()].map((file) => posix.dirname(file)));
for (const dir of [...emptied].sort((a, b) => b.length - a.length)) {
  for (let current = dir; current !== '.'; current = posix.dirname(current)) {
    const absolute = path.join(repo, current);
    if (!fs.existsSync(absolute)) continue; // moved away whole by `git mv <dir>`
    if (fs.readdirSync(absolute).length) break;
    fs.rmdirSync(absolute);
  }
}

const staged = [];
for (const [file, text] of newContents) {
  const dest = movedFile(file);
  fs.writeFileSync(path.join(repo, dest), text);
  staged.push(dest);
}

// Provenance: one row per moved or deleted file, in path order.
const movesPath = path.join(repo, MOVES_FILE);
const header = fs.existsSync(movesPath) ? '' : `${MOVES_HEADER}\n`;
// Deletions before moves, so that a path a moved file takes over is dropped before it is taken.
const byPath = ([a], [b]) => (a < b ? -1 : 1);
const movesRows = [...[...moves].filter(([, to]) => to === null).sort(byPath), ...[...moves].filter(([, to]) => to !== null).sort(byPath)].map(
  ([from, to]) => `${from}\t${to ?? ''}\t${opts.batch}\n`
);
fs.appendFileSync(movesPath, header + movesRows.join(''));
staged.push(MOVES_FILE);
const droppedRows = [...moves]
  .filter(([from, to]) => to === null && isLaneP(from))
  .map(([from]) => {
    const origin = lanePByCurrent.get(from);
    const reason = replaced.has(from) ? `replaced by ${replaced.get(from)}` : opts.dropReason ?? 'dead code';
    return `${origin}\t${importWave.get(origin)}\t${reason} (${opts.batch})\n`;
  });
if (droppedRows.length) {
  fs.appendFileSync(path.join(repo, PROV, 'dropped.tsv'), droppedRows.join(''));
  staged.push(`${PROV}/dropped.tsv`);
}
for (let i = 0; i < staged.length; i += 200) run(['add', '--', ...staged.slice(i, i + 200)]);
const applyMs = Date.now() - started;
console.log(`move: applied in ${applyMs} ms (${moves.size} paths, ${staged.length} files written or staged)`);

// ---------------------------------------------------------------------------------------------
// Type-check
// ---------------------------------------------------------------------------------------------

function tsc(project) {
  const begin = Date.now();
  const result = spawnSync('npx', ['tsc', '--noEmit', '--pretty', 'false', '-p', project], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28 });
  const output = `${result.stdout}${result.stderr}`;
  const errorLines = output.split('\n').filter((line) => /error TS\d+/.test(line));
  const missing = errorLines.filter((line) => /error TS(2307|2306|2792|1192|2305|2614|2724)/.test(line));
  console.log(`move: tsc -p ${project}: exit ${result.status}, ${errorLines.length} errors (${missing.length} module or export errors) in ${Date.now() - begin} ms`);
  for (const line of missing.slice(0, 50)) console.log(`move:   ${line}`);
  return { status: result.status, errors: errorLines.length, missing: missing.length };
}
if (opts.tsc) {
  const app = tsc('tsconfig.app.json');
  if (opts.fullTsc) tsc('.');
  process.exit(app.status === 0 ? 0 : 1);
}
