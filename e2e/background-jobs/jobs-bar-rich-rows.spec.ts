import { expect, test, type Locator } from '@playwright/test';
import { disposableHomeserverIsUp, DISPOSABLE_HOMESERVER } from '../helpers/disposableAccounts';
import { allowBackgroundJobsState, sendRoomMessage, sendStateEvent } from '../helpers/matrix';
import { openPanelRoom, panelLocator, type PanelRoom } from '../helpers/sidePanels';

// The jobs bar's rows join each job to what the client holds of it: a sub-agent job, by the
// `subagent` its jobs state names, to its run's `io.mindroom.subagents` frames (model, task, the
// tool it runs now, what it used), and a tool job, by its `tool_call_id`, to the tool trace of the
// agent's reply that called it. A run counts as running for 30 seconds after its last frame, so
// the frames go out again before each look.

test.use({ viewport: { width: 1400, height: 860 }, video: 'off' });
test.afterEach(async ({ context }) => {
  await context.unrouteAll({ behavior: 'ignoreErrors' });
});

const LEAD_TOOL = {
  type: 'tool_call_started',
  tool_name: 'run_shell_command',
  args_preview: 'uv run pytest tests/export/test_retry.py -x',
};
const CHILD_TOOL = {
  type: 'tool_call_started',
  tool_name: 'grep',
  args_preview: 'schedule_retry src/',
};

// Each run's frames: one publisher generation (`sid`, as MindRoom writes it) and its next `seq`.
const SID = `${Date.now()}-0a1b2c3d`;
const seqs = new Map<string, number>();

/** One run's snapshot frame, sent as the agent that delegated it sends it. */
const sendRun = async (
  room: PanelRoom,
  run: string,
  meta: Record<string, unknown>,
  tools: unknown[]
) => {
  const sid = SID;
  const seq = seqs.get(run) ?? 0;
  seqs.set(run, seq + 1);
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
        sid,
        seq,
        meta: {
          agent: 'panels',
          caller: 'panels',
          root: 'panels',
          parent: null,
          thread_id: room.rootId,
          source: 'delegate',
          status: 'running',
          started_at: Date.now() / 1000 - 30,
          ended_at: null,
          ...meta,
        },
        snapshot: { md: 'Working on it.', reasoning: '', tools, status: 'streaming', activity: '' },
      }),
    }
  );
  if (!response.ok) throw new Error(`Sub-agent frame refused: ${response.status}`);
};

const sendRuns = async (room: PanelRoom) => {
  await sendRun(
    room,
    'run-lead',
    {
      subagent: 'sub-lead',
      task: 'Rework the export queue retry policy\nwith capped backoff',
      model: {
        config: 'fable',
        display_name: 'Fable 5.2',
        provider: 'anthropic',
        id: 'claude-fable-5.2',
      },
      usage: { input_tokens: 1_850_000, output_tokens: 50_000, tool_calls: 31, cost_usd: 1.3 },
    },
    [LEAD_TOOL]
  );
  await sendRun(
    room,
    'run-child',
    {
      subagent: 'sub-child',
      parent: 'run-lead',
      task: 'List every caller of schedule_retry',
      model: {
        config: 'sol',
        display_name: 'Sol · GPT-6.2',
        provider: 'openai',
        id: 'gpt-6.2-sol',
      },
      usage: { input_tokens: 310_000, output_tokens: 4_000, tool_calls: 7 },
    },
    [CHILD_TOOL]
  );
};

const row = (bar: Locator, kind: 'subagent' | 'tool', depth = 0) =>
  bar.locator(`li[data-job-kind="${kind}"][data-job-depth="${depth}"]`);

async function allowBackgroundJobs(room: Awaited<ReturnType<typeof openPanelRoom>>) {
  await allowBackgroundJobsState(DISPOSABLE_HOMESERVER, room.viewer.accessToken, room.roomId);
}

test('the jobs bar shows each job with its model, task, what it does now, time and usage', async ({
  context,
  page,
}, testInfo) => {
  test.skip(!(await disposableHomeserverIsUp()), 'Needs the disposable homeserver.');
  test.setTimeout(3 * 60_000);
  // The rows' model and usage show only with the usage details, which this reader turned on.
  const room = await openPanelRoom(context, page, { showUsageDetails: true });
  // MindRoom lets its agents publish their jobs; this room's creator does the same.
  await allowBackgroundJobs(room);
  // The agent's reply that started the shell job, whose trace names the call.
  await sendRoomMessage(DISPOSABLE_HOMESERVER, room.agent.accessToken, room.roomId, {
    msgtype: 'm.text',
    body: 'Started the suite on build-box.',
    'm.relates_to': { rel_type: 'm.thread', event_id: room.rootId },
    'io.mindroom.tool_trace': {
      version: 2,
      events: [
        {
          type: 'tool_call_completed',
          tool_name: 'run_shell_command',
          args_preview: "ssh build-box 'cd /srv/checkout/slot-14 && uv run pytest -n 20'",
          tool_call_id: 'call_shell',
        },
      ],
    },
  });
  await expect(page.getByText('Started the suite on build-box.', { exact: true })).toBeVisible();
  await sendRuns(room);
  const startedAt = (secondsAgo: number) => new Date(Date.now() - secondsAgo * 1000).toISOString();
  const job = (jobId: string, extra: Record<string, unknown>) => ({
    job_id: jobId,
    thread_id: room.rootId,
    status: 'running',
    requester_id: room.viewer.userId,
    ...extra,
  });
  await sendStateEvent(
    DISPOSABLE_HOMESERVER,
    room.agent.accessToken,
    room.roomId,
    'io.mindroom.background_jobs',
    room.agent.userId,
    {
      jobs: [
        job('job_1', {
          kind: 'subagent',
          tool: 'panels',
          subagent: 'sub-lead',
          run: 'run-lead',
          started_at: startedAt(8),
        }),
        job('job_2', {
          kind: 'tool',
          tool: 'run_shell_command',
          tool_call_id: 'call_shell',
          started_at: startedAt(6),
        }),
        job('job_3', {
          kind: 'subagent',
          tool: 'panels',
          subagent: 'sub-child',
          run: 'run-child',
          status: 'awaiting_approval',
          started_at: startedAt(4),
        }),
      ],
    }
  );

  const bar = page.getByRole('region', { name: '3 background jobs' });
  const title = bar.getByRole('button', { name: /^3 background jobs/ });
  await expect(title).toContainText('2 sub-agents · 1 tool');
  await expect(title.locator('[data-job-logo]')).toHaveCount(2);
  await bar.screenshot({ path: testInfo.outputPath('jobs-bar-c-collapsed.png') });
  await title.click();
  await expect(bar.getByRole('heading')).toHaveText(['Sub-agents · 2', 'Tools · 1']);

  // The lead, then the sub-agent it started, one step in, then the tool job.
  const lead = row(bar, 'subagent');
  await expect(lead.locator('[data-job-logo]')).toHaveAttribute('data-model-provider', 'anthropic');
  await expect(lead.locator('[data-job-model]')).toHaveText('Fable 5.2');
  await expect(lead).toContainText('Rework the export queue retry policy');
  await expect(lead).not.toContainText('with capped backoff');
  // A sub-agent's row names the call its run makes now, then its arguments.
  await expect(lead.locator('[data-job-activity]')).toHaveText(
    `${LEAD_TOOL.tool_name} ${LEAD_TOOL.args_preview}`
  );
  // The group heading names the number columns, so the cells hold bare numbers.
  await expect(bar.getByText('Calls', { exact: true })).toBeVisible();
  await expect(lead.locator('[data-job-stat]')).toHaveText(['31', '1.9M', '$1.30']);
  await expect(lead.locator('[data-job-stat="calls"]')).toHaveAttribute('title', '31 calls');
  const child = row(bar, 'subagent', 1);
  await expect(child.locator('[data-job-logo]')).toHaveAttribute('data-model-provider', 'openai');
  await expect(child.locator('[data-job-model]')).toHaveText('Sol · GPT-6.2');
  // An unpriced run shows its tokens without a cost.
  await expect(child.locator('[data-job-stat]')).toHaveText(['7', '314K', '']);
  // A job waiting for approval says so in its one pill, and the title counts it.
  await expect(child).toContainText('Waiting for approval');
  await expect(title).toContainText('1 needs approval');
  const shell = row(bar, 'tool');
  await expect(shell.locator('[data-job-logo]')).toHaveAttribute('data-job-logo', 'tool');
  // A tool job's second line is its call's arguments; its first line names the tool.
  await expect(shell.locator('[data-job-activity]')).toHaveText(
    "ssh build-box 'cd /srv/checkout/slot-14 && uv run pytest -n 20'"
  );
  await expect(shell.locator('[data-job-open]')).toHaveCount(0);
  // The rows' order in the list: sub-agents (each child under its parent), then tools.
  await expect(bar.locator('li')).toHaveCount(3);
  await expect(bar.locator('li').nth(1)).toHaveAttribute('data-job-depth', '1');

  // Each row's time ticks, hidden from screen readers.
  const elapsed = lead.locator('[data-job-elapsed]');
  await expect(elapsed).toHaveAttribute('aria-hidden', 'true');
  const before = await elapsed.textContent();
  await page.waitForTimeout(1_500);
  await expect(elapsed).not.toHaveText(before ?? '');
  // It reads minutes and seconds, so it visibly ticks past the first minute.
  await expect(elapsed).toHaveText(/^\d+s$|^\d+m \d+s$/);
  await bar.screenshot({ path: testInfo.outputPath('jobs-bar-c-light.png') });
  await page.emulateMedia({ colorScheme: 'dark' });
  await bar.screenshot({ path: testInfo.outputPath('jobs-bar-c-dark.png') });
  await page.emulateMedia({ colorScheme: 'light' });

  // Open shows that sub-agent's run in the Sub-agents panel.
  await sendRuns(room);
  // The row's title is its way there, from anywhere on the row but its buttons: here a press on
  // its pill.
  await expect(child.locator('[data-job-open]')).toHaveText('List every caller of schedule_retry');
  await child.getByText('Waiting for approval', { exact: true }).click({ force: true });
  const panel = panelLocator(page, 'subagents');
  await expect(panel.locator('[data-subagent-view="sub-child"]')).toBeVisible();
  // Beside the panel the bar is narrower: the columns stay.
  await bar.getByRole('button', { name: /^3 background jobs/ }).click();
  await expect(lead.locator('[data-job-stat="calls"]')).toBeVisible();
  await bar.screenshot({ path: testInfo.outputPath('jobs-bar-c-panel.png') });

  // In the room's own timeline each row also has its thread's button; a press between it and the
  // row's Stop goes through to the row, and shows that row's run.
  await page.keyboard.press('Escape');
  await page.goto(`/home/${encodeURIComponent(room.roomId)}`);
  const roomBar = page.getByRole('region', { name: '3 background jobs' });
  await expect(roomBar).toBeVisible();
  await sendRuns(room);
  await roomBar.getByRole('button', { name: /^3 background jobs/ }).click();
  const roomLead = row(roomBar, 'subagent');
  const thread = await roomLead.locator('[data-job-thread]').boundingBox();
  const stopBox = await roomLead.locator('[data-cancel-job]').boundingBox();
  if (!thread || !stopBox) throw new Error('The row has no thread button or Stop.');
  await page.mouse.click((thread.x + thread.width + stopBox.x) / 2, thread.y + thread.height / 2);
  await expect(
    panelLocator(page, 'subagents').locator('[data-subagent-view="sub-lead"]')
  ).toBeVisible();

  // On a phone the rows drop the model and the usage; the logos stay.
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(
    `/home/${encodeURIComponent(room.roomId)}?threadId=${encodeURIComponent(room.rootId)}`
  );
  const phoneBar = page.getByRole('region', { name: '3 background jobs' });
  // The reload left the runs the page held behind: their next snapshots come once it shows.
  await expect(phoneBar).toBeVisible();
  await sendRuns(room);
  await phoneBar.getByRole('button', { name: /^3 background jobs/ }).click();
  const phoneLead = row(phoneBar, 'subagent');
  await expect(phoneLead.locator('[data-job-logo]')).toBeVisible();
  await expect(phoneLead.locator('[data-job-model]')).toBeHidden();
  await expect(phoneLead.locator('[data-job-stat]')).toHaveCount(3);
  for (const cell of await phoneLead.locator('[data-job-stat]').all())
    await expect(cell).toBeHidden();
  await expect(phoneLead.locator('[data-job-elapsed]')).toBeVisible();
  await expect(phoneLead.locator('[data-job-open]')).toBeVisible();
  await phoneBar.screenshot({ path: testInfo.outputPath('jobs-bar-c-phone.png') });
});

test('a folded quiet bar cuts its title short before the time, with Open, Thread and Stop', async ({
  context,
  page,
}, testInfo) => {
  test.skip(!(await disposableHomeserverIsUp()), 'Needs the disposable homeserver.');
  test.setTimeout(3 * 60_000);
  // The app's default: no usage details, so the folded row has its title and no line of what it does.
  const room = await openPanelRoom(context, page);
  await allowBackgroundJobs(room);
  await sendStateEvent(
    DISPOSABLE_HOMESERVER,
    room.agent.accessToken,
    room.roomId,
    'io.mindroom.background_jobs',
    room.agent.userId,
    {
      jobs: [
        {
          job_id: 'job_notes',
          thread_id: room.rootId,
          status: 'running',
          requester_id: room.viewer.userId,
          kind: 'subagent',
          tool: 'panels',
          subagent: 'sub-notes',
          run: 'run-notes',
          started_at: new Date(Date.now() - 754_000).toISOString(),
        },
      ],
    }
  );
  // In the room's own timeline the job, of a thread, has the thread's button besides Open and Stop.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/home/${encodeURIComponent(room.roomId)}`);
  const folded = page.locator('[data-job-folded]');
  await expect(folded).toBeVisible({ timeout: 30_000 });
  const title = "Summarize this week's meeting notes and draft the follow-up email";
  await sendRun(
    room,
    'run-notes',
    {
      subagent: 'sub-notes',
      task: title,
    },
    [
      {
        type: 'tool_call_started',
        tool_name: 'read_file',
        args_preview: 'path=notes/2026-11-16-weekly-planning-meeting.md',
      },
    ]
  );
  await expect(folded.locator('button[aria-expanded]')).toHaveText(title);
  await expect(folded.locator('[data-job-activity]')).toHaveCount(0);
  await expect(folded.locator('[data-job-open]')).toBeVisible();
  await expect(folded.locator('[data-job-thread]')).toBeVisible();
  await expect(folded.locator('[data-cancel-job]')).toBeVisible();
  await expect(folded.locator('[data-job-elapsed]')).toBeVisible();
  // Each part of the text column (the headline and the chevron) ends before the time begins, on a
  // phone, beside the Sub-agents panel's width and on a desktop; on the phone the title is cut short.
  for (const width of [390, 800, 1100]) {
    await page.setViewportSize({ width, height: 844 });
    const layout = await folded.evaluate((row) => {
      const task = row.querySelector('button[aria-expanded]')!;
      const text = task.parentElement!.parentElement!;
      const time = row.querySelector('[data-job-elapsed]')!.getBoundingClientRect();
      return {
        timeStart: time.left,
        ends: [...text.children].map((part) => part.getBoundingClientRect().right),
        textEnd: text.getBoundingClientRect().right,
        titleCut: task.scrollWidth > task.clientWidth,
      };
    });
    testInfo.annotations.push({ type: `layout ${width}`, description: JSON.stringify(layout) });
    for (const end of [...layout.ends, layout.textEnd])
      expect(end, `${width} px`).toBeLessThanOrEqual(layout.timeStart + 0.5);
    if (width === 390) expect(layout.titleCut).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await folded.screenshot({ path: testInfo.outputPath('jobs-bar-quiet-phone-folded.png') });
});

test('shows a workflow job as its own row whose counts follow a workflow delta', async ({
  context,
  page,
}) => {
  test.skip(!(await disposableHomeserverIsUp()), 'Disposable homeserver is not running');
  test.setTimeout(3 * 60_000);
  const room = await openPanelRoom(context, page, { showUsageDetails: true });
  await allowBackgroundJobs(room);
  const runId = 'wf-11111111111111111111111111111111';
  const startedAt = Math.floor(Date.now() / 1000) - 20;

  await sendStateEvent(
    DISPOSABLE_HOMESERVER,
    room.agent.accessToken,
    room.roomId,
    'io.mindroom.background_jobs',
    room.agent.userId,
    {
      jobs: [
        {
          job_id: 'job-wf-rich-1',
          thread_id: room.rootId,
          kind: 'workflow',
          tool: 'workflow',
          status: 'running',
          started_at: new Date(startedAt * 1000).toISOString(),
          workflow: runId,
        },
      ],
    }
  );

  const sendWorkflowFrame = async (seq: number, body: Record<string, unknown>) => {
    const response = await fetch(
      `${DISPOSABLE_HOMESERVER}/_matrix/client/unstable/org.matrix.msc2477/rooms/${encodeURIComponent(
        room.roomId
      )}/ephemeral/io.mindroom.workflow/workflow.${runId}.${seq}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${room.agent.accessToken}`,
        },
        body: JSON.stringify(body),
      }
    );
    if (!response.ok) throw new Error(`Workflow frame refused: ${response.status}`);
  };

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
      queued: 1,
      running: 2,
      waiting: 0,
      completed: 1,
      failed: 0,
      indeterminate: 0,
      cached: 0,
    },
    usage: {
      input_tokens: 12000,
      output_tokens: 1500,
      tool_calls: 4,
      cost_usd: 0.08,
      attempt_cost_usd: 0.08,
      projected_cost_usd: 0.16,
      cost_unknown: false,
    },
  };

  await sendWorkflowFrame(1, {
    v: 1,
    run: runId,
    sid: SID,
    seq: 1,
    meta: baseMeta,
    snapshot: {
      phases: ['Audit'],
      groups: [],
      nodes: [],
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
  });

  const row = page.locator('[data-job-kind="workflow"]');
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row).toContainText('Audit the sample module');
  await expect(row).toContainText('1 done, 2 running, 0 waiting');

  await sendWorkflowFrame(2, {
    v: 1,
    run: runId,
    sid: SID,
    seq: 2,
    meta: {
      ...baseMeta,
      counts: {
        queued: 0,
        running: 1,
        waiting: 0,
        completed: 3,
        failed: 0,
        indeterminate: 0,
        cached: 0,
      },
    },
    delta: {},
  });

  await expect(row).toContainText('3 done, 1 running, 0 waiting', { timeout: 15_000 });
});
