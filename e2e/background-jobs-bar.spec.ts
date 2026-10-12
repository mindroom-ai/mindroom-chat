import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { loginWithPassword } from './helpers/auth';
import { createThreadFixture, joinRoom, matrixFetch, sendStateEvent } from './helpers/matrix';

// Explicit opt-in to an isolated, disposable local Matrix server with open registration.
const homeserver = process.env.E2E_UI_ACTIONS_HOMESERVER;
test.use({ video: 'off' });

type MessagesPage = {
  chunk: { type: string; sender: string; content: Record<string, unknown> }[];
};

test('the jobs bar lists agents’ background jobs, cancels them, and marks the room', async ({
  page,
  context,
}, testInfo) => {
  test.skip(!homeserver, 'Set E2E_UI_ACTIONS_HOMESERVER to a disposable local Matrix server.');
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const password = randomUUID();
  const register = (username: string) =>
    matrixFetch<{ access_token: string; user_id: string }>(homeserver!, '/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, auth: { type: 'm.login.dummy' } }),
    });
  const username = `jobs_viewer_${suffix}`;
  const viewer = await register(username);
  const coder = await register(`mindroom_coder_${suffix}`);
  const researcher = await register(`mindroom_researcher_${suffix}`);
  const fixture = await createThreadFixture(homeserver!, viewer.access_token, {
    name: 'Release prep',
    topic: 'Background jobs bar',
    rootBody: 'Run the test suite and check the changelog',
    replyBody: 'Started the suite in the background',
    invite: [coder.user_id, researcher.user_id],
  });
  await joinRoom(homeserver!, coder.access_token, fixture.roomId);
  await joinRoom(homeserver!, researcher.access_token, fixture.roomId);
  // MindRoom lets its agents publish their jobs; this room's creator does the same.
  const powerLevelsPath = `/rooms/${encodeURIComponent(fixture.roomId)}/state/m.room.power_levels`;
  const powerLevels = await matrixFetch<Record<string, unknown>>(homeserver!, powerLevelsPath, {
    accessToken: viewer.access_token,
  });
  await sendStateEvent(
    homeserver!,
    viewer.access_token,
    fixture.roomId,
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
  const job = (jobId: string, threadId: string | null, tool: string, extra = {}) => ({
    job_id: jobId,
    thread_id: threadId,
    kind: 'tool',
    tool,
    status: 'running',
    requester_id: viewer.user_id,
    started_at: `2026-10-11T12:00:0${jobId.slice(-1)}+00:00`,
    ...extra,
  });
  const publish = (agent: typeof coder, jobs: Record<string, unknown>[]) =>
    sendStateEvent(
      homeserver!,
      agent.access_token,
      fixture.roomId,
      'io.mindroom.background_jobs',
      agent.user_id,
      { jobs }
    );
  const coderJobs = [
    job('job_1', fixture.rootId, 'run_tests'),
    job('job_2', fixture.rootId, 'shell', { status: 'awaiting_approval' }),
  ];
  await publish(coder, coderJobs);
  await publish(researcher, [
    job('job_3', fixture.rootId, 'research', { kind: 'subagent' }),
    job('job_4', null, 'web_search'),
  ]);

  await context.route('**/config.json', async (route) => {
    const response = await route.fetch();
    const config = await response.json();
    await route.fulfill({
      json: {
        ...config,
        homeserverList: [homeserver],
        defaultHomeserver: 0,
        allowCustomHomeservers: true,
        hashRouter: { enabled: false },
        auth: { allowRegistration: false, disablePasswordLogin: false },
      },
    });
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await loginWithPassword(page, { homeserver: homeserver!, username, password });

  // The room list marks the room while it has jobs.
  await expect(page.getByLabel('Background jobs running')).toBeVisible();

  // The thread shows its own three jobs, not the main timeline's.
  await page.goto(
    `/home/${encodeURIComponent(fixture.roomId)}?threadId=${encodeURIComponent(fixture.rootId)}`
  );
  await expect(page.getByText(fixture.replyBody, { exact: true })).toBeVisible();
  const bar = page.getByRole('region', { name: '3 background jobs' });
  await expect(bar).toBeVisible();
  await expect(bar).toContainText('run_tests');
  await expect(bar).toContainText('Waiting for approval: shell');
  await expect(bar).toContainText('Subagent: research');
  await expect(bar).not.toContainText('web_search');
  await page.screenshot({ path: testInfo.outputPath('desktop-light.png') });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: testInfo.outputPath('desktop-dark.png') });

  // ✕ sends the job's cancel in its thread, and the job shows Stopping… until it leaves the state.
  await bar.getByRole('button', { name: 'Cancel run_tests' }).click();
  await expect(bar).toContainText('Stopping…');
  await expect
    .poll(async () => {
      const messages = await matrixFetch<MessagesPage>(
        homeserver!,
        `/rooms/${encodeURIComponent(fixture.roomId)}/messages?dir=b&limit=20`,
        { accessToken: viewer.access_token }
      );
      return messages.chunk
        .filter((event) => event.type === 'io.mindroom.background_job_cancel')
        .map((event) => ({ sender: event.sender, content: event.content }));
    })
    .toEqual([
      {
        sender: viewer.user_id,
        content: {
          job_id: 'job_1',
          'm.relates_to': { rel_type: 'm.thread', event_id: fixture.rootId },
        },
      },
    ]);
  await publish(coder, [{ ...coderJobs[0], status: 'cancel_requested' }, coderJobs[1]]);
  await expect(bar.getByRole('button', { name: 'Cancel run_tests' })).toHaveCount(0);
  await publish(coder, [coderJobs[1]]);
  await expect(page.getByRole('region', { name: '2 background jobs' })).not.toContainText(
    'run_tests'
  );

  // The main timeline shows every job of the room.
  await page.goto(`/home/${encodeURIComponent(fixture.roomId)}`);
  await expect(page.getByRole('region', { name: '3 background jobs' })).toContainText('web_search');

  // On a phone, the bar sits above the composer in light and dark.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(
    `/home/${encodeURIComponent(fixture.roomId)}?threadId=${encodeURIComponent(fixture.rootId)}`
  );
  await expect(page.getByRole('region', { name: '2 background jobs' })).toBeVisible();
  await expect(page.getByText(/^Catching up/)).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('phone-dark.png') });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({ path: testInfo.outputPath('phone-light.png') });

  // When the last job ends, the bar goes away.
  await publish(coder, []);
  await publish(researcher, []);
  await expect(page.getByRole('region', { name: /background jobs|Running|Waiting/ })).toHaveCount(
    0
  );
});
