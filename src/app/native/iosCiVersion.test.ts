import { describe, expect, it } from 'vitest';

import { resolveIosCiVersionMetadata } from '../../../scripts/ios-ci-version.mjs';

const NOV_5 = new Date('2026-11-05T12:00:00Z');
const XCODE_CLOUD = { CI: 'TRUE', CI_BUILD_NUMBER: '512' };

const resolve = (
  input: Partial<Parameters<typeof resolveIosCiVersionMetadata>[0]> = {}
): ReturnType<typeof resolveIosCiVersionMetadata> =>
  resolveIosCiVersionMetadata({
    env: {},
    checkedInBuildNumber: '33',
    tags: [],
    headTags: [],
    date: NOV_5,
    ...input,
  });

describe('resolveIosCiVersionMetadata', () => {
  it('takes the marketing version of the release tag Xcode Cloud builds', () => {
    expect(
      resolve({
        env: { ...XCODE_CLOUD, CI_TAG: 'v2026.11.3' },
        tags: ['v2026.11.2', 'v2026.11.3', 'v2026.11.4'],
      })
    ).toEqual({
      marketingVersion: '2026.11.3',
      marketingVersionSource: 'tag:v2026.11.3',
      buildNumber: '512',
      buildNumberSource: 'CI_BUILD_NUMBER',
    });
  });

  it('takes a release tag on HEAD when the build was not started by the tag', () => {
    const metadata = resolve({
      env: XCODE_CLOUD,
      tags: ['v2026.10.9', 'v2026.11.0', 'v2026.11.1'],
      headTags: ['nightly', 'v2026.11.0'],
    });

    expect(metadata.marketingVersion).toBe('2026.11.0');
    expect(metadata.marketingVersionSource).toBe('head-tag:v2026.11.0');
  });

  it('gives an untagged build the version the next release will get', () => {
    const metadata = resolve({ env: XCODE_CLOUD, tags: ['v2026.10.9', 'v2026.11.4', 'v0.1.0'] });

    expect(metadata.marketingVersion).toBe('2026.11.5');
    expect(metadata.marketingVersionSource).toBe('next-after:v2026.11.4');
    expect(metadata.buildNumber).toBe('512');
  });

  it('starts the month at 0 for an untagged build after the month rolls over', () => {
    const metadata = resolve({
      env: XCODE_CLOUD,
      tags: ['v2026.11.4'],
      date: new Date('2026-12-01T00:10:00Z'),
    });

    expect(metadata.marketingVersion).toBe('2026.12.0');
  });

  it('versions the first build without any release tag', () => {
    const metadata = resolve({ env: XCODE_CLOUD });

    expect(metadata.marketingVersion).toBe('2026.11.0');
    expect(metadata.marketingVersionSource).toBe('next-after:none');
  });

  it('refuses a tag build whose tag is not a release tag', () => {
    expect(() => resolve({ env: { ...XCODE_CLOUD, CI_TAG: 'v4.12.6-mindroom.180' } })).toThrow(
      'CI_TAG v4.12.6-mindroom.180 is not a release tag vYYYY.M.N.'
    );
  });

  it.each(['IOS_MARKETING_VERSION', 'APP_STORE_MARKETING_VERSION'])(
    'keeps an explicit %s override ahead of tags',
    (key) => {
      const metadata = resolve({
        env: { ...XCODE_CLOUD, CI_TAG: 'v2026.11.3', [key]: '2026.11.9' },
      });

      expect(metadata.marketingVersion).toBe('2026.11.9');
      expect(metadata.marketingVersionSource).toBe(key);
    }
  );

  it('keeps an explicit build number override ahead of the Xcode Cloud counter', () => {
    const metadata = resolve({ env: { ...XCODE_CLOUD, IOS_BUILD_NUMBER: '7' } });

    expect(metadata.buildNumber).toBe('7');
    expect(metadata.buildNumberSource).toBe('IOS_BUILD_NUMBER');
  });

  it('keeps the checked-in build number outside Xcode Cloud', () => {
    const metadata = resolve({ env: { CI_BUILD_NUMBER: '512' } });

    expect(metadata.buildNumber).toBe('33');
    expect(metadata.buildNumberSource).toBe('checked-in Xcode project');
  });
});
