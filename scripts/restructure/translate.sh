#!/usr/bin/env bash
# Carry work written at old paths into the restructured layout (docs/architecture.md, restructure).
#
# Usage: scripts/restructure/translate.sh <base> <tip> [<extra rows.tsv>]
#   base   the commit the work started from (before the moves)
#   tip    the last commit of the work
#   extra  optional `old<TAB>new` rows that override or add placements (see below)
#
# Run it in a clean checkout of the branch that holds the moves (main). The moves are the rows of
# this checkout's docs/provenance/moves.tsv that base's copy lacks, followed through chains (a
# file moved twice ends where its last row puts it). Deletions are left out, so work on a file the
# moves deleted fails to apply and needs a person; a deleted path another file moves onto (a shim
# replaced by its module) stays a deletion. Then:
#   1. two throwaway worktrees at base and tip;
#   2. in each, scripts/restructure/move.mjs --no-tsc with the rows of the files present there,
#      plus rows for files the work changes that have none and sit under a folder the moves
#      emptied: beside their subject (X.test.ts, X.css.ts, X.<aspect>.test.ts next to X), else
#      where most files of their folder went. Those rows are printed for review; a file with
#      neither stops the run until the extra rows place it. The provenance rows move.mjs appends
#      there are discarded;
#   3. the diff between the two moved trees is the work in the new layout, with every import,
#      vi.mock, import() and path string rewritten by the same code as the move itself;
#   4. `git apply --3way` of that diff here, then the app type-check, the count of vi.mock-style
#      specifiers that resolve to no file (must be 0), and `vitest related` over the changed files.
# The worktrees are removed at the end; the diff stays in a temporary directory, printed at the
# start. A conflict stops before the checks: resolve it, then run the checks by hand.
set -euo pipefail

if [ $# -lt 2 ] || [ $# -gt 3 ]; then
  sed -n '2,8p' "$0" >&2
  exit 2
fi
here=$(cd "$(dirname "$0")" && pwd)
root=$(git rev-parse --show-toplevel)
cd "$root"
base=$(git rev-parse --verify "$1^{commit}")
tip=$(git rev-parse --verify "$2^{commit}")
extra=${3:-}
if [ -n "$extra" ]; then extra=$(realpath "$extra"); fi
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo 'translate: the checkout has uncommitted changes; commit or stash them first' >&2
  exit 2
fi

tmp=$(mktemp -d "${TMPDIR:-/tmp}/translate.XXXXXX")
echo "translate: base ${base:0:10}, tip ${tip:0:10}, files in $tmp"
cleanup() {
  for side in base tip; do
    if [ -d "$tmp/$side" ]; then git worktree remove --force "$tmp/$side" >/dev/null 2>&1 || true; fi
  done
  git worktree prune
}
trap cleanup EXIT

git show "HEAD:docs/provenance/moves.tsv" >"$tmp/moves-here.tsv" 2>/dev/null || : >"$tmp/moves-here.tsv"
git show "$base:docs/provenance/moves.tsv" >"$tmp/moves-base.tsv" 2>/dev/null || : >"$tmp/moves-base.tsv"
git ls-tree -r --name-only "$base" >"$tmp/files-base.txt"
git ls-tree -r --name-only "$tip" >"$tmp/files-tip.txt"
git ls-tree -r --name-only HEAD >"$tmp/files-here.txt"
git diff --name-only --no-renames "$base" "$tip" >"$tmp/files-changed.txt"

# The rows for each side (map-base.tsv, map-tip.tsv); placements of unmapped files go to stdout.
node --input-type=module - "$tmp" "$extra" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';

const [dir, extraFile] = process.argv.slice(2);
const posix = path.posix;
const lines = (file) => fs.readFileSync(`${dir}/${file}`, 'utf8').split('\n').filter(Boolean);
const baseRows = new Set(lines('moves-base.tsv').slice(1));
const rows = lines('moves-here.tsv').slice(1).filter((row) => !baseRows.has(row)).map((row) => row.split('\t'));

// origin -> final path (null when deleted), following chains in file order.
const finalOf = new Map();
const originOf = new Map();
for (const [from, to] of rows) {
  const origin = originOf.get(from) ?? from;
  originOf.delete(from);
  finalOf.set(origin, to || null);
  if (to) originOf.set(to, origin);
}
const destinations = new Set([...finalOf.values()].filter(Boolean));

const baseFiles = lines('files-base.txt');
const tipFiles = lines('files-tip.txt');
// Only files the work changes need a place: the others are the same on both sides, so they add
// nothing to the diff wherever they sit.
const changed = lines('files-changed.txt');

// A folder is emptied when the moves took files out of it and nothing is left under it here.
const folders = (file) => {
  const list = [];
  for (let folder = posix.dirname(file); folder !== '.'; folder = posix.dirname(folder)) list.push(folder);
  return list;
};
const left = new Set(lines('files-here.txt').flatMap(folders));
const sources = new Set([...finalOf.keys()].flatMap(folders));
const emptied = (folder) => sources.has(folder) && !left.has(folder);
const placed = new Map();
const unplaced = [];
const targetOf = (file) => (finalOf.has(file) ? finalOf.get(file) : placed.get(file));
// Subjects first, so a test or stylesheet can follow a subject that was placed itself.
const isCompanion = (file) => /\.(test|css)\.|\.test\.shared\./.test(posix.basename(file));
for (const file of [...changed.filter((f) => !isCompanion(f)), ...changed.filter(isCompanion)]) {
  if (finalOf.has(file)) continue;
  if (!folders(file).some(emptied)) continue;
  const folder = posix.dirname(file);
  const base = posix.basename(file);
  const stem = base.split('.')[0];
  const subject = ['.ts', '.tsx', '.mjs', '.js']
    .map((ext) => `${folder}/${stem}${ext}`)
    .find((candidate) => candidate !== file && targetOf(candidate));
  if (subject) {
    const target = targetOf(subject);
    const newStem = posix.basename(target).split('.')[0];
    placed.set(file, `${posix.dirname(target)}/${newStem}${base.slice(stem.length)}`);
    continue;
  }
  const counts = new Map();
  for (const [origin, target] of finalOf) {
    if (target === null || posix.dirname(origin) !== folder) continue;
    counts.set(posix.dirname(target), (counts.get(posix.dirname(target)) ?? 0) + 1);
  }
  const best = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  if (best) placed.set(file, `${best[0]}/${base}`);
  else unplaced.push(file);
}
const extra = extraFile
  ? fs.readFileSync(extraFile, 'utf8').split('\n').filter((line) => line.trim() && !line.startsWith('#')).map((line) => line.split('\t'))
  : [];
for (const [from, to] of extra) {
  placed.set(from, to);
  const index = unplaced.indexOf(from);
  if (index >= 0) unplaced.splice(index, 1);
}
for (const [from, to] of placed) console.log(`translate: placed ${from}\t${to}`);
for (const file of unplaced) console.log(`translate: no placement for ${file} (give it a row in the extra rows file)`);
if (unplaced.length) process.exit(3);

for (const [side, files] of [['base', baseFiles], ['tip', tipFiles]]) {
  const present = new Set(files);
  const out = [];
  for (const [origin, target] of finalOf) {
    if (!present.has(origin)) continue;
    if (target !== null) out.push(`${origin}\t${target}`);
    else if (destinations.has(origin)) out.push(`${origin}\t-`);
  }
  for (const [from, to] of placed) if (present.has(from) && from !== to) out.push(`${from}\t${to}`);
  fs.writeFileSync(`${dir}/map-${side}.tsv`, out.length ? `${out.join('\n')}\n` : '');
  console.log(`translate: ${side}: ${out.length} rows`);
}
NODE

for side in base tip; do
  rev=$base
  if [ "$side" = tip ]; then rev=$tip; fi
  git worktree add --quiet --detach "$tmp/$side" "$rev"
  ln -s "$root/node_modules" "$tmp/$side/node_modules"
  if [ -s "$tmp/map-$side.tsv" ]; then
    node "$here/move.mjs" --repo "$tmp/$side" --map "$tmp/map-$side.tsv" --batch translate --no-tsc \
      --report "$tmp/report-$side.json" >"$tmp/move-$side.log"
    grep -E '^move: \{' "$tmp/move-$side.log" | sed "s/^/translate: $side: /" || true
    # Warnings about the files the work changes; the log has the rest.
    sed 's|^|move: warning: |; s|$|:|' "$tmp/files-changed.txt" >"$tmp/warning-prefixes.txt"
    grep -F -f "$tmp/warning-prefixes.txt" "$tmp/move-$side.log" | sed "s/^/translate: $side: /" || true
  fi
  for file in docs/provenance/moves.tsv docs/provenance/dropped.tsv; do
    if git -C "$tmp/$side" cat-file -e "HEAD:$file" 2>/dev/null; then
      git -C "$tmp/$side" checkout --quiet HEAD -- "$file"
    else
      git -C "$tmp/$side" rm --quiet --cached --ignore-unmatch -- "$file"
      rm -f "$tmp/$side/$file"
    fi
  done
  git -C "$tmp/$side" add -u
  git -C "$tmp/$side" write-tree >"$tmp/tree-$side"
done

git diff --binary -M "$(cat "$tmp/tree-base")" "$(cat "$tmp/tree-tip")" >"$tmp/translated.patch"
if [ ! -s "$tmp/translated.patch" ]; then
  echo 'translate: the work is empty in the new layout'
  exit 0
fi
git apply --stat "$tmp/translated.patch"
if ! git apply --3way "$tmp/translated.patch"; then
  echo "translate: conflicts; resolve them, then run the checks (patch: $tmp/translated.patch)" >&2
  git diff --name-only --diff-filter=U >&2
  exit 1
fi

status=0
npx tsc --noEmit -p tsconfig.app.json || status=1
stale=$(node "$here/unresolved.mjs" . | grep -cP '\tvi\.' || true)
echo "translate: vi.mock-style specifiers that resolve to no file: $stale"
if [ "$stale" != 0 ]; then status=1; fi
mapfile -t changed < <(git diff --name-only --diff-filter=ACMR HEAD -- '*.ts' '*.tsx' '*.mjs' '*.js')
if [ ${#changed[@]} -gt 0 ]; then npx vitest related --run "${changed[@]}" || status=1; fi
exit $status
