// Type-check with the stricter flags of config/tsconfig.strict.json and fail only on errors in Lane C
// files. Lane P files (the docs/provenance/portable*.tsv lists, at the paths
// docs/provenance/moves.tsv gives them now) keep their ported logic, so their errors are counted
// and ignored.
//
// Usage: node scripts/strict-check.mjs [--from <file with tsc output>]
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { lanePPaths } = createRequire(import.meta.url)('./provenance-paths.cjs');

/** Current paths (relative to the repository root) of the files in every portable list. */
export function readLanePPaths(root = repoRoot) {
  return new Set(lanePPaths(root).keys());
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
    ['tsc', '--noEmit', '--pretty', 'false', '-p', 'config/tsconfig.strict.json'],
    { cwd: repoRoot, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }
  );
  if (result.error) throw result.error;
  // tsc exits 0 without errors and 1 or 2 with them; anything else (out of memory, a signal) means
  // it never finished, and its output must not pass for a list of diagnostics.
  if (result.signal || ![0, 1, 2].includes(result.status ?? -1)) {
    process.stderr.write(result.stderr);
    throw new Error(
      `tsc did not finish (exit ${result.status ?? 'none'}, signal ${result.signal ?? 'none'})`
    );
  }
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
