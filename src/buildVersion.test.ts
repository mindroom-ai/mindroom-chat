import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
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

  it('uses the GitHub commit hash when no explicit version is provided', () => {
    expect(
      resolveBuildVersion({
        GITHUB_SHA: 'd'.repeat(40),
        DEPLOY_ID: 'netlify-deploy-id',
      })
    ).toBe('d'.repeat(40));
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

  it('returns no version when every source is unavailable', () => {
    expect(resolveBuildVersion({})).toBeUndefined();
  });

  it('passes the exact GitHub commit into every published container build', () => {
    const expectedBuildArg = ['MINDROOM_BUILD_VERSION=', '$', '{{ github.sha }}'].join('');
    for (const workflow of [
      '../.github/workflows/docker-publish-push.yml',
      '../.github/workflows/prod-deploy.yml',
    ]) {
      const source = readFileSync(new URL(workflow, import.meta.url), 'utf8');
      expect(source).toContain(expectedBuildArg);
    }
  });
});
