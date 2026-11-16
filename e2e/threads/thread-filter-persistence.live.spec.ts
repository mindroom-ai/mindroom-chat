import { writeFile } from 'node:fs/promises';
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
    await sendStateEvent(
      HOMESERVER,
      agent.accessToken,
      roomId,
      'com.mindroom.thread.tags',
      JSON.stringify([roots[0], 'review']),
      { set_by: agent.userId, set_at: new Date().toISOString() }
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
    await overview.locator('[data-search-toggle]').click();
    for (const rootFontSize of ['100%', '80%']) {
      // eslint-disable-next-line no-await-in-loop
      await page.evaluate((size) => {
        document.documentElement.style.fontSize = size;
      }, rootFontSize);
      // eslint-disable-next-line no-await-in-loop
      const metrics = await overview.evaluate((element) => {
        const measure = (node: Element) => {
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            padding: style.padding,
            fontSize: style.fontSize,
            lineHeight: style.lineHeight,
            borderRadius: style.borderRadius,
            borderWidth: style.borderWidth,
            scrollWidth: node.scrollWidth,
            clientWidth: node.clientWidth,
          };
        };
        const frame = element.querySelector('[data-thread-tab]')!.parentElement!;
        const toolbar = frame.parentElement!;
        return {
          rootFontSize: getComputedStyle(document.documentElement).fontSize,
          overview: measure(element),
          toolbar: measure(toolbar),
          columnGap: parseFloat(getComputedStyle(toolbar).columnGap),
          frame: measure(frame),
          tabs: Array.from(frame.children, (node) => ({
            name: node.getAttribute('data-thread-tab'),
            ...measure(node),
          })),
          triggers: [
            '[data-people-filter-button]',
            '[data-tag-filter-button]',
            '[data-sort-by]',
          ].map((selector) => ({ selector, ...measure(element.querySelector(selector)!) })),
          controls: Array.from(toolbar.children)
            .filter((node) => node.getBoundingClientRect().width > 0)
            .map(measure),
        };
      });
      // eslint-disable-next-line no-await-in-loop
      await writeFile(
        testInfo.outputPath(`metrics-${width}-${rootFontSize}.json`),
        JSON.stringify(metrics, null, 2)
      );
      for (const trigger of metrics.triggers) {
        expect(metrics.frame.height).toBe(trigger.height);
        if (width === 1280) expect(metrics.frame.y).toBe(trigger.y);
      }
      for (const item of [...metrics.tabs, ...metrics.triggers, metrics.frame]) {
        expect(item.x).toBeGreaterThanOrEqual(metrics.toolbar.x);
        expect(item.x + item.width).toBeLessThanOrEqual(metrics.toolbar.x + metrics.toolbar.width);
        expect(item.scrollWidth).toBeLessThanOrEqual(item.clientWidth);
      }
      expect(new Set(metrics.tabs.map((item) => item.y)).size).toBe(1);
      // The count can be shorter than its neighbours; compare row centres, not top edges.
      const rows = new Set(metrics.controls.map((item) => Math.round(item.y + item.height / 2)));
      expect(rows.size).toBeLessThanOrEqual(2);
      const controlWidth = metrics.controls.reduce((sum, item) => sum + item.width, 0);
      if (
        controlWidth + (metrics.controls.length - 1) * metrics.columnGap <=
        metrics.toolbar.width
      ) {
        expect(rows.size).toBe(1);
      }
      // eslint-disable-next-line no-await-in-loop
      await expect(overview.locator('[data-thread-tab][aria-label]')).toHaveCount(5);
      // eslint-disable-next-line no-await-in-loop
      await page.screenshot({
        path: testInfo.outputPath(`impl2-${width}-${rootFontSize}.png`),
        fullPage: true,
      });
    }
  });
}
