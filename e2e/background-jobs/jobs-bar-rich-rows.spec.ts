import { expect, test, type Locator } from '@playwright/test';
import { disposableHomeserverIsUp, DISPOSABLE_HOMESERVER } from '../helpers/disposableAccounts';
import { matrixFetch, sendRoomMessage, sendStateEvent } from '../helpers/matrix';
import { openPanelRoom, panelLocator, type PanelRoom } from '../helpers/sidePanels';

// The jobs bar's rows join each job to what the client holds of it: a sub-agent job, by the
// `subagent` its jobs state names, to its run's `io.mindroom.subagents` frames (model, task, the
// tool it runs now, what it used), and a tool job, by its `tool_call_id`, to the tool trace of the
// agent's reply that called it. A run counts as running for 30 seconds after its last frame, so
// the frames go out again before each look.

test.use({ viewport: { width: 1280, height: 860 }, video: 'off' });
test.afterEach(async ({ context }) => {
  await context.unrouteAll({ behavior: 'ignoreErrors' });
});

const LEAD_TOOL = {
  type: 'tool_call_started',
  tool_name: 'run_shell_command',
  args_preview: 'uv run pytest tests/test_held_projection.py -x',
};
const CHILD_TOOL = {
  type: 'tool_call_started',
  tool_name: 'grep',
  args_preview: 'request_tokens src/',
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
      task: 'Redesign the held system prompt\nas one request projection',
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
      task: 'Find every caller of request_tokens',
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

test('the jobs bar shows each job with its model, task, what it does now, time and usage', async ({
  context,
  page,
}, testInfo) => {
  test.skip(!(await disposableHomeserverIsUp()), 'Needs the disposable homeserver.');
  test.setTimeout(3 * 60_000);
  const room = await openPanelRoom(context, page);
  // MindRoom lets its agents publish their jobs; this room's creator does the same.
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
  // The agent's reply that started the shell job, whose trace names the call.
  await sendRoomMessage(DISPOSABLE_HOMESERVER, room.agent.accessToken, room.roomId, {
    msgtype: 'm.text',
    body: 'Started the suite on gce-dev.',
    'm.relates_to': { rel_type: 'm.thread', event_id: room.rootId },
    'io.mindroom.tool_trace': {
      version: 2,
      events: [
        {
          type: 'tool_call_completed',
          tool_name: 'run_shell_command',
          args_preview: "ssh gce-dev 'cd /work/slot71 && uv run pytest -n 20'",
          tool_call_id: 'call_shell',
        },
      ],
    },
  });
  await expect(page.getByText('Started the suite on gce-dev.', { exact: true })).toBeVisible();
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
          started_at: startedAt(4),
        }),
      ],
    }
  );

  const bar = page.getByRole('region', { name: '3 background jobs' });
  const title = bar.getByRole('button', { name: /^3 background jobs/ });
  await expect(title).toContainText('2 sub-agents · 1 tool');
  await expect(title.locator('[data-job-logo]')).toHaveCount(2);
  await title.click();
  await expect(bar.getByRole('heading')).toHaveText(['Sub-agents · 2', 'Tools · 1']);

  // The lead, then the sub-agent it started, one step in, then the tool job.
  const lead = row(bar, 'subagent');
  await expect(lead.locator('[data-job-logo]')).toHaveAttribute('data-model-provider', 'anthropic');
  await expect(lead.locator('[data-job-model]')).toHaveText('Fable 5.2');
  await expect(lead).toContainText('Redesign the held system prompt');
  await expect(lead).not.toContainText('as one request projection');
  await expect(lead.locator('[data-job-activity]')).toHaveText(
    `run_shell_command ${LEAD_TOOL.args_preview}`
  );
  await expect(lead.locator('[data-job-stats]')).toHaveText('31 tool calls · 1.9M tokens · $1.30');
  const child = row(bar, 'subagent', 1);
  await expect(child.locator('[data-job-logo]')).toHaveAttribute('data-model-provider', 'openai');
  await expect(child.locator('[data-job-model]')).toHaveText('Sol · GPT-6.2');
  // An unpriced run shows its tokens without a cost.
  await expect(child.locator('[data-job-stats]')).toHaveText('7 tool calls · 314K tokens');
  const shell = row(bar, 'tool');
  await expect(shell.locator('[data-job-logo]')).toHaveAttribute('data-job-logo', 'tool');
  // A tool job's second line is its call's arguments; its first line names the tool.
  await expect(shell.locator('[data-job-activity]')).toHaveText(
    "ssh gce-dev 'cd /work/slot71 && uv run pytest -n 20'"
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
  await bar.screenshot({ path: testInfo.outputPath('jobs-bar-rich-desktop.png') });
  await page.emulateMedia({ colorScheme: 'dark' });
  await bar.screenshot({ path: testInfo.outputPath('jobs-bar-rich-desktop-dark.png') });
  await page.emulateMedia({ colorScheme: 'light' });

  // Open shows that sub-agent's run in the Sub-agents panel.
  await sendRuns(room);
  await child.locator('[data-job-open]').click();
  const panel = panelLocator(page, 'subagents');
  await expect(panel.locator('[data-subagent-view="sub-child"]')).toBeVisible();

  // On a phone the rows drop the model and the usage; the logos stay.
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await sendRuns(room);
  await page.goto(
    `/home/${encodeURIComponent(room.roomId)}?threadId=${encodeURIComponent(room.rootId)}`
  );
  const phoneBar = page.getByRole('region', { name: '3 background jobs' });
  await phoneBar.getByRole('button', { name: /^3 background jobs/ }).click();
  const phoneLead = row(phoneBar, 'subagent');
  await expect(phoneLead.locator('[data-job-activity]')).toBeVisible();
  await expect(phoneLead.locator('[data-job-logo]')).toBeVisible();
  await expect(phoneLead.locator('[data-job-model]')).toBeHidden();
  await expect(phoneLead.locator('[data-job-stats]')).toBeHidden();
  await phoneBar.screenshot({ path: testInfo.outputPath('jobs-bar-rich-phone.png') });
});
