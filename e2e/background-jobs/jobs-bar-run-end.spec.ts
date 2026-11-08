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
import { jobsBarChanges, watchJobsBar } from '../helpers/jobsBar';
import { joinRoom, matrixFetch, sendRoomMessage, sendStateEvent } from '../helpers/matrix';
import { onWebKitPage } from '../helpers/webkit';

// The jobs bar keeps an agent's tool call after it ends while the agent's reply streams, since the
// agent's next call may follow however long it thinks, and shows it as finished, without Stop. It
// goes 2 s after the reply ends. With a fixed 2 s hold the bar left during a longer pause and came
// back with the next call. Runs in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names
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

const barHoldsForTheReply = async (page: Page, label: string) => {
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
  const height = async () => (await bar.boundingBox())?.height;
  await watchJobsBar(page);

  // Between two calls the bar stays, however long the agent thinks, and shows the call as finished.
  await publish(agent, [job('job_1')]);
  await expect(bar).toHaveAccessibleName('Running: run_shell_command', { timeout: 15_000 });
  const runningHeight = await height();
  await publish(agent, []);
  await expect(bar).toHaveAccessibleName('Finished: run_shell_command');
  await expect(bar.getByRole('button')).toHaveCount(0);
  expect(await height(), 'the bar’s height once its call finished').toBe(runningHeight);
  await page.waitForTimeout(3_000);
  await expect(bar, 'the bar after a pause longer than 2 s').toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/jobs-run-end-${label}-between.png` });
  await publish(agent, [job('job_2')]);
  await expect(bar).toHaveAccessibleName('Running: run_shell_command');

  // The last call ends, then the reply finishes: the bar goes 2 s after the reply.
  await publish(agent, []);
  await expect(bar).toHaveAccessibleName('Finished: run_shell_command');
  const finishSent = Date.now();
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
  await expect(bar, 'the bar after the reply finished').toBeHidden({ timeout: 10_000 });
  const changes = await jobsBarChanges(page);
  expect(
    changes.map((change) => change.label),
    'the bar never left before the reply finished'
  ).toEqual([
    null,
    'Running: run_shell_command',
    'Finished: run_shell_command',
    'Running: run_shell_command',
    'Finished: run_shell_command',
    null,
  ]);
  expect(
    changes[changes.length - 1].at - finishSent,
    'ms from the reply’s end until the bar went'
  ).toBeGreaterThanOrEqual(1_900);
};

test('the jobs bar stays while the agent’s reply streams, and goes 2 s after it (Chromium)', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await barHoldsForTheReply(page, 'chromium');
});

test('the jobs bar stays while the agent’s reply streams, and goes 2 s after it (WebKit)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(180_000);
  await onWebKitPage({ viewport: { width: 1280, height: 800 }, baseURL }, (page) =>
    barHoldsForTheReply(page, 'webkit')
  );
});
