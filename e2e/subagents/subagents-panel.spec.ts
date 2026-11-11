import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { disposableHomeserverIsUp, DISPOSABLE_HOMESERVER } from '../helpers/disposableAccounts';
import { openPanelRoom, panelLocator, type PanelRoom } from '../helpers/sidePanels';
import { roomHeader } from '../helpers/roomMenu';

// The Sub-agents panel follows MindRoom's live frames: an agent streams `io.mindroom.subagents`
// frames (ephemeral, plaintext, as in e2e/composer/send-follows-streaming-reply.spec.ts) for two
// runs, and the header's count, the panel's cards, a run's text and tool row, and a finished run's
// result follow them. The frames come in the shapes of
// src/app/messages/live/__fixtures__/subagent-frames-v1.json. A run counts as running only for 30
// seconds after its last frame, so the frames all go out within the first seconds of the test.

test.use({ viewport: { width: 1600, height: 1000 }, video: 'off' });
test.afterEach(async ({ context }) => {
  await context.unrouteAll({ behavior: 'ignoreErrors' });
});

type Doc = { md: string; reasoning: string; tools: unknown[]; status: string; activity: string };

const TOOL = {
  type: 'tool_call_started',
  tool_name: 'run_shell_command',
  args_preview: 'command=git tag',
};
const DONE_TOOL = { ...TOOL, type: 'tool_call_completed', result_preview: 'v1.0\nv2.0' };

/** One sub-agent run of the room's agent, sending its frames in order. */
const startRun = (room: PanelRoom, { name, task }: { name: string; task: string }) => {
  const startedAt = Date.now() / 1000;
  const sid = `${Date.now()}-${randomUUID().replaceAll('-', '').slice(0, 8)}`;
  const run = `delegation-${name}-${sid}`;
  let seq = 0;
  const meta = (extra: Record<string, unknown> = {}) => ({
    agent: name,
    caller: 'panels',
    root: 'panels',
    parent: null,
    thread_id: room.rootId,
    source: 'delegate',
    status: 'running',
    started_at: startedAt,
    ended_at: null,
    ...extra,
  });
  const send = async (frame: Record<string, unknown>) => {
    const frameSeq = seq;
    seq += 1;
    const response = await fetch(
      `${DISPOSABLE_HOMESERVER}/_matrix/client/unstable/org.matrix.msc2477/rooms/${encodeURIComponent(
        room.roomId
      )}/ephemeral/io.mindroom.subagents/subagents.${sid}.${frameSeq}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${room.agent.accessToken}`,
        },
        body: JSON.stringify({ v: 1, run, sid, seq: frameSeq, ...frame }),
      }
    );
    if (!response.ok) throw new Error(`Sub-agent frame refused: ${response.status}`);
  };
  const doc = (md: string, tools: unknown[], status: string): Doc => ({
    md,
    reasoning: '',
    tools,
    status,
    activity: '',
  });
  return {
    snapshot: (md: string) => send({ meta: meta({ task }), snapshot: doc(md, [], 'streaming') }),
    append: (at: number, ins: string) =>
      send({ meta: meta(), delta: { md: { at, del: 0, ins, len: at + ins.length } } }),
    toolRow: (at: number, ins: string) =>
      send({
        meta: meta(),
        delta: {
          md: { at, del: 0, ins, len: at + ins.length },
          tools: { len: 1, set: [[0, TOOL]] },
        },
      }),
    finish: (md: string, result: string) =>
      send({
        meta: meta({ status: 'completed', ended_at: Date.now() / 1000, task, result }),
        snapshot: doc(md, [DONE_TOOL], 'pending'),
      }),
  };
};

test('the Sub-agents panel follows two runs frame by frame', async ({
  context,
  page,
}, testInfo) => {
  test.skip(!(await disposableHomeserverIsUp()), 'Needs the disposable homeserver.');
  test.setTimeout(3 * 60_000);
  const room = await openPanelRoom(context, page);
  const first = startRun(room, { name: 'researcher', task: 'Find when version 2 shipped.' });
  const second = startRun(room, { name: 'reviewer', task: 'Check the release notes.' });
  const toggle = roomHeader(page).getByRole('button', { name: /^Show sub-agents/ });
  await expect(toggle).toHaveCount(0);

  await first.snapshot('Looking it up.');
  await second.snapshot('Reading the notes.');
  await expect(
    roomHeader(page).getByRole('button', { name: 'Show sub-agents, 2 active', exact: true })
  ).toBeVisible({
    timeout: 30_000,
  });
  await roomHeader(page)
    .getByRole('button', { name: 'Show sub-agents, 2 active', exact: true })
    .click();
  const panel = panelLocator(page, 'subagents');
  await expect(panel).toBeVisible();
  const cards = panel.locator('[data-subagent-run]');
  await expect(cards).toHaveCount(2);
  await expect(panel.getByText('2 active', { exact: true })).toBeVisible();

  await first.append('Looking it up.'.length, ' Checking the tags.');
  await expect(panel.getByText('Looking it up. Checking the tags.')).toBeVisible();
  await first.toolRow(
    'Looking it up. Checking the tags.'.length,
    '\n\n🔧 `run_shell_command` [1] ⏳\n\n'
  );
  await expect(panel.getByText('run_shell_command').first()).toBeVisible();

  await second.finish(
    'Reading the notes.\n\nThe notes agree.',
    'The release notes agree with tag v2.0.'
  );
  const finished = cards.filter({ hasText: 'The release notes agree with tag v2.0.' });
  await expect(finished).toHaveCount(1);
  await expect(finished.getByText('Done', { exact: true })).toBeVisible();
  await expect(panel.getByText('1 active', { exact: true })).toBeVisible();
  await expect(
    roomHeader(page).getByRole('button', { name: 'Hide sub-agents, 1 active', exact: true })
  ).toBeVisible();

  await page.screenshot({ path: testInfo.outputPath('subagents-panel-desktop.png') });
  await panel.screenshot({ path: testInfo.outputPath('subagents-panel-desktop-panel.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(cards).toHaveCount(2);
  await page.screenshot({ path: testInfo.outputPath('subagents-panel-phone.png') });
});
