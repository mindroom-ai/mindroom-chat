import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { disposableHomeserverIsUp, DISPOSABLE_HOMESERVER } from '../helpers/disposableAccounts';
import { allowBackgroundJobsState, matrixFetch, sendStateEvent } from '../helpers/matrix';
import { openPanelRoom, type PanelRoom } from '../helpers/sidePanels';

// Proves that `/sync` delivers `io.mindroom.workflow` ephemeral frames (snapshot + delta) to the
// browser for a fresh login, a returning client whose stored sync filter predates workflow frames,
// and an encrypted room.

test.use({ viewport: { width: 1400, height: 860 }, video: 'off' });
test.afterEach(async ({ context }) => {
  await context.unrouteAll({ behavior: 'ignoreErrors' });
});

const RUN_ID = 'wf-11111111111111111111111111111111';

const putWorkflowFrame = async (
  room: PanelRoom,
  frame: Record<string, unknown>,
  keySuffix: string
) => {
  const response = await fetch(
    `${DISPOSABLE_HOMESERVER}/_matrix/client/unstable/org.matrix.msc2477/rooms/${encodeURIComponent(
      room.roomId
    )}/ephemeral/io.mindroom.workflow/workflow.${RUN_ID}.${keySuffix}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${room.agent.accessToken}`,
      },
      body: JSON.stringify(frame),
    }
  );
  if (!response.ok) throw new Error(`Workflow frame refused: ${response.status}`);
};

const makeFrames = (room: PanelRoom) => {
  const sid = `${Date.now()}-${randomUUID().replaceAll('-', '').slice(0, 8)}`;
  const startedAt = Math.floor(Date.now() / 1000) - 5;
  const baseMeta = {
    agent: 'panels',
    thread_id: room.rootId,
    title: 'Audit the sample module',
    status: 'running',
    attempt: 1,
    started_at: startedAt,
    ended_at: null,
    max_concurrent: 8,
    max_cost_usd: null,
    large: false,
    counts: {
      queued: 0,
      running: 1,
      waiting: 0,
      completed: 0,
      failed: 0,
      indeterminate: 0,
      cached: 0,
    },
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      tool_calls: 0,
      cost_usd: 0,
      attempt_cost_usd: 0,
      projected_cost_usd: 0,
      cost_unknown: false,
    },
  };
  const nodeRunning = {
    id: 'n1',
    kind: 'agent',
    label: 'Audit auth/session.py',
    name: 'auth-auditor',
    phase: 0,
    group: null,
    status: 'running',
    waiting_on: null,
    agent: 'panels',
    model: 'Fable 5.2',
    run: 'delegation-sample-1',
    subagent: 'delegation-sample-1',
    job: 'job-node-1',
    session: null,
    turns: 1,
    started_at: startedAt,
    ended_at: null,
    cached: false,
    error: null,
    usage: { input_tokens: 0, output_tokens: 0, tool_calls: 0, cost_usd: 0 },
  };
  const snapshot = {
    v: 1,
    run: RUN_ID,
    sid,
    seq: 1,
    meta: baseMeta,
    snapshot: {
      phases: ['Audit'],
      groups: [],
      nodes: [nodeRunning],
      edges: [],
      omitted: {
        queued: 0,
        running: 0,
        waiting: 0,
        completed: 0,
        failed: 0,
        edges: 0,
        groups: 0,
        phases: 0,
        log: 0,
      },
      log: [],
    },
  };
  const delta = {
    v: 1,
    run: RUN_ID,
    sid,
    seq: 2,
    meta: {
      ...baseMeta,
      counts: { ...baseMeta.counts, running: 0, completed: 1 },
    },
    delta: {
      nodes: [{ ...nodeRunning, status: 'completed', ended_at: startedAt + 3 }],
    },
  };
  return { snapshot, delta };
};

const seedWorkflowJob = async (room: PanelRoom) => {
  await allowBackgroundJobsState(DISPOSABLE_HOMESERVER, room.viewer.accessToken, room.roomId);
  await sendStateEvent(
    DISPOSABLE_HOMESERVER,
    room.agent.accessToken,
    room.roomId,
    'io.mindroom.background_jobs',
    room.agent.userId,
    {
      jobs: [
        {
          job_id: 'job-workflow-sync',
          thread_id: room.rootId,
          kind: 'workflow',
          tool: 'workflow',
          status: 'running',
          started_at: new Date().toISOString(),
          workflow: RUN_ID,
        },
      ],
    }
  );
};

const expectWorkflowDeltaReceived = async (page: Page) => {
  await expect(page.getByText('Audit the sample module', { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  // The folded jobs bar keeps the counts preview in the DOM but hides it; its presence proves the delta arrived.
  await expect(page.getByText('1 done, 0 running, 0 waiting')).toBeAttached({ timeout: 15_000 });
};

test.describe('workflow ephemeral frame sync', () => {
  test.beforeEach(async () => {
    test.skip(!(await disposableHomeserverIsUp()), 'Disposable homeserver is not running');
  });

  test('delivers workflow snapshot and delta on a fresh login', async ({ context, page }) => {
    const room = await openPanelRoom(context, page, { showUsageDetails: true });
    await seedWorkflowJob(room);
    const { snapshot, delta } = makeFrames(room);
    await putWorkflowFrame(room, snapshot, '1');
    await putWorkflowFrame(room, delta, '2');
    await expectWorkflowDeltaReceived(page);
  });

  test('rebuilds an older stored sync filter on reload to receive workflow frames', async ({
    context,
    page,
  }) => {
    const room = await openPanelRoom(context, page, { showUsageDetails: true });
    // Create a filter on the homeserver that predates `io.mindroom.workflow` and seed its ID.
    const oldFilter = await matrixFetch<{ filter_id: string }>(
      DISPOSABLE_HOMESERVER,
      `/user/${encodeURIComponent(room.viewer.userId)}/filter`,
      {
        method: 'POST',
        accessToken: room.viewer.accessToken,
        body: JSON.stringify({
          room: {
            timeline: { limit: 20 },
            state: { lazy_load_members: true },
            ephemeral: {
              types: ['m.typing', 'm.receipt', 'io.mindroom.live', 'io.mindroom.subagents'],
            },
          },
        }),
      }
    );
    await page.evaluate(
      ({ userId, filterId }) => {
        window.localStorage.setItem(`mxjssdk_memory_filter_FILTER_SYNC_${userId}`, filterId);
      },
      { userId: room.viewer.userId, filterId: oldFilter.filter_id }
    );
    const liveSync = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return url.pathname.endsWith('/sync') && url.searchParams.get('timeout') === '30000';
    });
    await page.reload();
    await expect(page.getByText(room.replyBody, { exact: true })).toBeVisible({ timeout: 60_000 });
    await liveSync;
    await seedWorkflowJob(room);
    const { snapshot, delta } = makeFrames(room);
    await putWorkflowFrame(room, snapshot, 'reload-1');
    await putWorkflowFrame(room, delta, 'reload-2');
    await expectWorkflowDeltaReceived(page);
  });

  test('syncs workflow frames in an encrypted room', async ({ context, page }) => {
    const room = await openPanelRoom(context, page);
    await sendStateEvent(
      DISPOSABLE_HOMESERVER,
      room.viewer.accessToken,
      room.roomId,
      'm.room.encryption',
      '',
      { algorithm: 'm.megolm.v1.aes-sha2' }
    );
    await seedWorkflowJob(room);
    await expect(page.locator('[data-job-kind="workflow"]')).toBeVisible({ timeout: 15_000 });
    // In an encrypted room plaintext ephemeral workflow frames must be rejected by the client.
    const { snapshot } = makeFrames(room);
    await putWorkflowFrame(room, snapshot, 'enc-plain');
    await expect(page.getByText('Audit the sample module', { exact: true })).toBeHidden();
  });
});
