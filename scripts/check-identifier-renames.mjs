// Proves that identifier renames left Lane P code alone otherwise (docs/provenance.md, AGENTS.md).
//
// docs/provenance/identifier-renames.tsv lists renamed identifiers: old name, new name, kind. A
// commit that adds rows to it renames those names; a commit that removes rows (a revert) renames
// them back. For every such commit, each Lane P line it changes must equal the line before with
// the commit's renames applied to whole words (`import { x as x }` and `{ x: x }`, which a rename
// can leave, count as `{ x }`), or differ from it token by token only in old names turned into
// their new ones. Lane P files are those of the portable lists, carried through
// docs/provenance/moves.tsv as of the commit's parent.
//
// Usage: node scripts/check-identifier-renames.mjs [--repo <checkout>]
// Exit status 1 when a line differs otherwise; a shallow clone without the commits is reported.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const TABLE = 'docs/provenance/identifier-renames.tsv';

const escape = (name) => name.replace(/[$]/g, '\\$');

/** Rows of the table (old, new) from its text, the header skipped. */
export function parseTable(text) {
  return text
    .split('\n')
    .slice(1)
    .filter((line) => line.trim())
    .map((line) => {
      const [from, to] = line.split('\t');
      return [from, to];
    });
}

/** Applies renames to whole words of a line; longer names first, so no name eats another. */
export function applyRenames(line, renames) {
  if (!renames.size) return line;
  const names = [...renames.keys()].sort((a, b) => b.length - a.length).map(escape);
  const pattern = new RegExp(`(?<![\\w$])(${names.join('|')})(?![\\w$])`, 'g');
  return line.replace(pattern, (name) => renames.get(name));
}

/** `{ x as x }` and `{ x: x }` written as `{ x }`. */
export function normalize(line) {
  return line
    .replace(/(?<![\w$])([A-Za-z_$][\w$]*) as \1(?![\w$])/g, '$1')
    .replace(/(?<![\w$.])([A-Za-z_$][\w$]*): \1(?![\w$])/g, '$1');
}

const tokens = (line) => line.match(/[A-Za-z_$][\w$]*|\s+|./g) ?? [];

/**
 * Whether a changed line pair is only a rename: token by token, every difference is an old name
 * turned into its new one, or `x as old` (an import or export specifier) and `x: old` (a
 * destructured key) collapsed to `x` where old is renamed to x. Other occurrences may keep their
 * name, as a mock object's property beside a renamed key does.
 */
export function onlyRenamed(before, after, renames) {
  const a = tokens(before);
  const b = tokens(after);
  const identifier = /^[A-Za-z_$][\w$]*$/;
  // A token stays, or turns into its new name.
  const matches = (token, target) => token === target || renames.get(token) === target;
  const collapses = (i, j, separator) =>
    identifier.test(a[i]) &&
    matches(a[i], b[j]) &&
    separator.every((token, k) => a[i + 1 + k] === token) &&
    identifier.test(a[i + 1 + separator.length] ?? '') &&
    matches(a[i + 1 + separator.length], b[j]);
  const memo = new Map();
  const align = (i, j) => {
    if (i === a.length || j === b.length) return i === a.length && j === b.length;
    const key = i * (b.length + 1) + j;
    if (!memo.has(key)) {
      memo.set(
        key,
        (matches(a[i], b[j]) && align(i + 1, j + 1)) ||
          (collapses(i, j, [' ', 'as', ' ']) && align(i + 5, j + 1)) ||
          (collapses(i, j, [':', ' ']) && align(i + 4, j + 1))
      );
    }
    return memo.get(key);
  };
  return align(0, 0);
}

/** Pairs the removed and added lines of each hunk of a unified diff with no context. */
export function changedLinePairs(diff) {
  const pairs = [];
  let file;
  let removed = [];
  let added = [];
  let line = 0;
  const flush = () => {
    if (removed.length || added.length) pairs.push({ file, line, removed, added });
    removed = [];
    added = [];
  };
  for (const text of diff.split('\n')) {
    if (text.startsWith('+++ ')) {
      flush();
      file = text.startsWith('+++ b/') ? text.slice(6) : undefined;
    } else if (text.startsWith('--- ')) {
      flush();
    } else if (text.startsWith('@@')) {
      flush();
      line = Number(/\+(\d+)/.exec(text)?.[1] ?? 0);
    } else if (text.startsWith('-')) {
      removed.push(text.slice(1));
    } else if (text.startsWith('+')) {
      added.push(text.slice(1));
    }
  }
  flush();
  return pairs;
}

// ---------------------------------------------------------------------------------------------

function laneP(git, rev) {
  const show = (file) => {
    try {
      return git('show', `${rev}:${file}`);
    } catch {
      return '';
    }
  };
  const listed = new Map();
  for (const name of git('ls-tree', '--name-only', `${rev}:docs/provenance`).split('\n')) {
    if (!/^portable.*\.tsv$/.test(name)) continue;
    for (const row of show(`docs/provenance/${name}`).split('\n')) {
      const file = row.split('\t')[0];
      if (file) listed.set(file, file);
    }
  }
  for (const row of show('docs/provenance/moves.tsv').split('\n').slice(1)) {
    const [from, to] = row.split('\t');
    if (!from || !listed.has(from)) continue;
    listed.delete(from);
    if (to) listed.set(to, from);
  }
  return new Set(listed.keys());
}

function main() {
  const args = process.argv.slice(2);
  const repoIndex = args.indexOf('--repo');
  const repo = path.resolve(
    repoIndex >= 0
      ? args[repoIndex + 1]
      : path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
  );
  const git = (...gitArgs) =>
    execFileSync('git', ['-C', repo, ...gitArgs], {
      encoding: 'utf8',
      maxBuffer: 1 << 30,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  if (git('rev-parse', '--is-shallow-repository').trim() === 'true') {
    console.log(
      `identifier-renames: shallow clone, the commits that changed ${TABLE} may be missing`
    );
  }
  const commits = git('log', '--format=%H', '--', TABLE).split('\n').filter(Boolean);
  let checked = 0;
  const failures = [];
  for (const commit of commits) {
    const parents = git('rev-list', '--parents', '-n', '1', commit).trim().split(' ').slice(1);
    if (parents.length !== 1) continue;
    const [parent] = parents;
    const rowsOf = (rev) => {
      try {
        return parseTable(git('show', `${rev}:${TABLE}`));
      } catch {
        return [];
      }
    };
    const before = new Set(rowsOf(parent).map((row) => row.join('\t')));
    const after = new Set(rowsOf(commit).map((row) => row.join('\t')));
    const renames = new Map();
    for (const row of after) if (!before.has(row)) renames.set(...row.split('\t'));
    for (const row of before) {
      if (after.has(row)) continue;
      const [from, to] = row.split('\t');
      renames.set(to, from);
    }
    const lanePFiles = laneP(git, parent);
    const diff = git(
      'diff',
      '-U0',
      '--no-color',
      '--no-renames',
      parent,
      commit,
      '--',
      ...[...lanePFiles]
    );
    for (const pair of changedLinePairs(diff)) {
      if (!pair.file || !lanePFiles.has(pair.file)) continue;
      checked += pair.added.length;
      const same =
        pair.removed.length === pair.added.length &&
        pair.removed.every((line, index) => onlyRenamed(line, pair.added[index], renames));
      if (!same) failures.push(`${commit.slice(0, 10)} ${pair.file}:${pair.line}`);
    }
  }
  for (const failure of failures) console.log(`identifier-renames: not only a rename: ${failure}`);
  console.log(
    `identifier-renames: ${commits.length} rename commit(s), ${checked} Lane P lines checked, ${failures.length} not only renames`
  );
  if (failures.length) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
