// @ts-check
// React Compiler (babel-plugin-react-compiler) pilot configuration shared by vite.config.js and
// vitest.config.ts so builds, dev server, and unit tests all compile the exact same pilot folders.
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import babel from '@rolldown/plugin-babel';
import { reactCompilerPreset } from '@vitejs/plugin-react';

export const REACT_COMPILER_PILOT_DIRS = ['src/app/command-palette', 'src/app/subagents'];

const REPO_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const REAL_REPO_ROOT = (() => {
  try {
    return realpathSync(REPO_ROOT);
  } catch {
    return REPO_ROOT;
  }
})();

const PILOT_ID_REGEX = new RegExp(
  `[/\\\\](?:${REACT_COMPILER_PILOT_DIRS.map((dir) => dir.replace(/\//g, '[/\\\\]')).join('|')})[/\\\\].*\\.tsx?(?:$|\\?)`
);
const EXCLUDED_ID_PATTERNS = [
  /[/\\]node_modules[/\\]/,
  /\.css\.ts(?:$|\?)/,
  /\.test\.tsx?(?:$|\?)/,
  /[/\\]__fixtures__[/\\]/,
];

/**
 * Compiler `sources` predicate: true only for production TypeScript/TSX modules inside the pilot
 * folders (excluding tests, vanilla-extract stylesheets, and test fixtures).
 * @param {string} filename
 * @returns {boolean}
 */
export function isReactCompilerPilotFile(filename) {
  const clean = filename.split('?', 1)[0];
  if (!clean || !/\.tsx?$/.test(clean)) return false;
  if (EXCLUDED_ID_PATTERNS.some((pattern) => pattern.test(clean))) return false;
  const resolved = path.resolve(clean);
  const candidates = [resolved];
  try {
    const real = realpathSync(resolved);
    if (real !== resolved) candidates.push(real);
  } catch {
    // Virtual or not-yet-written path; keep the resolved path only.
  }
  for (const candidate of candidates) {
    for (const root of [REPO_ROOT, REAL_REPO_ROOT]) {
      const rel = path.relative(root, candidate).split(path.sep).join('/');
      if (REACT_COMPILER_PILOT_DIRS.some((dir) => rel === dir || rel.startsWith(`${dir}/`))) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Creates the `@rolldown/plugin-babel` instance running `babel-plugin-react-compiler` on the pilot
 * folders via `@vitejs/plugin-react`'s `reactCompilerPreset`.
 *
 * Pass `{ forTests: true }` in Vitest: `reactCompilerPreset` defaults to
 * `env.config.consumer === 'client'`, which skips Vitest's server/SSR transform environment.
 * @param {{ forTests?: boolean }} [options]
 */
export function createReactCompilerPlugin({ forTests = false } = {}) {
  const preset = reactCompilerPreset({
    target: '19',
    sources: isReactCompilerPilotFile,
  });
  preset.rolldown = {
    ...preset.rolldown,
    filter: {
      ...preset.rolldown.filter,
      // Pre-filter module ids in Rolldown so Babel is only invoked for the pilot folders;
      // the compiler's own `sources` option enforces the exact same boundary inside Babel.
      id: {
        include: [PILOT_ID_REGEX],
        exclude: EXCLUDED_ID_PATTERNS,
      },
    },
    ...(forTests ? { applyToEnvironmentHook: () => true } : {}),
  };
  return babel({ presets: [preset] });
}
