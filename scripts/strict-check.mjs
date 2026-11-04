// Type-check with the stricter flags of tsconfig.strict.json and fail only on errors in Lane C
// files. Lane P files (the docs/provenance/portable*.tsv lists) keep their ported logic, so their
// errors are counted and ignored.
//
// Usage: node scripts/strict-check.mjs [--from <file with tsc output>]
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Paths (relative to the repository root) named in the first column of every portable list. */
export function readLanePPaths(root = repoRoot) {
  const provenance = path.join(root, 'docs', 'provenance');
  const lists = readdirSync(provenance).filter((name) => /^portable.*\.tsv$/.test(name));
  const paths = new Set();
  for (const list of lists) {
    for (const row of readFileSync(path.join(provenance, list), 'utf8').split('\n')) {
      const [file] = row.split('\t');
      if (file) paths.add(file);
    }
  }
  return paths;
}

// `src/a.ts(12,3): error TS6133: ...` starts a diagnostic; indented lines continue it.
const DIAGNOSTIC_START = /^(?<file>[^\s(][^(]*)\(\d+,\d+\): error TS\d+:/;

/**
 * Groups `tsc --pretty false` output into diagnostics and sorts them by lane. A diagnostic
 * without a file (a configuration error) counts as Lane C, so it always fails the check.
 */
export function splitByLane(output, lanePPaths) {
  const laneC = [];
  const laneP = [];
  let current = null;
  for (const line of output.split('\n')) {
    if (current && /^\s/.test(line)) {
      current.text += `\n${line}`;
      continue;
    }
    if (!line.trim()) {
      current = null;
      continue;
    }
    const file = DIAGNOSTIC_START.exec(line)?.groups?.file;
    current = { file: file ?? null, text: line };
    const normalized = file ? path.normalize(file).split(path.sep).join('/') : null;
    (normalized && lanePPaths.has(normalized) ? laneP : laneC).push(current);
  }
  return { laneC, laneP };
}

function runTsc() {
  const result = spawnSync(
    'npx',
    ['tsc', '--noEmit', '--pretty', 'false', '-p', 'tsconfig.strict.json'],
    { cwd: repoRoot, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }
  );
  if (result.error) throw result.error;
  return `${result.stdout}${result.stderr}`;
}

function main(argv) {
  const fromIndex = argv.indexOf('--from');
  const output = fromIndex >= 0 ? readFileSync(argv[fromIndex + 1], 'utf8') : runTsc();
  const { laneC, laneP } = splitByLane(output, readLanePPaths());
  for (const diagnostic of laneC) console.log(diagnostic.text);
  const files = new Set(laneC.map((diagnostic) => diagnostic.file)).size;
  console.log(
    `strict-check: ${laneC.length} Lane C errors in ${files} files; ` +
      `${laneP.length} Lane P errors ignored`
  );
  return laneC.length === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
