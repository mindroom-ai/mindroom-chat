import { describe, expect, it } from 'vitest';

import {
  assertMarketingVersionNotBehindPackage,
  resolveIosCiVersionMetadata,
} from '../../../../scripts/ios-ci-version.mjs';

describe('resolveIosCiVersionMetadata', () => {
  it('uses the MindRoom release tag at HEAD for branch-triggered Xcode Cloud builds', () => {
    const metadata = resolveIosCiVersionMetadata({
      env: {},
      packageVersion: '4.12.2',
      checkedInMarketingVersion: '4.12.2',
      checkedInBuildNumber: '80',
      headTags: ['v4.12.2-mindroom.18'],
    });

    expect(metadata).toEqual({
      marketingVersion: '4.12.2',
      buildNumber: '18',
      buildNumberSource: 'head-tag:v4.12.2-mindroom.18',
    });
  });

  it('keeps an explicit iOS build number override ahead of release tags', () => {
    const metadata = resolveIosCiVersionMetadata({
      env: { IOS_BUILD_NUMBER: '123' },
      packageVersion: '4.12.2',
      checkedInMarketingVersion: '4.12.2',
      checkedInBuildNumber: '80',
      headTags: ['v4.12.2-mindroom.18'],
    });

    expect(metadata.buildNumber).toBe('123');
    expect(metadata.buildNumberSource).toBe('IOS_BUILD_NUMBER');
  });

  it('uses CI release tag variables before tags fetched at HEAD', () => {
    const metadata = resolveIosCiVersionMetadata({
      env: { GITHUB_REF: 'refs/tags/v4.12.2-mindroom.19' },
      packageVersion: '4.12.2',
      checkedInMarketingVersion: '4.12.2',
      checkedInBuildNumber: '80',
      headTags: ['v4.12.2-mindroom.18'],
    });

    expect(metadata.buildNumber).toBe('19');
    expect(metadata.buildNumberSource).toBe('env-tag:v4.12.2-mindroom.19');
  });

  it('uses the Xcode Cloud build number before the checked-in fallback when no tag is available', () => {
    const metadata = resolveIosCiVersionMetadata({
      env: { CI: 'TRUE', CI_BUILD_NUMBER: '124' },
      packageVersion: '4.12.2',
      checkedInMarketingVersion: '4.12.2',
      checkedInBuildNumber: '80',
      headTags: [],
    });

    expect(metadata.buildNumber).toBe('124');
    expect(metadata.buildNumberSource).toBe('CI_BUILD_NUMBER');
  });
});

describe('assertMarketingVersionNotBehindPackage', () => {
  it('rejects a checked-in App Store marketing version that lags behind package.json', () => {
    expect(() => assertMarketingVersionNotBehindPackage('4.11.2', '4.12.2')).toThrow(
      'must not be lower than package.json version 4.12.2'
    );
  });

  it('allows an App Store marketing version ahead of package.json for closed train bumps', () => {
    expect(() => assertMarketingVersionNotBehindPackage('4.11.2', '4.11.1')).not.toThrow();
  });
});
