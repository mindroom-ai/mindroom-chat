import { expect, test, type Page } from '@playwright/test';
import { getHomeserver } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  joinRoom,
  matrixFetch,
  registerAgentAccount,
  seedRoomOverviewState,
  sendRoomMessage,
  sendStateEvent,
} from '../helpers/matrix';

// An agent caught in a loop asks for approvals faster than anyone answers them, and the runtime
// denies the older ones as their jobs end; its published jobs state stops changing (the runtime's
// writes are refused). The thread's counts follow what the server holds while the requests keep
// coming: the approval bar's Review count is the approvals still pending, and the jobs bar shows
// the published state, with every job Stopping… once Stop all is pressed. The sizes are those of
// the loop live testing met (105 jobs, about 140 approvals pending). Chromium and WebKit.
// Set APPROVAL_STORM_SHOTS=<directory> to save the thread at the end.
const PASSWORD = 'approval-storm-counts-password';
const SHOTS = process.env.APPROVAL_STORM_SHOTS;
/** Approval requests the agent sends, and how many stay pending at the end. */
const REQUESTS = 300;
const PENDING = 140;
const JOBS = 105;

type Account = { username: string; userId: string; accessToken: string };

const register = async (prefix: string): Promise<Account> => {
  const username = `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const body = await matrixFetch<{ user_id: string; access_token: string }>(
    getHomeserver(),
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
    }
  );
  return { username, userId: body.user_id, accessToken: body.access_token };
};

const approvalContent = (id: string, viewer: string, rootId: string, index: number) => ({
  msgtype: 'io.mindroom.tool_approval',
  body: 'Approval required: run_shell_command',
  approval_id: id,
  tool_name: 'run_shell_command',
  agent_name: 'helper',
  status: 'pending',
  approvable: true,
  approver_user_id: viewer,
  requester_id: viewer,
  arguments: { command: `echo deploy step ${index}` },
  requested_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  thread_id: rootId,
});

const sendApprovalEvent = async (
  homeserver: string,
  agent: { accessToken: string },
  roomId: string,
  txnId: string,
  content: Record<string, unknown>
): Promise<string> =>
  (
    await matrixFetch<{ event_id: string }>(
      homeserver,
      `/rooms/${encodeURIComponent(roomId)}/send/io.mindroom.tool_approval/${txnId}`,
      { method: 'PUT', accessToken: agent.accessToken, body: JSON.stringify(content) }
    )
  ).event_id;

const savePicture = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

test.use({ viewport: { width: 1280, height: 800 } });

test('approval and job counts follow the server during an approval storm @webkit', async ({
  page,
  browserName,
}) => {
  test.setTimeout(300_000);
  const homeserver = getHomeserver();
  const viewer = await register('storm_viewer');
  const agent = await registerAgentAccount(homeserver, 'helper');
  const roomId = (
    await matrixFetch<{ room_id: string }>(homeserver, '/createRoom', {
      method: 'POST',
      accessToken: viewer.accessToken,
      body: JSON.stringify({
        preset: 'private_chat',
        name: `Approval storm ${Date.now().toString(36)}`,
        invite: [agent.userId],
        // MindRoom lets its agents publish their jobs.
        power_level_content_override: { events: { 'io.mindroom.background_jobs': 0 } },
      }),
    })
  ).room_id;
  await joinRoom(homeserver, agent.accessToken, roomId);
  const rootId = await sendRoomMessage(homeserver, viewer.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Deploy the staging build and run the smoke checks',
  });
  const inThread = {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: rootId },
  };
  await sendRoomMessage(homeserver, agent.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Starting the deploy in the background.',
    'm.relates_to': inThread,
  });
  await sendStateEvent(
    homeserver,
    agent.accessToken,
    roomId,
    'io.mindroom.background_jobs',
    agent.userId,
    {
      jobs: Array.from({ length: JOBS }, (_, index) => ({
        job_id: `job_${index}`,
        thread_id: rootId,
        kind: 'tool',
        tool: 'run_shell_command',
        status: 'awaiting_approval',
        requester_id: viewer.userId,
        started_at: `2026-11-06T12:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(
          index % 60
        ).padStart(2, '0')}+00:00`,
      })),
    }
  );

  await loginWithPassword(page, { homeserver, username: viewer.username, password: PASSWORD });
  await seedRoomOverviewState({ page, roomId, userId: viewer.userId, viewMode: 'threaded' });
  await page.goto(`/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`);
  await expect(page.getByText('Starting the deploy in the background.')).toBeVisible({
    timeout: 30_000,
  });
  const jobsBar = page.getByRole('region', { name: `${JOBS} background jobs` });
  await expect(jobsBar).toBeVisible();
  const review = page
    .getByRole('region', { name: 'Thread approvals' })
    .getByRole('button', { name: /^Review/ });

  const sent: string[] = [];
  /** The agent asks for the next approval and denies the oldest one past `PENDING` pending. */
  const storm = async (count: number) => {
    for (let step = 0; step < count; step += 1) {
      const index = sent.length;
      const id = `storm-${index}`;
      // eslint-disable-next-line no-await-in-loop
      sent.push(
        await sendApprovalEvent(homeserver, agent, roomId, id, {
          ...approvalContent(id, viewer.userId, rootId, index),
          'm.relates_to': inThread,
        })
      );
      const ended = index - PENDING;
      if (ended >= 0) {
        // eslint-disable-next-line no-await-in-loop
        await sendApprovalEvent(homeserver, agent, roomId, `${id}-denied`, {
          msgtype: 'io.mindroom.tool_approval',
          body: '* Denied: run_shell_command',
          'm.new_content': {
            ...approvalContent(`storm-${ended}`, viewer.userId, rootId, ended),
            status: 'denied',
            resolved_by: null,
            resolution_reason:
              'The background job asking for this approval ended before a decision.',
          },
          'm.relates_to': { rel_type: 'm.replace', event_id: sent[ended] },
        });
      }
    }
  };

  await storm(REQUESTS / 2);
  // The Review count is the approvals pending on the server, while the requests keep coming.
  await expect(review).toHaveText(`Review ${PENDING}`, { timeout: 30_000 });
  // Stop all asks every listed job to stop; each shows Stopping… while the published state lists it.
  await jobsBar.getByRole('button', { name: 'Stop all' }).click();
  await expect(jobsBar.getByRole('button', { name: 'Stop all' })).toHaveCount(0);
  await storm(REQUESTS / 2);
  await expect(review).toHaveText(`Review ${PENDING}`, { timeout: 30_000 });
  await expect(jobsBar).toBeVisible();
  await expect(jobsBar.getByRole('button', { name: 'Stop all' })).toHaveCount(0);
  await jobsBar.getByRole('button', { name: `${JOBS} background jobs` }).click();
  await expect(jobsBar.getByText('Stopping…')).toHaveCount(JOBS);
  await savePicture(page, `approval-storm-${browserName}`);
});
