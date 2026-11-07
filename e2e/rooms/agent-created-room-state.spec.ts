import { readFileSync, writeFileSync } from 'node:fs';
import { matrixFetch } from '../helpers/matrix';
import { roomMoreOptions } from '../helpers/roomMenu';
import {
  composer,
  expect,
  mentionHelper,
  sendFromComposer,
  test,
  uniqueWord,
  type AgentStack,
} from '../helpers/agentStack';

// A room made with the Create Room form, with the router and the helper agent invited from its
// Invite dialog, takes the room state MindRoom's agents publish as the rooms MindRoom creates do:
// each agent's server, the router's thread mode, the helper's thread tag and background job, and
// the router's auto-approve window all land, and the backend logs no refused write for the room.
// Runs against the agent stack (scripts/agent-stack/stack.py) with the stub model; skips without a
// MindRoom checkout.
test.describe.configure({ timeout: 420_000 });

type StateEvent = { type: string; state_key: string; sender: string };

/** The agent state this test expects in the room that has not landed, by name. */
const missingAgentState = async (stack: AgentStack, roomId: string): Promise<string[]> => {
  const state = await matrixFetch<StateEvent[]>(
    stack.homeserver,
    `/rooms/${encodeURIComponent(roomId)}/state`,
    { accessToken: stack.tester.accessToken }
  );
  const { router, helper } = stack.agents;
  const expected: Array<[string, string, string | undefined]> = [
    ['io.mindroom.server', router, router],
    ['io.mindroom.server', helper, helper],
    ['io.mindroom.thread_mode', router, ''],
    ['com.mindroom.thread.tags', helper, undefined],
    ['io.mindroom.background_jobs', helper, helper],
    ['io.mindroom.auto_approve', router, router],
  ];
  return expected
    .filter(
      ([type, sender, stateKey]) =>
        !state.some(
          (event) =>
            event.type === type &&
            event.sender === sender &&
            (stateKey === undefined || event.state_key === stateKey)
        )
    )
    .map(([type, sender]) => `${type} from ${sender}`);
};

/** The backend's log lines about the room. */
const roomLog = (stack: AgentStack, roomId: string): string[] =>
  readFileSync(stack.logs.backend, 'utf8')
    .split('\n')
    .filter((line) => line.includes(roomId));

const REFUSED_WRITE = /M_FORBIDDEN|refused|not permitted|Insufficient Matrix power level/;

test('agents publish their room state in a room made with Create Room', async ({ page, stack }) => {
  await page.goto('/home/create/', { timeout: 180_000 });
  await page.locator('input[name="nameInput"]').fill(`Planning ${uniqueWord('state')}`);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.waitForURL(/\/home\/!/, { timeout: 60_000 });
  const roomId = decodeURIComponent(new URL(page.url()).pathname.split('/')[2] ?? '');

  // The router first, then the helper, from the room's Invite dialog.
  await expect(roomMoreOptions(page)).toBeVisible({ timeout: 90_000 });
  await roomMoreOptions(page).click();
  await page.getByRole('menuitem', { name: 'Invite', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Invite' });
  const field = dialog.getByRole('combobox');
  const invite = async (userId: string) => {
    await field.fill(userId);
    // Enter submits the typed ID; a click on Invite can miss while directory suggestions open.
    await field.press('Enter');
    await expect(dialog.getByRole('status')).toContainText(userId, { timeout: 15_000 });
  };
  await invite(stack.agents.router);
  await invite(stack.agents.helper);
  await page.keyboard.press('Escape');
  await expect
    .poll(
      async () => {
        const { joined } = await matrixFetch<{ joined: Record<string, unknown> }>(
          stack.homeserver,
          `/rooms/${encodeURIComponent(roomId)}/joined_members`,
          { accessToken: stack.tester.accessToken }
        );
        return [stack.agents.router, stack.agents.helper].filter((userId) => !joined[userId]);
      },
      { timeout: 90_000, message: 'the agents join the room' }
    )
    .toEqual([]);

  // The helper tags its thread and starts a background job there; the tester opens an
  // auto-approve window in it, which the router publishes.
  await expect(composer(page)).toBeVisible({ timeout: 90_000 });
  await mentionHelper(page, stack, 'tag this thread #tag');
  await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 90_000 });
  await mentionHelper(page, stack, 'run the export #job');
  await sendFromComposer(page, '!auto_approve 30');

  try {
    await expect
      .poll(() => missingAgentState(stack, roomId), {
        timeout: 120_000,
        intervals: [1_000, 2_000],
        message: 'the agent state that has not landed',
      })
      .toEqual([]);
  } finally {
    writeFileSync(
      test.info().outputPath('backend-room-log.txt'),
      roomLog(stack, roomId).join('\n')
    );
  }
  expect(roomLog(stack, roomId).filter((line) => REFUSED_WRITE.test(line))).toEqual([]);
});
