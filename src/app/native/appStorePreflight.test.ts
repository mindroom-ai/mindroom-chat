import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  XCODE_PROJECT_PATH,
  appStoreVersionProblems,
} from '../../../scripts/appstore-preflight.mjs';
import { replaceAppTargetBuildSetting } from '../../../scripts/ios-xcode-project.mjs';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const scriptPath = join(repoRoot, 'scripts/appstore-preflight.mjs');
const INFO_PLIST_PATH = 'ios/App/App/Info.plist';
const checkedInProject = readFileSync(join(repoRoot, XCODE_PROJECT_PATH), 'utf8');
const checkedInInfoPlist = readFileSync(join(repoRoot, INFO_PLIST_PATH), 'utf8');

const project = (marketingVersion: string, buildNumber: string) =>
  replaceAppTargetBuildSetting(
    replaceAppTargetBuildSetting(checkedInProject, 'MARKETING_VERSION', marketingVersion),
    'CURRENT_PROJECT_VERSION',
    buildNumber
  );

const problems = (
  overrides: Partial<Parameters<typeof appStoreVersionProblems>[0]> = {}
): string[] =>
  appStoreVersionProblems({
    projectText: project('4.12.6', '33'),
    infoPlistText: checkedInInfoPlist,
    ...overrides,
  });

describe('appStoreVersionProblems', () => {
  it('accepts a three-integer marketing version, a calendar version among them, and a positive build', () => {
    expect(problems()).toEqual([]);
    expect(problems({ projectText: project('2026.11.0', '1') })).toEqual([]);
  });

  it.each(['4.12', '4.12.6-beta', '"4.12.x"'])('rejects the marketing version %s', (version) => {
    expect(problems({ projectText: project(version, '33') })).toEqual([
      expect.stringContaining("iOS MARKETING_VERSION must use Apple's three-integer format"),
    ]);
  });

  it.each(['0', '-1', '33.1', 'abc'])('rejects the build number %s', (buildNumber) => {
    expect(problems({ projectText: project('4.12.6', buildNumber) })).toEqual([
      `iOS CURRENT_PROJECT_VERSION must be a positive integer, got '${buildNumber}'.`,
    ]);
  });

  it('rejects build configurations that disagree', () => {
    const [debug, ...rest] = project('4.12.6', '33').split('CURRENT_PROJECT_VERSION = 33;');
    const mixed = [
      debug,
      'CURRENT_PROJECT_VERSION = 34;',
      rest.join('CURRENT_PROJECT_VERSION = 33;'),
    ].join('');
    expect(problems({ projectText: mixed })).toEqual([
      expect.stringContaining('CURRENT_PROJECT_VERSION of target App must have one value'),
    ]);
  });

  it('rejects an Info.plist that hard-codes the version', () => {
    const infoPlistText = checkedInInfoPlist.replace(
      '<string>$(MARKETING_VERSION)</string>',
      '<string>4.12.6</string>'
    );
    expect(problems({ infoPlistText })).toEqual([
      "Info.plist CFBundleShortVersionString must be $(MARKETING_VERSION), got '4.12.6'.",
    ]);
  });
});

describe('appstore-preflight.mjs', () => {
  const checkouts: string[] = [];
  afterEach(() => {
    checkouts.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }));
  });

  const checkout = (projectText: string) => {
    const root = mkdtempSync(join(tmpdir(), 'mindroom-appstore-preflight-'));
    checkouts.push(root);
    const files = {
      [XCODE_PROJECT_PATH]: projectText,
      [INFO_PLIST_PATH]: checkedInInfoPlist,
    };
    Object.entries(files).forEach(([path, content]) => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    });
    return root;
  };

  const run = (root: string) =>
    spawnSync(process.execPath, [scriptPath, root], { encoding: 'utf8' });

  it('passes the checked-in project of this repository', () => {
    const result = run(repoRoot);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^App Store preflight passed: iOS \d+\.\d+\.\d+ \(\d+\)/);
  });

  it('fails with the reason when the marketing version is not three integers', () => {
    const result = run(checkout(project('2026.11', '1')));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('App Store preflight failed:');
    expect(result.stderr).toContain(
      "iOS MARKETING_VERSION must use Apple's three-integer format, got '2026.11'."
    );
  });
});
