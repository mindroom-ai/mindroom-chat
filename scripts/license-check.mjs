// Usage: node scripts/license-check.mjs [node_modules]
//
// Fails (exit 1) and prints `name@version license` for every installed package whose license is
// not on the allowlist (Global Constraints) or that declares none, in node_modules and in the
// node_modules of each client plugin that MINDROOM_CLIENT_PLUGINS lists. An SPDX `OR` expression
// passes when one side is allowed, `AND` needs both sides, `WITH <exception>` is judged by the
// license.
// Exit 2 means the directory could not be read.
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { readClientPlugins } from './client-plugins.mjs';

const ALLOWED = new Set(
  [
    'MIT',
    'Apache-2.0',
    'BSD-2-Clause',
    'BSD-3-Clause',
    'ISC',
    '0BSD',
    'Zlib',
    'Unicode-DFS-2016',
    'Unicode-3.0',
    'CC0-1.0',
    'BlueOak-1.0.0',
    'OFL-1.1',
    'MPL-2.0',
    'Python-2.0',
    // Public-domain dedication (big-integer, stream-buffers under @capacitor/cli).
    'Unlicense',
  ].map((id) => id.toLowerCase())
);

// Packages accepted by name, with the reason. Keep this table small.
const EXCEPTIONS = {
  'require-like': 'MIT license text ships in the package; package.json has no license field',
  'caniuse-lite': 'CC-BY-4.0 browser data used by build tooling only, never shipped in the bundle',
  jsonify: 'Public Domain (no SPDX id); dev-only, pulled in by @capacitor/cli, never shipped',
};

// SPDX expression grammar: or := and (OR and)*; and := atom (AND atom)*; atom := '(' or ')' | id [WITH id].
function isAllowedExpression(expression) {
  const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? [];
  let position = 0;
  const peek = () => tokens[position];
  const keyword = (word) => peek()?.toUpperCase() === word;

  function parseOr() {
    let result = parseAnd();
    while (keyword('OR')) {
      position += 1;
      const right = parseAnd();
      result = result || right;
    }
    return result;
  }

  function parseAnd() {
    let result = parseAtom();
    while (keyword('AND')) {
      position += 1;
      const right = parseAtom();
      result = result && right;
    }
    return result;
  }

  function parseAtom() {
    const token = peek();
    if (token === undefined) throw new Error('unexpected end');
    position += 1;
    if (token === '(') {
      const result = parseOr();
      if (peek() !== ')') throw new Error('missing )');
      position += 1;
      return result;
    }
    if (token === ')' || ['AND', 'OR', 'WITH'].includes(token.toUpperCase())) {
      throw new Error(`unexpected ${token}`);
    }
    if (keyword('WITH')) {
      position += 1;
      if (peek() === undefined) throw new Error('missing exception id');
      position += 1;
    }
    return ALLOWED.has(token.replace(/\+$/, '').toLowerCase());
  }

  try {
    const result = parseOr();
    return position === tokens.length && result;
  } catch {
    return false;
  }
}

function licenseOf(manifest) {
  const { license, licenses } = manifest;
  if (typeof license === 'string' && license.trim()) return license.trim();
  if (typeof license?.type === 'string' && license.type.trim()) return license.type.trim();
  if (Array.isArray(licenses)) {
    // Legacy field. npm itself reads an array as any one of the entries (`A OR B`).
    const types = licenses
      .map((entry) => (typeof entry === 'string' ? entry : entry?.type))
      .filter((type) => typeof type === 'string' && type.trim())
      .map((type) => type.trim());
    if (types.length === 1) return types[0];
    if (types.length > 1) return `(${types.join(' OR ')})`;
  }
  return undefined;
}

const isDirectory = (dir) => {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
};

// Every package directory under a node_modules directory, including scoped and nested ones.
function* packageDirs(nodeModules, seen) {
  const real = realpathSync(nodeModules);
  if (seen.has(real)) return;
  seen.add(real);
  for (const entry of readdirSync(nodeModules).sort()) {
    if (entry.startsWith('.')) continue;
    const dir = path.join(nodeModules, entry);
    if (!isDirectory(dir)) continue;
    const candidates = entry.startsWith('@')
      ? readdirSync(dir)
          .sort()
          .map((name) => path.join(dir, name))
      : [dir];
    for (const candidate of candidates) {
      if (!isDirectory(candidate)) continue;
      yield candidate;
      const nested = path.join(candidate, 'node_modules');
      if (isDirectory(nested)) yield* packageDirs(nested, seen);
    }
  }
}

function main() {
  const nodeModules = path.resolve(process.argv[2] ?? 'node_modules');
  if (!isDirectory(nodeModules)) {
    console.error(`license-check: ${nodeModules} is not a directory`);
    process.exit(2);
  }

  const offenders = new Set();
  const excepted = new Set();
  let checked = 0;
  const check = (modules, suffix = '') => {
    for (const dir of packageDirs(modules, new Set())) {
      const manifestPath = path.join(dir, 'package.json');
      if (!existsSync(manifestPath)) {
        offenders.add(`${path.relative(modules, dir)}@? (no package.json)${suffix}`);
        continue;
      }
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      const name = manifest.name ?? path.basename(dir);
      const id = `${name}@${manifest.version ?? '?'}`;
      const license = licenseOf(manifest);
      checked += 1;
      if (Object.hasOwn(EXCEPTIONS, name)) {
        excepted.add(id);
      } else if (license === undefined || !isAllowedExpression(license)) {
        offenders.add(`${id} ${license ?? '(no license)'}${suffix}`);
      }
    }
  };
  check(nodeModules);
  for (const { id, dir } of readClientPlugins(process.env.MINDROOM_CLIENT_PLUGINS)) {
    const modules = path.join(dir, 'node_modules');
    if (isDirectory(modules)) check(modules, ` (client plugin ${id})`);
  }

  if (offenders.size > 0) {
    console.log([...offenders].sort().join('\n'));
    console.error(
      `license-check: ${offenders.size} of ${checked} packages are not on the allowlist`
    );
    process.exit(1);
  }
  const exceptionNote =
    excepted.size > 0 ? ` (named exceptions: ${[...excepted].sort().join(', ')})` : '';
  console.log(`license-check: ${checked} packages, all allowed${exceptionNote}`);
}

main();
