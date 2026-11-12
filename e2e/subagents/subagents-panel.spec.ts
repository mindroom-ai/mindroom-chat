import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { disposableHomeserverIsUp, DISPOSABLE_HOMESERVER } from '../helpers/disposableAccounts';
import { joinRoom, matrixFetch, registerAgentAccount } from '../helpers/matrix';
import { openPanelRoom, panelLocator, type PanelRoom } from '../helpers/sidePanels';
import { roomHeader } from '../helpers/roomMenu';

// The Sub-agents panel follows MindRoom's live frames: an agent streams `io.mindroom.subagents`
// frames (ephemeral, plaintext, as in e2e/composer/send-follows-streaming-reply.spec.ts) for two
// runs, and the header's count, the panel's cards with what each run wrote, a run opened with its
// task and tool row, a finished run, and that run's sub-agent taking a second turn, which joins
// its card and its thread, follow them. The frames come in the shapes of
// src/app/messages/live/__fixtures__/subagent-frames-v1.json. A run counts as running only for 30
// seconds after its last frame, so the frames all go out within the first seconds of the test.
// The researcher is an agent of a namespaced MindRoom (`mindroom_researcher_<namespace>`), which
// its card names by its account.

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

/** Joins `mindroom_<name>_<namespace>` to the room under `displayname`. */
const joinNamespacedAgent = async (room: PanelRoom, name: string, displayname: string) => {
  const agent = await registerAgentAccount(DISPOSABLE_HOMESERVER, name);
  await matrixFetch(
    DISPOSABLE_HOMESERVER,
    `/profile/${encodeURIComponent(agent.userId)}/displayname`,
    { method: 'PUT', accessToken: agent.accessToken, body: JSON.stringify({ displayname }) }
  );
  await matrixFetch(DISPOSABLE_HOMESERVER, `/rooms/${encodeURIComponent(room.roomId)}/invite`, {
    method: 'POST',
    accessToken: room.viewer.accessToken,
    body: JSON.stringify({ user_id: agent.userId }),
  });
  await joinRoom(DISPOSABLE_HOMESERVER, agent.accessToken, room.roomId);
};

/**
 * One sub-agent run of the room's agent, sending its frames in order: a sub-agent's first turn, or
 * a later turn of the sub-agent `subagent` names.
 */
const startRun = (
  room: PanelRoom,
  { name, task, subagent }: { name: string; task: string; subagent?: string }
) => {
  const startedAt = Date.now() / 1000;
  const sid = `${Date.now()}-${randomUUID().replaceAll('-', '').slice(0, 8)}`;
  const run = `delegation-${name}-${sid}`;
  let seq = 0;
  const meta = (extra: Record<string, unknown> = {}) => ({
    agent: name,
    subagent: subagent ?? run,
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
    run,
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
  await joinNamespacedAgent(room, 'researcher', 'Research Desk');
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
  const cards = panel.locator('[data-subagent]');
  await expect(cards).toHaveCount(2);
  await expect(panel.getByText('2 active', { exact: true })).toBeVisible();
  const researcher = cards.filter({ hasText: 'Research Desk' });
  await expect(researcher).toHaveCount(1);

  await first.append('Looking it up.'.length, ' Checking the tags.');
  await expect(panel.getByText('Looking it up. Checking the tags.')).toBeVisible();
  await first.toolRow(
    'Looking it up. Checking the tags.'.length,
    '\n\n🔧 `run_shell_command` [1] ⏳\n\n'
  );
  // The card previews the tool call as a thread card does; the run, opened, shows its row.
  await expect(researcher).toContainText('1 tool');
  await researcher.click();
  await expect(panel.getByRole('heading', { name: 'Research Desk' })).toBeVisible();
  await expect(panel.getByText('Find when version 2 shipped.')).toBeVisible();
  await expect(panel.getByRole('button', { name: /Running 1 tool call/ })).toBeVisible();
  await panel.screenshot({ path: testInfo.outputPath('subagents-panel-open-run.png') });
  await panel.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(cards).toHaveCount(2);

  await second.finish(
    'Reading the notes.\n\nThe notes agree.',
    'The release notes agree with tag v2.0.'
  );
  const finished = cards.filter({ hasText: 'The notes agree.' });
  await expect(finished).toHaveCount(1);
  await expect(finished.getByText('Done', { exact: true })).toBeVisible();
  await expect(panel.getByText('1 active', { exact: true })).toBeVisible();
  await expect(
    roomHeader(page).getByRole('button', { name: 'Hide sub-agents, 1 active', exact: true })
  ).toBeVisible();

  // The finished sub-agent takes a second turn: a run of its own, on the same card and thread.
  const secondTurn = startRun(room, {
    name: 'reviewer',
    task: 'Now compare them with the changelog.',
    subagent: second.run,
  });
  await secondTurn.snapshot('Comparing with the changelog.');
  await expect(cards).toHaveCount(2);
  const continued = cards.filter({ hasText: 'Comparing with the changelog.' });
  await expect(continued).toContainText('2 turns');
  await expect(continued).toContainText('Running');
  await expect(panel.getByText('2 active', { exact: true })).toBeVisible();
  await continued.click();
  const turns = panel.locator('[data-subagent-task]');
  await expect(turns).toHaveText([
    'Check the release notes.',
    'Now compare them with the changelog.',
  ]);
  await expect(panel.getByText('The notes agree.')).toBeVisible();
  await panel.screenshot({ path: testInfo.outputPath('subagents-panel-two-turns.png') });
  await panel.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(cards).toHaveCount(2);

  await page.screenshot({ path: testInfo.outputPath('subagents-panel-desktop.png') });
  await panel.screenshot({ path: testInfo.outputPath('subagents-panel-desktop-panel.png') });
  await researcher.screenshot({ path: testInfo.outputPath('subagents-panel-namespaced-card.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(cards).toHaveCount(2);
  await page.screenshot({ path: testInfo.outputPath('subagents-panel-phone.png') });
});
