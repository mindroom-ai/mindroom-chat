import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  type DisposableUser,
} from '../helpers/disposableAccounts';
import { joinRoom, matrixFetch, sendRoomMessage, sendStateEvent } from '../helpers/matrix';
import { onWebKitPage } from '../helpers/webkit';

// The jobs bar keeps an agent's last tool call for a moment after it ends, since the agent's next
// call usually follows. Once the agent's reply has finished, no call follows: the bar went only
// when that moment ran out, showing "Running" and a Stop button for a finished run for about
// 1.6 s (live-test finding P2-lane4-F010). It now goes as soon as the reply finishes, and still
// stays between two calls. Runs in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names
// Playwright's WebKit, in WebKit, against the disposable homeserver of `just hs-up` (or a slot of
// scripts/e2e-slot.sh). Set JOBS_RUN_END_SHOTS=<directory> for screenshots.
const PASSWORD = 'jobs-bar-run-end-spec-password';
const RUN = Date.now().toString(36);
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
const SHOTS = process.env.JOBS_RUN_END_SHOTS;
const STATUS = 'io.mindroom.stream_status';

test.use({ viewport: { width: 1280, height: 800 }, launchOptions: CHROMIUM_WITH_SCROLLBARS });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const barGoesWithTheReply = async (page: Page, label: string) => {
  const viewer = await registerDisposableUser(`jre_viewer_${label}_${RUN}`, PASSWORD);
  const agent = await registerDisposableUser(`mindroom_coder_${label}_${RUN}`, PASSWORD);
  const roomId = await createRoom(HOMESERVER, viewer.accessToken, {
    name: `Release checks ${label}`,
    invite: [agent.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  // MindRoom lets its agents publish their jobs; this room's creator does the same.
  const powerLevelsPath = `/rooms/${encodeURIComponent(roomId)}/state/m.room.power_levels`;
  const powerLevels = await matrixFetch<Record<string, unknown>>(HOMESERVER, powerLevelsPath, {
    accessToken: viewer.accessToken,
  });
  await sendStateEvent(HOMESERVER, viewer.accessToken, roomId, 'm.room.power_levels', '', {
    ...powerLevels,
    events: {
      ...(powerLevels.events as Record<string, number>),
      'io.mindroom.background_jobs': 0,
    },
  });
  const rootId = await sendRoomMessage(HOMESERVER, viewer.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Run the release checks and tell me which ones fail.',
  });
  const inThread = { rel_type: 'm.thread', event_id: rootId, is_falling_back: true };
  const replyId = await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Running the release checks now.',
    [STATUS]: 'streaming',
    'm.relates_to': { ...inThread, 'm.in_reply_to': { event_id: rootId } },
  });
  const publish = (agentUser: DisposableUser, jobs: Record<string, unknown>[]) =>
    sendStateEvent(
      HOMESERVER,
      agentUser.accessToken,
      roomId,
      'io.mindroom.background_jobs',
      agentUser.userId,
      { jobs }
    );
  const job = (jobId: string) => ({
    job_id: jobId,
    thread_id: rootId,
    kind: 'tool',
    tool: 'run_shell_command',
    status: 'running',
    requester_id: viewer.userId,
    started_at: new Date().toISOString(),
  });

  await loginWithPassword(page, { homeserver: HOMESERVER, ...viewer });
  await page.goto(`/home/${encodeURIComponent(roomId)}/${encodeURIComponent(rootId)}`);
  await expect(page.getByText('Running the release checks now.').first()).toBeVisible({
    timeout: 30_000,
  });
  const bar = page.getByRole('region').filter({ hasText: 'run_shell_command' });

  // Between two calls the bar stays.
  await publish(agent, [job('job_1')]);
  await expect(bar).toBeVisible({ timeout: 15_000 });
  await publish(agent, []);
  await page.waitForTimeout(600);
  await expect(bar, 'the bar between two calls').toBeVisible();
  await publish(agent, [job('job_2')]);
  await expect(bar).toBeVisible();

  // The last call ends, then the reply finishes: the bar goes with the reply.
  const lastCallEnded = Date.now();
  await publish(agent, []);
  await page.waitForTimeout(300);
  await expect(bar, 'the bar after the last call, while the reply streams').toBeVisible();
  await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
    msgtype: 'm.text',
    body: '* All release checks passed.',
    'm.new_content': {
      msgtype: 'm.text',
      body: 'All release checks passed.',
      [STATUS]: 'completed',
    },
    'm.relates_to': { rel_type: 'm.replace', event_id: replyId },
  });
  await expect(page.getByText('All release checks passed.').first()).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/jobs-run-end-${label}-finished.png` });
  await expect(bar, 'the bar after the reply finished').toBeHidden({ timeout: 5_000 });
  // Well before the 2 s hold after the last call would run out.
  expect(Date.now() - lastCallEnded, 'ms from the last call’s end until the bar went').toBeLessThan(
    1_700
  );
};

test('the jobs bar goes when the agent’s reply finishes (Chromium)', async ({ page }) => {
  test.setTimeout(180_000);
  await barGoesWithTheReply(page, 'chromium');
});

test('the jobs bar goes when the agent’s reply finishes (WebKit)', async ({ baseURL }) => {
  test.skip(!WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(180_000);
  await onWebKitPage({ viewport: { width: 1280, height: 800 }, baseURL }, (page) =>
    barGoesWithTheReply(page, 'webkit')
  );
});
