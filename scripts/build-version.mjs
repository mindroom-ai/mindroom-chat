// @ts-check
// Build and release identifiers for the bundle, read from deployment environments and Git.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RELEASE_TAG_GLOB } from './calver.mjs';
import { readClientPlugins } from './client-plugins.mjs';

const COMMIT_HASH = /^[0-9a-f]{7,64}$/i;

/** @param {string | undefined} value */
const clean = (value) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

/** @param {string | undefined} value */
const commitHash = (value) => {
  const trimmed = clean(value);
  return trimmed && COMMIT_HASH.test(trimmed) ? trimmed : undefined;
};

/**
 * The version a build reports (and the service worker URL carries): an explicit
 * `MINDROOM_BUILD_VERSION`, else a provider's commit hash (Netlify `COMMIT_REF`, GitHub
 * `GITHUB_SHA`), else the checked-out commit, else a Netlify deploy ID.
 * @param {Record<string, string | undefined>} env
 * @param {string | undefined} [gitCommit]
 * @returns {string | undefined}
 */
export const resolveBuildVersion = (env, gitCommit) =>
  clean(env.MINDROOM_BUILD_VERSION) ??
  commitHash(env.COMMIT_REF) ??
  commitHash(env.GITHUB_SHA) ??
  commitHash(gitCommit) ??
  clean(env.DEPLOY_ID);

/**
 * The release name: an explicit `MINDROOM_RELEASE_VERSION`, else the described release tag,
 * else `v` and the package version.
 * @param {Record<string, string | undefined>} env
 * @param {string} packageVersion
 * @param {string | undefined} describedTag
 * @returns {string}
 */
export const resolveReleaseVersion = (env, packageVersion, describedTag) =>
  clean(env.MINDROOM_RELEASE_VERSION) ?? clean(describedTag) ?? `v${packageVersion}`;

/**
 * @param {string[]} args
 * @param {string | undefined} cwd
 * @returns {string | undefined}
 */
const git = (args, cwd) => {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return undefined;
  }
};

/** @param {string | undefined} [cwd] */
export const readGitCommit = (cwd) => clean(git(['rev-parse', 'HEAD'], cwd));

/** @param {string | undefined} [cwd] */
export const readPackageVersion = (cwd = process.cwd()) =>
  String(JSON.parse(readFileSync(path.join(cwd, 'package.json'), 'utf8')).version);

/**
 * The release of the checkout in `cwd`: `git describe` over the calendar version tags
 * (`vYYYY.M.N`, scripts/calver.mjs), so a commit after `v2026.11.3` reads
 * `v2026.11.3-4-g1a2b3c4`.
 * @param {Record<string, string | undefined>} env
 * @param {string | undefined} [cwd]
 * @returns {string}
 */
export const readReleaseVersion = (env, cwd = process.cwd()) => {
  const described = git(['describe', '--tags', '--match', RELEASE_TAG_GLOB, '--abbrev=7'], cwd);
  return resolveReleaseVersion(env, readPackageVersion(cwd), described);
};

/** What a build is made from; package-lock.json stands for node_modules. */
const SOURCE_PATHS = [
  'index.html',
  'package.json',
  'package-lock.json',
  'vite.config.js',
  'patches',
  'public',
  'scripts',
  'src',
];

/**
 * Adds the file or directory `relative` in `root` to `hash`: each file's path and contents, in name
 * order, without the entries `skip` names.
 * @param {import('node:crypto').Hash} hash
 * @param {string} root
 * @param {string} relative
 * @param {ReadonlySet<string>} [skip]
 */
const addFiles = (hash, root, relative, skip = new Set()) => {
  const full = path.join(root, relative);
  const stats = statSync(full, { throwIfNoEntry: false });
  if (stats?.isDirectory()) {
    readdirSync(full)
      .filter((name) => !skip.has(name))
      .sort()
      .forEach((name) => addFiles(hash, root, path.posix.join(relative, name), skip));
  } else if (stats?.isFile()) {
    hash.update(`${relative}\0`).update(readFileSync(full)).update('\0');
  }
};

/**
 * `source-` and a digest of the files a build is made from: the same files give the same version,
 * any change another.
 * @param {string} cwd
 * @returns {string}
 */
export const readSourceVersion = (cwd) => {
  const hash = createHash('sha256');
  SOURCE_PATHS.forEach((relative) => addFiles(hash, cwd, relative));
  return `source-${hash.digest('hex').slice(0, 16)}`;
};

/**
 * What a plugin's digest leaves out: its installed packages, for which its lockfile stands, Git's
 * data, and the app it links in (`.mindroom-chat`, docs/development.md), which the version names.
 */
const PLUGIN_SKIP = new Set(['node_modules', '.git', '.mindroom-chat']);

/**
 * The build version (resolveBuildVersion). A checkout without Git or provider variables (an
 * archive, a container build that leaves `.git` out) is named after its sources, so its pages
 * still tell a deployment from their own build (src/app/config/appUpdate.ts). A build with client
 * plugins (MINDROOM_CLIENT_PLUGINS) adds `-plugins-` and a digest of their files in their order, so
 * a build whose only change is its plugins is a new version too.
 * @param {Record<string, string | undefined>} env
 * @param {string | undefined} [cwd]
 * @returns {string}
 */
export const readBuildVersion = (env, cwd) => {
  const version =
    resolveBuildVersion(env, readGitCommit(cwd)) ?? readSourceVersion(cwd ?? process.cwd());
  const plugins = readClientPlugins(env.MINDROOM_CLIENT_PLUGINS);
  if (plugins.length === 0) return version;
  const hash = createHash('sha256').update(`${version}\0`);
  plugins.forEach(({ dir }) => addFiles(hash, dir, '.', PLUGIN_SKIP));
  const suffix = `-plugins-${hash.digest('hex').slice(0, 16)}`;
  // Pages take a published version of at most 128 characters (src/app/config/appVersion.ts); the
  // digest covers the whole version, so a long one cut short still tells builds apart.
  return `${version.slice(0, 128 - suffix.length)}${suffix}`;
};

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  process.stdout.write(
    `${JSON.stringify({
      version: readBuildVersion(process.env, root),
      release: readReleaseVersion(process.env, root),
    })}\n`
  );
}
