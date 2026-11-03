// @ts-check
// Build and release identifiers for the bundle, read from deployment environments and Git.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
 * The release of the checkout in `cwd`, like `git describe` over the release tags of the
 * package version (`v<version>-mindroom.<n>`).
 * @param {Record<string, string | undefined>} env
 * @param {string | undefined} [cwd]
 * @returns {string}
 */
export const readReleaseVersion = (env, cwd = process.cwd()) => {
  const packageVersion = readPackageVersion(cwd);
  const described = git(
    ['describe', '--tags', '--match', `v${packageVersion}-mindroom.*`, '--abbrev=7'],
    cwd
  );
  return resolveReleaseVersion(env, packageVersion, described);
};

/**
 * @param {Record<string, string | undefined>} env
 * @param {string | undefined} [cwd]
 */
export const readBuildVersion = (env, cwd) => resolveBuildVersion(env, readGitCommit(cwd));

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  process.stdout.write(
    `${JSON.stringify({
      version: readBuildVersion(process.env, root) ?? null,
      release: readReleaseVersion(process.env, root),
    })}\n`
  );
}
