import { describe, expect, it } from 'vitest';
import { resolveBuildVersion } from '../scripts/build-version.mjs';

describe('build version selection', () => {
  it('prefers the explicit operator override', () => {
    expect(
      resolveBuildVersion({
        MINDROOM_BUILD_VERSION: ' release-candidate ',
        GITHUB_SHA: 'a'.repeat(40),
      })
    ).toBe('release-candidate');
  });

  it('uses provider commit hashes before a Netlify deploy ID', () => {
    expect(
      resolveBuildVersion({
        COMMIT_REF: ` ${'b'.repeat(40)} `,
        DEPLOY_ID: 'netlify-deploy-id',
      })
    ).toBe('b'.repeat(40));
  });

  it('rejects branch-like provider values and uses the checked-out commit', () => {
    expect(
      resolveBuildVersion(
        {
          COMMIT_REF: 'feature/offline-updater',
          DEPLOY_ID: 'netlify-deploy-id',
        },
        'c'.repeat(40)
      )
    ).toBe('c'.repeat(40));
  });

  it('uses the deploy ID only when no Git commit is available', () => {
    expect(
      resolveBuildVersion({
        COMMIT_REF: 'feature/offline-updater',
        DEPLOY_ID: 'netlify-deploy-id',
      })
    ).toBe('netlify-deploy-id');
  });
});
