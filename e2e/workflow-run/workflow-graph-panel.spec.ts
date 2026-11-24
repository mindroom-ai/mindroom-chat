import { expect, test, type Page } from '@playwright/test';
import { disposableHomeserverIsUp, DISPOSABLE_HOMESERVER } from '../helpers/disposableAccounts';
import { sendRoomMessage, sendStateEvent } from '../helpers/matrix';
import { roomHeader } from '../helpers/roomMenu';
import {
  checkPanelFrame,
  openPanelRoom,
  panelLocator,
  type PanelRoom,
} from '../helpers/sidePanels';

// Workflow graph panel e2e coverage:
// 1. Fixture screenshots at wide and phone widths, with a selected chip and message edges.
// 2. Live homeserver flow: Graph opens panel, delta updates a chip without reload, Open switches
//    to Sub-agents on that run, panel frame passes checkPanelFrame, finished card opens graph
//    after reload with no ephemeral history, and phone width covers conversation and Close returns.

const RUN_ID = 'wf-77777777777777777777777777777777';
const SUBAGENT_RUN = 'delegation-1';

const emptyOmitted = {
  queued: 0,
  running: 0,
  waiting: 0,
  completed: 0,
  failed: 0,
  edges: 0,
  groups: 0,
  phases: 0,
  log: 0,
};

const putWorkflowFrame = async (
  room: PanelRoom,
  frame: Record<string, unknown>,
  txnSuffix: string
) => {
  const response = await fetch(
    `${DISPOSABLE_HOMESERVER}/_matrix/client/unstable/org.matrix.msc2477/rooms/${encodeURIComponent(
      room.roomId
    )}/ephemeral/io.mindroom.workflow/workflow.${RUN_ID}.${txnSuffix}`,
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

const putSubagentFrame = async (room: PanelRoom, startedAt: number) => {
  const sid = `${Date.now()}-a1b2c3d4`;
  const response = await fetch(
    `${DISPOSABLE_HOMESERVER}/_matrix/client/unstable/org.matrix.msc2477/rooms/${encodeURIComponent(
      room.roomId
    )}/ephemeral/io.mindroom.subagents/subagents.${SUBAGENT_RUN}.1`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${room.agent.accessToken}`,
      },
      body: JSON.stringify({
        v: 1,
        run: SUBAGENT_RUN,
        sid,
        seq: 1,
        meta: {
          agent: 'panels',
          subagent: SUBAGENT_RUN,
          caller: 'panels',
          root: 'panels',
          parent: null,
          thread_id: room.rootId,
          source: 'workflow',
          status: 'running',
          started_at: startedAt,
          ended_at: null,
          model: {
            model_config: 'fable',
            model_display_name: 'Fable 5.2',
            model_provider: 'anthropic',
            model_id: 'claude-fable-5.2',
          },
        },
        snapshot: {
          md: 'Checking session rotation paths.',
          reasoning: '',
          tools: [],
          status: 'streaming',
          activity: 'Reading auth/session.py',
          segments: [],
        },
      }),
    }
  );
  if (!response.ok) throw new Error(`Subagent frame refused: ${response.status}`);
};

const seedLiveWorkflow = async (room: PanelRoom) => {
  const startedAt = Math.floor(Date.now() / 1000) - 20;
  const sid = `${Date.now()}-a1b2c3d4`;

  await sendStateEvent(
    DISPOSABLE_HOMESERVER,
    room.agent.accessToken,
    room.roomId,
    'io.mindroom.background_jobs',
    room.agent.userId,
    {
      jobs: [
        {
          job_id: 'job-wf-panel',
          thread_id: room.rootId,
          kind: 'workflow',
          tool: 'workflow',
          status: 'running',
          started_at: new Date(startedAt * 1000).toISOString(),
          workflow: RUN_ID,
        },
      ],
    }
  );

  await sendRoomMessage(DISPOSABLE_HOMESERVER, room.agent.accessToken, room.roomId, {
    msgtype: 'm.notice',
    body: 'Workflow: Audit the sample module',
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: room.rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: room.rootId },
    },
    'io.mindroom.workflow_run': {
      run: RUN_ID,
      job_id: 'job-wf-panel',
      requester: room.viewer.userId,
      title: 'Audit the sample module',
      status: 'running',
      counts: {
        queued: 0,
        running: 1,
        waiting: 0,
        completed: 1,
        failed: 0,
        indeterminate: 0,
        cached: 0,
      },
      usage: {
        input_tokens: 12000,
        output_tokens: 900,
        tool_calls: 4,
        cost_usd: '0.180000',
        attempt_cost_usd: '0.180000',
        projected_cost_usd: '0.300000',
        cost_unknown: false,
      },
      phases: ['Audit'],
      attempt: 1,
      started_at: startedAt,
      ended_at: null,
      error: null,
      large: false,
    },
  });

  const node4 = {
    id: 'n4',
    kind: 'agent',
    label: 'Audit auth/session.py',
    name: 'backend',
    phase: 0,
    group: 'n1',
    status: 'running',
    waiting_on: null,
    agent: 'panels',
    model: 'Sol · GPT-6.2',
    run: SUBAGENT_RUN,
    subagent: SUBAGENT_RUN,
    job: 'job-agent-4',
    session: null,
    turns: 1,
    started_at: startedAt,
    ended_at: null,
    cached: false,
    error: null,
  };
  const node5 = {
    id: 'n5',
    kind: 'agent',
    label: 'Audit ui/tokens.ts',
    name: 'frontend',
    phase: 0,
    group: 'n1',
    status: 'completed',
    waiting_on: null,
    agent: 'panels',
    model: 'Sol · GPT-6.2',
    session: null,
    turns: 1,
    started_at: startedAt,
    ended_at: startedAt + 8,
    cached: false,
    error: null,
  };

  const baseMeta = {
    agent: 'panels',
    thread_id: room.rootId,
    title: 'Audit the sample module',
    status: 'running',
    attempt: 1,
    started_at: startedAt,
    ended_at: null,
    max_concurrent: 16,
    max_cost_usd: null,
    large: false,
    counts: {
      queued: 0,
      running: 1,
      waiting: 0,
      completed: 1,
      failed: 0,
      indeterminate: 0,
      cached: 0,
    },
    usage: {
      input_tokens: 12000,
      output_tokens: 900,
      tool_calls: 4,
      cost_usd: 0.18,
      attempt_cost_usd: 0.18,
      projected_cost_usd: 0.3,
      cost_unknown: false,
    },
  };

  await putSubagentFrame(room, startedAt);
  await putWorkflowFrame(
    room,
    {
      v: 1,
      run: RUN_ID,
      sid,
      seq: 1,
      meta: baseMeta,
      snapshot: {
        phases: ['Audit'],
        groups: [
          { id: 'n1', kind: 'foreach', phase: 0, parent: null, total: 2, done: 1, failed: 0 },
        ],
        nodes: [node4, node5],
        edges: [{ from: 'n4', to: 'n5', kind: 'message', count: 2 }],
        log: ['Round 1: 1 done, 1 running'],
        omitted: emptyOmitted,
      },
    },
    '1'
  );

  return { startedAt, sid, node4, node5, baseMeta };
};

const workflowPanelFrame = (page: Page) => page.getByTestId('resizable-workflow-panel');

test.describe('workflow graph panel fixture screenshots', () => {
  test('renders panel wide, with selected chip and message edges, and at phone width', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/e2e/fixtures/workflow-run.html?surface=panel&lang=en');

    await expect(page.getByRole('heading', { name: 'Audit' })).toBeVisible();
    await expect(page.getByText('28 of 40')).toBeVisible();
    await expect(page.locator('svg path').first()).toBeVisible();

    await page.screenshot({
      path: testInfo.outputPath('workflow-panel-wide.png'),
      fullPage: true,
    });

    await page.getByRole('button', { name: /Audit auth\/session\.py/ }).click();
    await expect(page.getByText('Messages to frontend: 2')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open' })).toBeVisible();

    await page.screenshot({
      path: testInfo.outputPath('workflow-panel-selected-edges.png'),
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('heading', { name: 'Audit' })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('workflow-panel-phone.png'),
      fullPage: true,
    });
  });
});

test.describe('workflow graph panel integration', () => {
  test.use({ viewport: { width: 1600, height: 1000 }, video: 'off' });

  test.beforeEach(async () => {
    test.skip(!(await disposableHomeserverIsUp()), 'Disposable homeserver is not running');
  });

  test.afterEach(async ({ context }) => {
    await context.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('opens from card, updates chip on delta, opens Sub-agents, passes panel frame, and reopens finished card after reload', async ({
    context,
    page,
  }, testInfo) => {
    const room = await openPanelRoom(context, page);
    const { startedAt, sid, node4, node5, baseMeta } = await seedLiveWorkflow(room);

    const card = page.locator(`[data-workflow-run-card="${RUN_ID}"]`);
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.getByRole('button', { name: 'Graph' }).click();

    const panel = workflowPanelFrame(page);
    await expect(panel).toBeVisible({ timeout: 15_000 });
    const chip4 = panel.locator('[data-workflow-chip-id="n4"]');
    await expect(chip4).toHaveAttribute('data-workflow-node-status', 'running');

    // Delta turns n4 to completed without reloading the page.
    await putWorkflowFrame(
      room,
      {
        v: 1,
        run: RUN_ID,
        sid,
        seq: 2,
        meta: {
          ...baseMeta,
          counts: {
            queued: 0,
            running: 0,
            waiting: 0,
            completed: 2,
            failed: 0,
            indeterminate: 0,
            cached: 0,
          },
        },
        delta: {
          groups: [
            { id: 'n1', kind: 'foreach', phase: 0, parent: null, total: 2, done: 2, failed: 0 },
          ],
          nodes: [{ ...node4, status: 'completed', ended_at: startedAt + 15 }],
        },
      },
      '2'
    );
    await expect(chip4).toHaveAttribute('data-workflow-node-status', 'completed', {
      timeout: 15_000,
    });

    await checkPanelFrame(page, testInfo, room, { panel, label: 'Workflow' });

    // Clicking Open on the chip switches to the Sub-agents panel on that run.
    await chip4.click();
    await expect(panel.getByText('Messages to frontend: 2')).toBeVisible();
    await panel.getByRole('button', { name: 'Open' }).click();
    const subPanel = panelLocator(page, 'subagents');
    await expect(subPanel).toBeVisible({ timeout: 15_000 });
    await expect(subPanel.getByText('Checking session rotation paths.')).toBeVisible({
      timeout: 15_000,
    });

    // Post a finished run card carrying its final graph, reload (clearing ephemeral state),
    // and verify the finished card still opens its graph.
    const finishedRunId = 'wf-88888888888888888888888888888888';
    await sendRoomMessage(DISPOSABLE_HOMESERVER, room.agent.accessToken, room.roomId, {
      msgtype: 'm.notice',
      body: 'Workflow finished: Audit the sample module',
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: room.rootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: room.rootId },
      },
      'io.mindroom.workflow_run': {
        run: finishedRunId,
        job_id: 'job-wf-done',
        requester: room.viewer.userId,
        title: 'Audit the sample module',
        status: 'completed',
        counts: {
          queued: 0,
          running: 0,
          waiting: 0,
          completed: 2,
          failed: 0,
          indeterminate: 0,
          cached: 0,
        },
        usage: {
          input_tokens: 15000,
          output_tokens: 1100,
          tool_calls: 6,
          cost_usd: '0.210000',
          cost_unknown: false,
        },
        phases: ['Audit'],
        attempt: 1,
        started_at: startedAt,
        ended_at: startedAt + 30,
        error: null,
        large: false,
        graph: {
          phases: ['Audit'],
          groups: [
            { id: 'n1', kind: 'foreach', phase: 0, parent: null, total: 2, done: 2, failed: 0 },
          ],
          nodes: [{ ...node4, status: 'completed', ended_at: startedAt + 15 }, node5],
          edges: [{ from: 'n4', to: 'n5', kind: 'message', count: 2 }],
          log: ['Done.'],
          omitted: emptyOmitted,
        },
      },
    });

    await page.reload();
    const finishedCard = page.locator(`[data-workflow-run-card="${finishedRunId}"]`);
    await expect(finishedCard).toBeVisible({ timeout: 15_000 });
    await finishedCard.getByRole('button', { name: 'Graph' }).click();
    await expect(workflowPanelFrame(page)).toBeVisible({ timeout: 15_000 });
    await expect(workflowPanelFrame(page).getByText('Audit auth/session.py')).toBeVisible();
  });

  test('covers the conversation at phone width and Close returns', async ({ context, page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const room = await openPanelRoom(context, page);
    await seedLiveWorkflow(room);

    const card = page.locator(`[data-workflow-run-card="${RUN_ID}"]`);
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.getByRole('button', { name: 'Graph' }).click();

    const panel = workflowPanelFrame(page);
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(roomHeader(page)).toHaveCount(0);

    await panel.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(panel).toHaveCount(0);
    await expect(roomHeader(page)).toBeVisible();
  });
});
