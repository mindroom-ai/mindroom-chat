// Current paths of the provenance lists. The portable lists (docs/provenance/portable*.tsv) and
// seams.tsv keep the path each file had when it was imported or inventoried; files moved later are
// listed in docs/provenance/moves.tsv (old path, new path, batch), one row per file in the order
// of the moves, with an empty new path for a deleted file. This module carries every listed path
// through those rows to where the file is now, so tools that sort files by lane keep working.
//
// Usage: node scripts/provenance-paths.cjs lane <path>...    the lane of each path
//        node scripts/provenance-paths.cjs lane-p [<list>...] current Lane P paths (default: every portable list)
/* eslint-env node */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PROV = path.join('docs', 'provenance');

/** Tab-separated rows of a provenance file, or none when it does not exist. */
function readRows(root, name) {
  const file = path.join(root, PROV, name);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((row) => row.split('\t'));
}

/** Carries each listed path through docs/provenance/moves.tsv: current path -> listed path. */
function currentPaths(root, listed) {
  const current = new Map(listed.map((file) => [file, file]));
  for (const [from, to] of readRows(root, 'moves.tsv').slice(1)) {
    if (!current.has(from)) continue;
    const origin = current.get(from);
    current.delete(from);
    if (to) current.set(to, origin);
  }
  return current;
}

/** Lane P files where they are now, mapped to their import-time paths (default: every portable list). */
function lanePPaths(root = ROOT, lists) {
  const names =
    lists ?? fs.readdirSync(path.join(root, PROV)).filter((name) => /^portable.*\.tsv$/.test(name));
  const listed = names.flatMap((name) => readRows(root, path.basename(name)).map(([file]) => file));
  return currentPaths(root, listed.filter(Boolean));
}

/** Seams where they are now, mapped to their paths in docs/provenance/seams.tsv. */
function seamPaths(root = ROOT) {
  return currentPaths(
    root,
    readRows(root, 'seams.tsv')
      .map(([file]) => file)
      .filter(Boolean)
  );
}

if (require.main === module) {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'lane-p') {
    for (const file of [...lanePPaths(ROOT, args.length ? args : undefined).keys()].sort()) {
      console.log(file);
    }
  } else if (command === 'lane' && args.length) {
    const laneP = lanePPaths();
    const seams = seamPaths();
    for (const arg of args) {
      const file = path.relative(ROOT, path.resolve(arg)).split(path.sep).join('/');
      const lane = laneP.has(file)
        ? `Lane P (imported as ${laneP.get(file)})`
        : seams.has(file)
        ? `Lane C seam (listed as ${seams.get(file)})`
        : 'Lane C';
      console.log(`${file}\t${lane}`);
    }
  } else {
    console.error('usage: provenance-paths.cjs lane <path>... | lane-p [<portable list>...]');
    process.exit(2);
  }
}

module.exports = { lanePPaths, seamPaths };
