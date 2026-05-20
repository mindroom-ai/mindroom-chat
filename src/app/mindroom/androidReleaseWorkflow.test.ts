import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowPath = resolve(process.cwd(), '.github/workflows/auto-mindroom-release.yml');

const readWorkflow = (): string => readFileSync(workflowPath, 'utf8');
const githubExpression = (expression: string): string => ['$', '{{ ', expression, ' }}'].join('');

describe('Android Play publish workflow', () => {
  it('auto-publishes signed release bundles to the Play internal track from GitHub releases', () => {
    expect(existsSync(workflowPath)).toBe(true);

    const workflow = readWorkflow();

    expect(workflow).toContain('name: Create MindRoom Release');
    expect(workflow).toContain(
      `release_created: ${githubExpression('steps.create_release.outputs.created')}`
    );
    expect(workflow).toContain('publish-android-internal:');
    expect(workflow).toContain(
      `if: ${githubExpression("needs.release.outputs.release_created == 'true'")}`
    );
    expect(workflow).toContain('needs: release');
    expect(workflow).not.toContain('pull_request:');
    expect(workflow).toContain('ANDROID_UPLOAD_KEYSTORE_BASE64');
    expect(workflow).toContain('mindroom-upload-keystore.properties');
    expect(workflow).toContain('npm ci');
    expect(workflow).toContain('npm run build');
    expect(workflow).toContain('npx cap sync android');
    expect(workflow).toContain('./gradlew --no-daemon :app:bundleRelease');
    expect(workflow).toContain('android/app/build/outputs/bundle/release/app-release.aab');
    expect(workflow).toContain('actions/upload-artifact@bbbca2ddaa5d8feaa63e36b76fdaad77386f024f');
    expect(workflow).toContain(
      'r0adkll/upload-google-play@e738b9dd8f2476ea806d921b64aacd24f34515a5'
    );
    expect(workflow).toContain(
      `serviceAccountJsonPlainText: ${githubExpression('secrets.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON')}`
    );
    expect(workflow).toContain('packageName: com.mindroom_ai.app');
    expect(workflow).toContain('tracks: internal');
    expect(workflow).toContain('status: completed');
    expect(workflow).toContain(
      `releaseName: ${githubExpression('needs.release.outputs.release_tag')}`
    );
  });
});
