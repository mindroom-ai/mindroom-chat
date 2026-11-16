import { expect, test } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { joinRoom, registerAgentAccount, sendRoomMessage, sendStateEvent } from '../helpers/matrix';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// Keep the existing spec path, but use disposable accounts rather than production credentials.
test.use({ video: 'off', trace: 'off' });
for (const width of [1280, 390]) {
  test(`workflow tabs classify live jobs and persist at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 900 });
    const password = 'workflow-tabs-test-password';
    const reader = await registerDisposableUser(`tabs_${width}_${Date.now()}`, password);
    const agent = await registerAgentAccount(HOMESERVER, `tabs_${width}`);
    const roomId = await createRoom(HOMESERVER, agent.accessToken, {
      name: 'Design review',
      invite: [reader.userId],
    });
    await joinRoom(HOMESERVER, reader.accessToken, roomId);
    const roots: string[] = [];
    for (const body of [
      'Review the release notes',
      'Background research',
      'Approve deployment',
      'Tomorrow’s follow-up',
      'Completed review',
      'Scheduled check-in',
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const root = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
        msgtype: 'm.text',
        body,
      });
      roots.push(root);
      // eslint-disable-next-line no-await-in-loop
      await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
        msgtype: 'm.text',
        body: 'Here is the latest update.',
        'io.mindroom.stream_status': 'completed',
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: root,
          is_falling_back: true,
          'm.in_reply_to': { event_id: root },
        },
      });
    }
    const job = (root: string | null, status: string) => ({
      job_id: `${root ?? 'room'}-${status}`,
      thread_id: root,
      status,
      kind: 'tool',
      tool: 'shell',
      started_at: new Date().toISOString(),
    });
    const publishJobs = (jobs: ReturnType<typeof job>[]) =>
      sendStateEvent(
        HOMESERVER,
        agent.accessToken,
        roomId,
        'io.mindroom.background_jobs',
        agent.userId,
        { jobs, total: jobs.length }
      );
    await publishJobs([
      job(roots[1]!, 'running'),
      job(roots[2]!, 'awaiting_approval'),
      job(null, 'running'),
    ]);
    await sendStateEvent(
      HOMESERVER,
      agent.accessToken,
      roomId,
      'com.mindroom.thread.tags',
      JSON.stringify([roots[3], 'snoozed']),
      {
        set_by: agent.userId,
        set_at: new Date().toISOString(),
        data: { until: new Date(Date.now() + 86_400_000).toISOString() },
      }
    );
    await sendStateEvent(
      HOMESERVER,
      agent.accessToken,
      roomId,
      'com.mindroom.thread.tags',
      JSON.stringify([roots[4], 'resolved']),
      {
        set_by: agent.userId,
        set_at: new Date().toISOString(),
      }
    );
    await sendStateEvent(
      HOMESERVER,
      agent.accessToken,
      roomId,
      'com.mindroom.scheduled.task',
      'check-in',
      {
        status: 'pending',
        thread_id: roots[5],
        execute_at: new Date(Date.now() + 86_400_000).toISOString(),
      }
    );
    await loginWithPassword(page, { homeserver: HOMESERVER, username: reader.username, password });
    await page.goto(`/home/${encodeURIComponent(roomId)}`);
    const overview = page.locator('[data-room-thread-overview]');
    await expect(overview).toBeVisible({ timeout: 60_000 });
    await overview.locator('[data-thread-filter-mode-switch]').click();
    const tab = (name: string) => overview.locator(`[data-thread-tab="${name}"]`);
    await expect(tab('needsYou')).toHaveAttribute('aria-pressed', 'true');
    for (const [name, count] of [
      ['needsYou', 2],
      ['working', 1],
      ['later', 2],
      ['done', 1],
      ['all', 6],
    ] as const) {
      // eslint-disable-next-line no-await-in-loop
      await expect(tab(name)).toContainText(String(count));
    }
    await expect(overview.locator('[data-thread-count]')).toHaveText('2');
    // Simple mode's toggle must not contradict the saved advanced Done bucket.
    await tab('done').click();
    await expect(overview.locator('[data-thread-count]')).toHaveText('1');
    await overview.locator('[data-thread-filter-mode-switch]').click();
    await overview.locator('[data-simple-unresolved-toggle]').click();
    await expect(overview.locator('[data-thread-count]')).toHaveText('5');
    await overview.locator('[data-thread-filter-mode-switch]').click();
    await expect(tab('done')).toHaveAttribute('aria-pressed', 'true');
    await expect(overview.locator('[data-thread-count]')).toHaveText('1');
    await tab('working').click();
    await expect(overview.locator('[data-thread-count]')).toHaveText('1');
    await page.reload();
    await expect(tab('working')).toHaveAttribute('aria-pressed', 'true', { timeout: 60_000 });
    // The live state subscription moves a finished job back to Needs you, without a reload.
    await publishJobs([job(roots[1]!, 'finished'), job(roots[2]!, 'awaiting_approval')]);
    await expect(tab('working')).toContainText('0');
    await expect(tab('needsYou')).toContainText('3');
    await tab('all').click();
    await expect(overview.locator('[data-thread-count]')).toHaveText('6');
    await expect(page.locator('[data-filter-key], [data-preset-button]')).toHaveCount(0);
    // Search keeps legacy is: tokens. Selecting a tab replaces those status restrictions.
    await overview.locator('[data-search-toggle]').click();
    await overview.locator('[data-search-input]').fill('is:resolved');
    await expect(overview.locator('[data-thread-count]')).toHaveText('1');
    await tab('needsYou').click();
    await expect(overview.locator('[data-search-input]')).toHaveValue('');
    await expect(overview.locator('[data-thread-count]')).toHaveText('3');
    const box = await overview.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`impl-${width}.png`), fullPage: true });
  });
}
