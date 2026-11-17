// @ts-check
// The client plugins MindRoom Chat's own builds ship by default, as bundled-plugins.txt pins them:
// `just build` and `npm run build:ios` (scripts/build.sh) and the container image (docker/Dockerfile)
// build them in while MINDROOM_CLIENT_PLUGINS is unset; set, even empty, it names the plugins instead.
//
//   node scripts/bundled-plugins.mjs
//     Downloads each plugin's files at its commit from GitHub into the cache
//     ($XDG_CACHE_HOME, else ~/.cache, then mindroom-chat/bundled-plugins/<repository>-<commit>),
//     installs its packages there (npm ci), and prints their directories as MINDROOM_CLIENT_PLUGINS
//     lists them. A plugin a run already installed at that commit is not downloaded again.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @typedef {{ owner: string, repository: string, commit: string }} BundledPlugin */

const LIST = fileURLToPath(new URL('../bundled-plugins.txt', import.meta.url));

/**
 * The plugins a list in bundled-plugins.txt's format names, in its order; throws on a line that
 * names no GitHub repository and full commit, and on a repository listed twice.
 * @param {string} text
 * @returns {BundledPlugin[]}
 */
export const parseBundledPlugins = (text) => {
  /** @type {BundledPlugin[]} */
  const plugins = [];
  text.split('\n').forEach((line, index) => {
    const fields = line
      .replace(/(^|\s)#.*$/, '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (fields.length === 0) return;
    const [url = '', commit = ''] = fields;
    const match = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(url);
    if (!match || fields.length !== 2 || !/^[0-9a-f]{40}$/.test(commit)) {
      throw new Error(
        `bundled-plugins.txt:${
          index + 1
        }: expected "https://github.com/<owner>/<repository> <full commit SHA>", got "${line.trim()}"`
      );
    }
    const [, owner = '', repository = ''] = match;
    if (plugins.some((plugin) => plugin.repository === repository)) {
      throw new Error(`bundled-plugins.txt:${index + 1}: ${repository} is listed twice`);
    }
    plugins.push({ owner, repository, commit });
  });
  return plugins;
};

/**
 * Downloads and installs `plugin` under `cache` unless it is there; returns its directory.
 * @param {BundledPlugin} plugin
 * @param {string} cache
 */
const install = async ({ owner, repository, commit }, cache) => {
  const dir = path.join(cache, `${repository}-${commit}`);
  if (existsSync(dir)) return dir;
  // Downloaded and installed beside its place, and moved there once complete, so a failed or
  // concurrent run never leaves a half-installed plugin where the next run would take it.
  const partial = `${dir}.partial-${process.pid}`;
  rmSync(partial, { recursive: true, force: true });
  mkdirSync(partial, { recursive: true });
  try {
    const url = `https://codeload.github.com/${owner}/${repository}/tar.gz/${commit}`;
    console.error(`bundled-plugins: ${owner}/${repository} at ${commit}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`bundled-plugins: ${url}: HTTP ${response.status}`);
    const archive = Buffer.from(await response.arrayBuffer());
    execFileSync('tar', ['-xz', '--strip-components=1', '-C', partial], { input: archive });
    // stdout carries only the list; npm's output goes to stderr.
    execFileSync('npm', ['ci', '--no-audit', '--no-fund'], {
      cwd: partial,
      stdio: ['ignore', 2, 2],
    });
    renameSync(partial, dir);
  } catch (error) {
    rmSync(partial, { recursive: true, force: true });
    if (!existsSync(dir)) throw error;
  }
  return dir;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cache = path.join(
    process.env.XDG_CACHE_HOME || path.join(homedir(), '.cache'),
    'mindroom-chat',
    'bundled-plugins'
  );
  const dirs = [];
  for (const plugin of parseBundledPlugins(readFileSync(LIST, 'utf8'))) {
    // One at a time: npm ci of several plugins at once contends for npm's cache.
    dirs.push(await install(plugin, cache));
  }
  process.stdout.write(`${dirs.join(',')}\n`);
}
