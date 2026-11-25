import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import {
  allowActiveRunsState,
  allowBackgroundJobsState,
  joinRoom,
  matrixFetch,
  publishActiveRuns,
  registerAgentAccount,
  sendRoomMessage,
  sendStateEvent,
  setAccountData,
} from '../helpers/matrix';

/**
 * Verifies that Jump to Latest shares the dock row with typing without shifting vertically on
 * desktop wide, narrow split-pane width, and phone viewports, lifts cleanly above full-width
 * background-job bars, and returns to its low dock-sharing position when jobs clear, while the
 * timeline minimap rail stays vertically still on fine-pointer viewports across dock changes.
 */
const PASSWORD = 'PlaceholderPass!23';
const RUN = Date.now().toString(36);
const TURN_COUNT = 16;
const SHOTS = process.env.JUMP_TO_LATEST_TYPING_SHOTS;

type ViewportCase = {
  label: string;
  narrow: boolean;
  useOptions: Parameters<typeof test.use>[0];
};

const CASES: ViewportCase[] = [
  {
    label: 'desktop',
    narrow: false,
    useOptions: { viewport: { width: 1280, height: 800 } },
  },
  {
    label: 'narrow',
    narrow: true,
    useOptions: { viewport: { width: 480, height: 800 } },
  },
  {
    label: 'phone',
    narrow: true,
    useOptions: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
  },
];

type RectBounds = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
};

const boundsOf = async (locator: Locator, name: string): Promise<RectBounds> => {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${name} has no bounding box`);
  return {
    left: box.x,
    right: box.x + box.width,
    top: box.y,
    bottom: box.y + box.height,
    width: box.width,
    height: box.height,
  };
};

const readThreadInsets = (page: Page) =>
  page.evaluate(() => {
    const footer = document.querySelector<HTMLElement>('[data-footer-of="thread"]');
    if (!footer) return null;
    const style = getComputedStyle(footer);
    const composer = Number.parseFloat(style.getPropertyValue('--room-composer-height'));
    const footerHeight = Number.parseFloat(style.getPropertyValue('--room-footer-height'));
    if (!Number.isFinite(composer) || !Number.isFinite(footerHeight)) return null;
    return {
      composer,
      composerOffsetHeight: footer.offsetHeight,
      footerHeight,
      dock: footerHeight - composer,
    };
  });

const saveShot = async (page: Page, name: string): Promise<void> => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.mouse.move(0, 0);
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
};

const verifyJumpToLatestStableWithTyping = async (
  page: Page,
  { label, narrow }: Pick<ViewportCase, 'label' | 'narrow'>
): Promise<void> => {
  const viewer = await registerDisposableUser(`jtl_viewer_${label}_${RUN}`, PASSWORD);
  const agent = await registerAgentAccount(HOMESERVER, `helper_${label}`);
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(viewer.userId)}/displayname`, {
    method: 'PUT',
    accessToken: viewer.accessToken,
    body: JSON.stringify({ displayname: 'Avery' }),
  });
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(agent.userId)}/displayname`, {
    method: 'PUT',
    accessToken: agent.accessToken,
    body: JSON.stringify({ displayname: 'Helper' }),
  });
  await setAccountData(HOMESERVER, viewer.accessToken, viewer.userId, 'io.mindroom.settings', {
    tourOffered: true,
  });

  const roomId = await createRoom(HOMESERVER, viewer.accessToken, {
    name: `Placeholder room ${label}`,
    invite: [agent.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  await allowActiveRunsState(HOMESERVER, viewer.accessToken, roomId);
  await allowBackgroundJobsState(HOMESERVER, viewer.accessToken, roomId);

  const rootId = await sendRoomMessage(HOMESERVER, viewer.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Placeholder thread message 1: starting the check.',
  });
  let previousEventId = rootId;
  let latestReplyBody = '';
  for (let turn = 1; turn <= TURN_COUNT; turn += 1) {
    if (turn > 1) {
      previousEventId = await sendRoomMessage(HOMESERVER, viewer.accessToken, roomId, {
        msgtype: 'm.text',
        body: `Placeholder thread message ${turn}: checking item ${turn}.`,
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: rootId,
          is_falling_back: true,
          'm.in_reply_to': { event_id: previousEventId },
        },
      });
    }
    latestReplyBody = `Placeholder thread reply ${turn}: item ${turn} is ready.`;
    previousEventId = await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
      msgtype: 'm.text',
      body: latestReplyBody,
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: rootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: previousEventId },
      },
    });
  }

  const setTyping = (typing: boolean) =>
    matrixFetch(
      HOMESERVER,
      `/rooms/${encodeURIComponent(roomId)}/typing/${encodeURIComponent(agent.userId)}`,
      {
        method: 'PUT',
        accessToken: agent.accessToken,
        body: JSON.stringify({ typing, timeout: 120_000 }),
      }
    );

  const publishBackgroundJobs = (jobs: Record<string, unknown>[]) =>
    sendStateEvent(
      HOMESERVER,
      agent.accessToken,
      roomId,
      'io.mindroom.background_jobs',
      agent.userId,
      { jobs }
    );

  await page.route('**/v1/local-mindroom/connections', (route) =>
    route.fulfill({ json: { connections: [] } })
  );
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: viewer.username,
    password: PASSWORD,
    showToolCalls: false,
  });
  await page.goto(`/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`);

  const threadFooter = page.locator('[data-footer-of="thread"]');
  const threadArea = threadFooter.locator('xpath=../..');
  const scroller = threadArea.locator('[data-thread-count]').locator('xpath=../..');
  const jumpToLatest = threadArea.getByRole('button', { name: 'Jump to Latest', exact: true });
  const typingStrip = threadArea.getByRole('status').filter({ hasText: 'Helper is typing...' });
  const jobsBar = threadArea.locator('[data-jobs-bar]');
  const minimapRail = threadArea.getByTestId('timeline-minimap').getByRole('slider');

  await expect(threadArea.getByText(latestReplyBody).first()).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollHeight - element.clientHeight), {
      timeout: 30_000,
    })
    .toBeGreaterThan(400);

  await expect
    .poll(
      async () => {
        await scroller.evaluate((element) => {
          element.scrollTop = 0;
          element.dispatchEvent(new Event('scroll', { bubbles: true }));
        });
        return jumpToLatest.isVisible();
      },
      { timeout: 15_000 }
    )
    .toBe(true);

  await expect(typingStrip).toHaveCount(0);
  await expect(jobsBar).toHaveCount(0);
  await expect
    .poll(async () => {
      const insets = await readThreadInsets(page);
      return insets !== null && insets.composer > 0 && insets.dock === 0;
    })
    .toBe(true);
  await page.mouse.move(0, 0);

  const composerBox = await boundsOf(threadFooter, 'Thread composer footer');
  const emptyBox = await boundsOf(jumpToLatest, 'Jump to Latest (empty dock)');
  const emptyGapAboveComposer = composerBox.top - emptyBox.bottom;
  if (narrow) {
    expect(emptyGapAboveComposer).toBeGreaterThanOrEqual(7);
    expect(emptyGapAboveComposer).toBeLessThanOrEqual(9);
    expect(emptyBox.width).toBeLessThanOrEqual(34);
    expect(emptyBox.height).toBeLessThanOrEqual(34);
    expect(Math.abs(emptyBox.width - emptyBox.height)).toBeLessThanOrEqual(1);
  } else {
    expect(emptyGapAboveComposer).toBeGreaterThanOrEqual(15);
    expect(emptyGapAboveComposer).toBeLessThanOrEqual(17);
    expect(emptyBox.width).toBeGreaterThan(90);
  }
  const readEmptyMinimapBox = async (): Promise<RectBounds | null> => {
    if (label === 'phone') return null;
    await expect(minimapRail).toBeVisible();
    return boundsOf(minimapRail, 'Timeline minimap rail (empty dock)');
  };
  const emptyMinimapBox = await readEmptyMinimapBox();
  const expectMinimapStill = async (state: string): Promise<void> => {
    if (!emptyMinimapBox) return;
    const currentBox = await boundsOf(minimapRail, `Timeline minimap rail (${state})`);
    expect(Math.abs(currentBox.top - emptyMinimapBox.top)).toBeLessThanOrEqual(1);
    expect(Math.abs(currentBox.bottom - emptyMinimapBox.bottom)).toBeLessThanOrEqual(1);
  };
  await saveShot(page, `empty-dock-${label}`);

  await publishActiveRuns(HOMESERVER, agent, roomId, [rootId]);
  await setTyping(true);
  await expect(typingStrip).toBeVisible({ timeout: 30_000 });
  await typingStrip.evaluate((element) =>
    Promise.all(
      element
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished)
    )
  );
  await expect
    .poll(async () => (await readThreadInsets(page))?.dock ?? 0)
    .toBeGreaterThanOrEqual(35);
  await saveShot(page, `typing-visible-${label}`);

  const typingJumpBox = await boundsOf(jumpToLatest, 'Jump to Latest (typing visible)');
  const stripBox = await boundsOf(typingStrip, 'Typing strip');
  expect(Math.abs(typingJumpBox.top - emptyBox.top)).toBeLessThanOrEqual(1);
  expect(Math.abs(typingJumpBox.bottom - emptyBox.bottom)).toBeLessThanOrEqual(1);
  expect(stripBox.right).toBeLessThanOrEqual(typingJumpBox.left - 8);
  expect(Math.abs(stripBox.top - typingJumpBox.top)).toBeLessThanOrEqual(2);
  await expectMinimapStill('typing-visible');

  if (label === 'phone') {
    await expect
      .poll(() => page.evaluate(() => matchMedia('(pointer: coarse)').matches), {
        timeout: 10_000,
      })
      .toBe(true);
    const probeTouchEdges = () =>
      jumpToLatest.evaluate((button) => {
        const rect = button.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const leftHit = document.elementFromPoint(centerX - 21, centerY);
        const rightHit = document.elementFromPoint(centerX + 21, centerY);
        const topHit = document.elementFromPoint(centerX, centerY - 21);
        const bottomHit = document.elementFromPoint(centerX, centerY + 21);
        return {
          width: rect.width,
          leftInside: !!leftHit && button.contains(leftHit),
          rightInside: !!rightHit && button.contains(rightHit),
          topInside: !!topHit && button.contains(topHit),
          bottomInside: !!bottomHit && button.contains(bottomHit),
        };
      });

    const defaultInsets = await readThreadInsets(page);
    expect(defaultInsets).not.toBeNull();
    const defaultTouch = await probeTouchEdges();
    expect(defaultTouch.leftInside).toBe(true);
    expect(defaultTouch.rightInside).toBe(true);
    expect(defaultTouch.topInside).toBe(true);
    expect(defaultTouch.bottomInside).toBe(true);

    const previousFontSize = await page.evaluate(() => document.documentElement.style.fontSize);
    try {
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '75%';
      });
      await expect
        .poll(async () => {
          const [insets, probe] = await Promise.all([readThreadInsets(page), probeTouchEdges()]);
          return (
            insets !== null && insets.composer === insets.composerOffsetHeight && probe.width <= 25
          );
        })
        .toBe(true);
      const zoomedTouch = await probeTouchEdges();
      expect(zoomedTouch.leftInside).toBe(true);
      expect(zoomedTouch.rightInside).toBe(true);
      expect(zoomedTouch.topInside).toBe(true);
      expect(zoomedTouch.bottomInside).toBe(true);
    } finally {
      await page.evaluate((size) => {
        document.documentElement.style.fontSize = size;
      }, previousFontSize);
      await expect
        .poll(async () => {
          const insets = await readThreadInsets(page);
          return (
            insets !== null &&
            insets.composer === insets.composerOffsetHeight &&
            Math.abs(insets.composer - (defaultInsets?.composer ?? 0)) <= 1
          );
        })
        .toBe(true);
    }
  }

  await setTyping(false);
  await publishActiveRuns(HOMESERVER, agent, roomId, []);
  await expect(typingStrip).toHaveCount(0, { timeout: 30_000 });
  await expect.poll(async () => (await readThreadInsets(page))?.dock).toBe(0);

  const clearedTypingBox = await boundsOf(jumpToLatest, 'Jump to Latest (typing cleared)');
  expect(Math.abs(clearedTypingBox.top - emptyBox.top)).toBeLessThanOrEqual(1);
  expect(Math.abs(clearedTypingBox.bottom - emptyBox.bottom)).toBeLessThanOrEqual(1);
  await expectMinimapStill('typing-cleared');

  await publishBackgroundJobs([
    {
      job_id: `job_${label}_${RUN}`,
      thread_id: rootId,
      kind: 'tool',
      tool: 'placeholder_task',
      status: 'running',
      requester_id: viewer.userId,
      started_at: new Date().toISOString(),
    },
  ]);
  await expect(jobsBar).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(
      async () => {
        const [jump, jobs] = await Promise.all([jumpToLatest.boundingBox(), jobsBar.boundingBox()]);
        return jump && jobs ? jobs.y - (jump.y + jump.height) : -Infinity;
      },
      { timeout: 15_000 }
    )
    .toBeGreaterThanOrEqual(15);
  await saveShot(page, `jobs-visible-${label}`);

  const jobsJumpBox = await boundsOf(jumpToLatest, 'Jump to Latest (jobs visible)');
  const jobsBox = await boundsOf(jobsBar, 'Background jobs bar');
  expect(jobsBox.top - jobsJumpBox.bottom).toBeGreaterThanOrEqual(15);
  await expectMinimapStill('jobs-visible');

  await publishBackgroundJobs([]);
  await expect(jobsBar).toHaveCount(0, { timeout: 30_000 });
  await expect.poll(async () => (await readThreadInsets(page))?.dock).toBe(0);

  const clearedJobsBox = await boundsOf(jumpToLatest, 'Jump to Latest (jobs cleared)');
  expect(Math.abs(clearedJobsBox.top - emptyBox.top)).toBeLessThanOrEqual(1);
  expect(Math.abs(clearedJobsBox.bottom - emptyBox.bottom)).toBeLessThanOrEqual(1);
  await expectMinimapStill('jobs-cleared');

  await jumpToLatest.click();
  await expect(jumpToLatest).toBeHidden({ timeout: 15_000 });
  await expect
    .poll(
      () =>
        scroller.evaluate(
          (element) => element.scrollHeight - element.scrollTop - element.clientHeight
        ),
      { timeout: 15_000 }
    )
    .toBeLessThanOrEqual(2);
  await expect(threadArea.getByText(latestReplyBody).first()).toBeVisible({ timeout: 15_000 });
  await expectMinimapStill('at-bottom');
};

test.use({ launchOptions: CHROMIUM_WITH_SCROLLBARS });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

for (const { label, narrow, useOptions } of CASES) {
  test.describe(label, () => {
    test.use(useOptions);

    test(`Jump to Latest shares the dock with typing and lifts for jobs (${label})`, async ({
      page,
    }) => {
      test.setTimeout(180_000);
      await verifyJumpToLatestStableWithTyping(page, { label, narrow });
    });
  });
}
