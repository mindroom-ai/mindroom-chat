import { expect, test, type Page } from '@playwright/test';
import { disposableHomeserverIsUp, DISPOSABLE_HOMESERVER } from '../helpers/disposableAccounts';
import { matrixFetch, sendRoomMessage, sendStateEvent } from '../helpers/matrix';
import { openPanelRoom, type PanelRoom } from '../helpers/sidePanels';

// The listed jobs scroll up and down inside the bar, never sideways: on a phone, many sub-agents,
// nested ones and a tool whose arguments are one long word all fit the list's width, at any
// root font size (a browser's Page Zoom).

// A phone: touch, so the controls' 44 px touch targets are on.
test.use({ video: 'off', hasTouch: true, isMobile: true });
test.afterEach(async ({ context }) => {
  await context.unrouteAll({ behavior: 'ignoreErrors' });
});

const SID = `${Date.now()}-5e6f7a8b`;
const seqs = new Map<string, number>();
const RUNS = 18;
// Each run's parent: three chains run three deep, the others start from the lead agent.
const parentOf = (index: number) => (index % 6 === 0 ? null : index % 6 <= 3 ? index - 1 : null);
const runId = (index: number) => `run-${index}`;
const LONG_ARGS =
  'args=cd /srv/example/placeholder-checkout-with-a-rather-long-directory-name/and/deeper/still && just check-everything --verbose';

const sendRun = async (room: PanelRoom, index: number) => {
  const run = runId(index);
  const seq = seqs.get(run) ?? 0;
  seqs.set(run, seq + 1);
  const parent = parentOf(index);
  const response = await fetch(
    `${DISPOSABLE_HOMESERVER}/_matrix/client/unstable/org.matrix.msc2477/rooms/${encodeURIComponent(
      room.roomId
    )}/ephemeral/io.mindroom.subagents/subagents.${run}.${seq}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${room.agent.accessToken}`,
      },
      body: JSON.stringify({
        v: 1,
        run,
        sid: SID,
        seq,
        meta: {
          agent: 'panels',
          caller: 'panels',
          root: 'panels',
          parent: parent === null ? null : runId(parent),
          thread_id: room.rootId,
          source: 'delegate',
          status: 'running',
          started_at: Date.now() / 1000 - 30 - index,
          ended_at: null,
          subagent: `sub-${index}`,
          task: `Placeholder task number ${index} that describes some invented piece of work`,
          model: {
            config: 'opus',
            display_name: 'Opus 5.5',
            provider: 'anthropic',
            id: 'claude-opus-5.5',
          },
          usage: { input_tokens: 1_200_000, output_tokens: 30_000, tool_calls: 123 },
        },
        snapshot: {
          md: 'Working on it.',
          reasoning: '',
          tools: [
            {
              type: 'tool_call_started',
              tool_name: 'run_shell_command',
              args_preview: LONG_ARGS,
            },
          ],
          status: 'streaming',
          activity: '',
        },
      }),
    }
  );
  if (!response.ok) throw new Error(`Sub-agent frame refused: ${response.status}`);
};

const sendRuns = async (room: PanelRoom) => {
  for (let index = 0; index < RUNS; index += 1) await sendRun(room, index);
};

/** The list's widths and how far it scrolled sideways after a try. */
const measure = (page: Page) =>
  page.evaluate(() => {
    const list = document.querySelector('[role="region"] ul[role="list"]')?.parentElement;
    if (!list) throw new Error('No listed jobs');
    const before = { scrollWidth: list.scrollWidth, clientWidth: list.clientWidth };
    list.scrollLeft = 200;
    const scrollLeft = list.scrollLeft;
    list.scrollLeft = 0;
    // What reaches past the list's end edge, for the failure message.
    const edge = list.getBoundingClientRect().right;
    const clipped = (el: Element) => {
      for (let up = el.parentElement; up && up !== list; up = up.parentElement)
        if (getComputedStyle(up).overflowX !== 'visible') return true;
      return false;
    };
    const wide = [...list.querySelectorAll('*')]
      .filter((el) => el.getBoundingClientRect().right > edge + 0.5 && !clipped(el))
      .slice(0, 5)
      .map((el) => `${el.tagName}.${el.className} right=${el.getBoundingClientRect().right}`);
    // A finger's area of a row's last button, its Stop.
    const stop = list.querySelector('li button:last-of-type');
    const touch = stop && getComputedStyle(stop, '::after').width;
    return { ...before, scrollLeft, edge, touch, wide };
  });

// Two phones at root font sizes a Page Zoom of 100, 87.5 and 75 % gives, and the larger phone as
// a WebKit page zoom of 75 % lays it out (a wider viewport), where the usage columns show.
for (const { rootSizes, ...viewport } of [
  { width: 440, height: 956, rootSizes: ['100%', '87.5%', '75%'] },
  { width: 393, height: 852, rootSizes: ['100%', '87.5%', '75%'] },
  { width: 587, height: 1275, rootSizes: ['100%'] },
]) {
  test(`the listed jobs never scroll sideways at ${viewport.width}px`, async ({
    context,
    page,
  }, testInfo) => {
    test.skip(!(await disposableHomeserverIsUp()), 'Needs the disposable homeserver.');
    test.setTimeout(4 * 60_000);
    await page.setViewportSize({ width: 1400, height: 860 });
    const room = await openPanelRoom(context, page);
    const powerLevelsPath = `/rooms/${encodeURIComponent(room.roomId)}/state/m.room.power_levels`;
    const powerLevels = await matrixFetch<Record<string, unknown>>(
      DISPOSABLE_HOMESERVER,
      powerLevelsPath,
      { accessToken: room.viewer.accessToken }
    );
    await sendStateEvent(
      DISPOSABLE_HOMESERVER,
      room.viewer.accessToken,
      room.roomId,
      'm.room.power_levels',
      '',
      {
        ...powerLevels,
        events: {
          ...(powerLevels.events as Record<string, number>),
          'io.mindroom.background_jobs': 0,
        },
      }
    );
    await sendRoomMessage(DISPOSABLE_HOMESERVER, room.agent.accessToken, room.roomId, {
      msgtype: 'm.text',
      body: 'Started the placeholder check.',
      'm.relates_to': { rel_type: 'm.thread', event_id: room.rootId },
      'io.mindroom.tool_trace': {
        version: 2,
        events: [
          {
            type: 'tool_call_completed',
            tool_name: 'run_shell_command',
            args_preview: LONG_ARGS,
            tool_call_id: 'call_shell',
          },
        ],
      },
    });
    await expect(page.getByText('Started the placeholder check.', { exact: true })).toBeVisible();
    const startedAt = (secondsAgo: number) =>
      new Date(Date.now() - secondsAgo * 1000).toISOString();
    await sendStateEvent(
      DISPOSABLE_HOMESERVER,
      room.agent.accessToken,
      room.roomId,
      'io.mindroom.background_jobs',
      room.agent.userId,
      {
        jobs: [
          ...Array.from({ length: RUNS }, (_, index) => ({
            job_id: `job_${index}`,
            thread_id: room.rootId,
            status: 'running',
            requester_id: room.viewer.userId,
            kind: 'subagent',
            tool: 'panels',
            subagent: `sub-${index}`,
            run: runId(index),
            started_at: startedAt(40 + index),
          })),
          {
            job_id: 'job_shell',
            thread_id: room.rootId,
            status: 'running',
            requester_id: room.viewer.userId,
            kind: 'tool',
            tool: 'run_shell_command',
            tool_call_id: 'call_shell',
            started_at: startedAt(20),
          },
        ],
      }
    );

    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: 'dark' });
    for (const rootSize of rootSizes) {
      await page.goto(
        `/home/${encodeURIComponent(room.roomId)}?threadId=${encodeURIComponent(room.rootId)}`
      );
      await page.addStyleTag({ content: `html { font-size: ${rootSize} !important; }` });
      const name = `${RUNS + 1} background jobs`;
      const bar = page.getByRole('region', { name });
      await expect(bar).toBeVisible({ timeout: 30_000 });
      await sendRuns(room);
      await bar.getByRole('button', { name: new RegExp(`^${name}`) }).click();
      await expect(bar.locator('li')).toHaveCount(RUNS + 1);
      await expect(bar.locator('li[data-job-depth="3"]').first()).toBeVisible();
      await expect(bar.locator('li[data-job-kind="tool"] [data-job-activity]')).toHaveText(
        LONG_ARGS
      );
      const stats = await bar.locator('li [data-job-stat="calls"]').first().isVisible();
      const barWidth = await bar.evaluate((el) => el.getBoundingClientRect().width);
      const sizes = await measure(page);
      testInfo.annotations.push({
        type: 'measure',
        description: `${viewport.width}px root ${rootSize}: bar ${barWidth}px, stats ${
          stats ? 'shown' : 'hidden'
        }, ${JSON.stringify(sizes)}`,
      });
      console.log(
        `${viewport.width}px root ${rootSize}: bar ${barWidth}px stats ${
          stats ? 'shown' : 'hidden'
        }`,
        JSON.stringify(sizes)
      );
      await bar.screenshot({
        path: testInfo.outputPath(`jobs-list-${viewport.width}-${rootSize.replace('%', '')}.png`),
      });
      await bar.locator('ul[role="list"]').last().scrollIntoViewIfNeeded();
      await bar.screenshot({
        path: testInfo.outputPath(
          `jobs-list-${viewport.width}-${rootSize.replace('%', '')}-end.png`
        ),
      });
      expect
        .soft(sizes.scrollWidth, `${rootSize}: ${sizes.wide.join('; ')}`)
        .toBeLessThanOrEqual(sizes.clientWidth);
      expect.soft(sizes.scrollLeft, rootSize).toBe(0);
    }
  });
}
