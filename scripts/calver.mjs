// @ts-check
// Calendar versions. A release is a tag `vYYYY.M.N`: the UTC year and month it was cut in, and N
// counting that month's releases from 0, as the MindRoom backend's tags do. Apple takes YYYY.M.N
// as an app version, and every such version sorts above the 4.12.x of earlier App Store builds.
// docs/ios-release.md describes the scheme and the release flow.
//
//   node scripts/calver.mjs next [--date YYYY-MM-DD]
//       prints the tag the next release gets, from the tags of the checkout (fetch them first)
//   node scripts/calver.mjs latest
//       prints the newest release tag of the checkout (.github/workflows/image.yml points the
//       container image's `latest` only at that release)
//   node scripts/calver.mjs release [<commit>] --main <ref> [--dry-run] [--yes] [--date YYYY-MM-DD]
//       tags a commit of main (default: <ref> itself) with the next version and publishes its
//       GitHub release, with notes from the commits since the last release; shows the plan and
//       asks first (`just release`)
//   node scripts/calver.mjs auto <commit> --main <ref> [--date YYYY-MM-DD]
//       the same without asking, when package.json says "autoRelease": true; with false,
//       says that automatic releases are off and does nothing (.github/workflows/release.yml)
//
// `gh release create` makes the release and, with it, the tag on GitHub (lightweight, at the
// commit). GITHUB_REPOSITORY names the repository, as in GitHub Actions; the default is
// mindroom-ai/mindroom-chat. In GitHub Actions, the tag of a release it creates goes to
// GITHUB_OUTPUT as `tag`, for the Release workflow's image job.
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const RELEASE_TAG = /^v(\d{4})\.([1-9]|1[0-2])\.(0|[1-9]\d*)$/;

/** A `git describe --match` pattern for release tags (a glob: it also lets leading zeros through). */
export const RELEASE_TAG_GLOB = 'v[0-9][0-9][0-9][0-9].[0-9]*.[0-9]*';

export const DEFAULT_REPOSITORY = 'mindroom-ai/mindroom-chat';

/** Release notes list this many commits and count the rest. */
export const MAX_LISTED_COMMITS = 200;

/** The tracked file whose top-level `autoRelease` boolean switches automatic releases on. */
export const RELEASE_CONFIG_FILE = 'package.json';

/** @typedef {{ year: number; month: number; n: number }} CalendarVersion */
/** @typedef {{ hash: string; subject: string }} Commit */

/**
 * The version of a release tag, or undefined for any other tag.
 * @param {string} tag
 * @returns {CalendarVersion | undefined}
 */
export const parseReleaseTag = (tag) => {
  const match = RELEASE_TAG.exec(tag.trim());
  return match
    ? { year: Number(match[1]), month: Number(match[2]), n: Number(match[3]) }
    : undefined;
};

/** @param {CalendarVersion} version */
export const formatVersion = ({ year, month, n }) => `${year}.${month}.${n}`;

/**
 * @param {CalendarVersion} a
 * @param {CalendarVersion} b
 */
const compareVersions = (a, b) => a.year - b.year || a.month - b.month || a.n - b.n;

/**
 * The newest release tag among `tags`; other tags do not count.
 * @param {readonly string[]} tags
 * @returns {{ tag: string; version: CalendarVersion } | undefined}
 */
export const latestReleaseTag = (tags) => {
  /** @type {{ tag: string; version: CalendarVersion } | undefined} */
  let latest;
  for (const tag of tags) {
    const version = parseReleaseTag(tag);
    if (version && (!latest || compareVersions(version, latest.version) > 0)) {
      latest = { tag: tag.trim(), version };
    }
  }
  return latest;
};

/**
 * The version after the newest release tag: N = 0 of the month `date` falls in (UTC) once that
 * month is later than the tag's, the tag's N + 1 otherwise. A clock behind the newest tag still
 * gives a higher version.
 * @param {readonly string[]} tags
 * @param {Date} date
 * @returns {CalendarVersion}
 */
export const nextVersion = (tags, date) => {
  const current = { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, n: 0 };
  const latest = latestReleaseTag(tags)?.version;
  return latest && compareVersions(latest, current) >= 0 ? { ...latest, n: latest.n + 1 } : current;
};

/**
 * A commit subject as Markdown text: `@name` goes into a code span, so the release notifies
 * nobody, and `<` is escaped, so no word reads as an HTML tag. Code spans stay as they are.
 * @param {string} text
 */
const markdownText = (text) =>
  text
    .split(/(`[^`]*`)/)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part.replace(/</g, '&lt;').replace(/(^|[^\w`@])@([\w-]+(?:\/[\w.-]+)?)/g, '$1`@$2`')
    )
    .join('');

/**
 * The notes of a release: the commits since the previous release, newest first, or, for the
 * first release, how many commits it holds.
 * @param {{
 *   tag: string;
 *   previousTag: string | undefined;
 *   commits: readonly Commit[];
 *   repository: string;
 * }} release
 */
export const releaseNotes = ({ tag, previousTag, commits, repository }) => {
  const url = `https://github.com/${repository}`;
  if (!previousTag) {
    return [
      `The first release with calendar versions (vYYYY.M.N): ${commits.length} commits.`,
      '',
      `**Full Changelog**: ${url}/commits/${tag}`,
      '',
    ].join('\n');
  }
  const listed = commits
    .slice(0, MAX_LISTED_COMMITS)
    .map(({ hash, subject }) => `- ${markdownText(subject)} (${hash.slice(0, 7)})`);
  const unlisted = commits.length - listed.length;
  return [
    `Changes since ${previousTag}:`,
    '',
    ...listed,
    ...(unlisted > 0 ? [`- and ${unlisted} more commits`] : []),
    '',
    `**Full Changelog**: ${url}/compare/${previousTag}...${tag}`,
    '',
  ].join('\n');
};

/**
 * The `autoRelease` switch of package.json.
 * @param {string} text the file's content
 * @returns {boolean}
 */
export const readAutoRelease = (text) => {
  const value = /** @type {{ autoRelease?: unknown } | null} */ (JSON.parse(text))?.autoRelease;
  if (typeof value !== 'boolean') {
    throw new Error(`${RELEASE_CONFIG_FILE} must set "autoRelease" to true or false.`);
  }
  return value;
};

/**
 * @param {string[]} args
 * @param {string} cwd
 */
const git = (args, cwd) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/**
 * @param {string[]} args
 * @param {string} cwd
 */
const gitSucceeds = (args, cwd) => spawnSync('git', args, { cwd, stdio: 'ignore' }).status === 0;

/** @param {string} output */
const lines = (output) => output.split('\n').filter(Boolean);

/**
 * The tags of the checkout in `cwd` that start with `v`.
 * @param {string} cwd
 */
export const readTags = (cwd) => lines(git(['tag', '--list', 'v*'], cwd));

/**
 * @typedef {{ kind: 'release'; tag: string; sha: string; subject: string; notes: string }
 *   | { kind: 'skip' | 'refuse'; reason: string }} ReleasePlan
 */

/**
 * What releasing `commit` means in the checkout in `cwd`: the tag and notes it gets, or why it
 * gets none. A commit already released, or one that does not contain the newest release (a run
 * that lost a race), is skipped; one that is not on `main` is refused.
 * @param {{ cwd: string; commit: string; main: string; date: Date; repository: string }} input
 * @returns {ReleasePlan}
 */
export const planRelease = ({ cwd, commit, main, date, repository }) => {
  const sha = git(['rev-parse', '--verify', `${commit}^{commit}`], cwd);
  const short = sha.slice(0, 7);
  const mainSha = git(['rev-parse', '--verify', `${main}^{commit}`], cwd);
  if (!gitSucceeds(['merge-base', '--is-ancestor', sha, mainSha], cwd)) {
    return { kind: 'refuse', reason: `${short} is not on main (${main}).` };
  }
  const released = latestReleaseTag(lines(git(['tag', '--points-at', sha], cwd)));
  if (released) return { kind: 'skip', reason: `${short} is already released as ${released.tag}.` };
  const tags = readTags(cwd);
  const latest = latestReleaseTag(tags);
  if (latest && !gitSucceeds(['merge-base', '--is-ancestor', latest.tag, sha], cwd)) {
    return { kind: 'skip', reason: `${short} does not contain the latest release ${latest.tag}.` };
  }
  const tag = `v${formatVersion(nextVersion(tags, date))}`;
  const commits = lines(
    git(['log', '--no-merges', '--format=%H%x09%s', latest ? `${latest.tag}..${sha}` : sha], cwd)
  ).map((line) => {
    const tab = line.indexOf('\t');
    return { hash: line.slice(0, tab), subject: line.slice(tab + 1) };
  });
  return {
    kind: 'release',
    tag,
    sha,
    subject: git(['log', '-1', '--format=%s', sha], cwd),
    notes: releaseNotes({ tag, previousTag: latest?.tag, commits, repository }),
  };
};

/**
 * Creates the release, and with it the tag, on GitHub.
 * @param {{ tag: string; sha: string; notes: string }} release
 * @param {string} repository
 */
const publish = ({ tag, sha, notes }, repository) => {
  execFileSync(
    'gh',
    [
      'release',
      'create',
      tag,
      '--repo',
      repository,
      '--target',
      sha,
      '--title',
      tag,
      '--notes-file',
      '-',
    ],
    { input: notes, stdio: ['pipe', 'inherit', 'inherit'] }
  );
};

/** @param {string} question */
const confirmed = async (question) => {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await prompt.question(question)).trim());
  } finally {
    prompt.close();
  }
};

/** @param {string | undefined} value */
const parseDate = (value) => {
  if (value === undefined) return new Date();
  const date = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime())) {
    throw new Error(`--date must be a date like 2026-11-05, got '${value}'.`);
  }
  return date;
};

const USAGE = `Usage:
  node scripts/calver.mjs next [--date YYYY-MM-DD]
  node scripts/calver.mjs latest
  node scripts/calver.mjs release [<commit>] --main <ref> [--dry-run] [--yes] [--date YYYY-MM-DD]
  node scripts/calver.mjs auto <commit> --main <ref> [--date YYYY-MM-DD]
`;

/**
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 * @param {string} cwd
 * @returns {Promise<number>} the exit status
 */
export const main = async (argv, env, cwd) => {
  const [command, ...rest] = argv;
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      main: { type: 'string' },
      date: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      yes: { type: 'boolean', default: false },
    },
  });
  const date = parseDate(values.date);
  if (command === 'next') {
    process.stdout.write(`v${formatVersion(nextVersion(readTags(cwd), date))}\n`);
    return 0;
  }
  if (command === 'latest') {
    process.stdout.write(`${latestReleaseTag(readTags(cwd))?.tag ?? ''}\n`);
    return 0;
  }
  if ((command !== 'release' && command !== 'auto') || !values.main || positionals.length > 1) {
    process.stderr.write(USAGE);
    return 2;
  }
  const commit = positionals[0] ?? (command === 'release' ? values.main : undefined);
  if (!commit) {
    process.stderr.write(USAGE);
    return 2;
  }
  if (command === 'auto') {
    const root = git(['rev-parse', '--show-toplevel'], cwd);
    if (!readAutoRelease(readFileSync(path.join(root, RELEASE_CONFIG_FILE), 'utf8'))) {
      process.stdout.write(
        `Automatic releases are off: ${RELEASE_CONFIG_FILE} has "autoRelease": false. Nothing to do.\n`
      );
      return 0;
    }
  }

  const repository = env.GITHUB_REPOSITORY?.trim() || DEFAULT_REPOSITORY;
  const plan = planRelease({ cwd, commit, main: values.main, date, repository });
  if (plan.kind !== 'release') {
    process[plan.kind === 'skip' ? 'stdout' : 'stderr'].write(`Not releasing: ${plan.reason}\n`);
    return plan.kind === 'skip' ? 0 : 1;
  }
  process.stdout.write(
    `Release ${plan.tag} of ${repository} at ${plan.sha.slice(0, 7)} (${plan.subject})\n\n${
      plan.notes
    }\n`
  );
  if (command === 'release' && values['dry-run']) {
    process.stdout.write('Dry run: nothing was created.\n');
    return 0;
  }
  if (command === 'release' && !values.yes) {
    if (!process.stdin.isTTY) {
      process.stderr.write('Not released: confirm in a terminal, or pass --yes.\n');
      return 1;
    }
    if (!(await confirmed(`Create ${plan.tag} and its GitHub release? [y/N] `))) {
      process.stdout.write('Not released.\n');
      return 1;
    }
  }
  publish(plan, repository);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `tag=${plan.tag}\n`);
  return 0;
};

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    process.exitCode = await main(process.argv.slice(2), process.env, process.cwd());
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
