import type { Browser, Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  createAgentRoom,
  expect,
  routeClientConfig,
  test,
  uniqueWord,
  type AgentStack,
} from '../helpers/agentStack';
import { registerDisposableUser } from '../helpers/disposableAccounts';
import { joinRoom, matrixFetch, sendStateEvent } from '../helpers/matrix';
import { roomMoreOptions } from '../helpers/roomMenu';

// A room upgrade keeps the room's sub-rooms: after the creator upgrades a chat room from its
// settings, the new room lists the sub-room and the sub-room names the new room as its parent
// instead of the old one, so it shows under the new room for the creator and for a member who
// follows the upgrade, its menu offers to remove it from the new room only, and the room's agents,
// invited to the new room too, stay in it. The restricted sub-room admits the new room's members
// as well as the old room's, so someone who joins only the new room may join it.
test.describe.configure({ timeout: 480_000 });

const PASSWORD = 'agent-sub-room-upgrade-spec-password';
const AGENT_WAIT = { timeout: 120_000, intervals: [1000, 2000] };

const roomPath = (roomId: string) => `/rooms/${encodeURIComponent(roomId)}`;

const joinedMembers = async (stack: AgentStack, roomId: string): Promise<string[]> => {
  const { joined } = await matrixFetch<{ joined: Record<string, unknown> }>(
    stack.homeserver,
    `${roomPath(roomId)}/joined_members`,
    { accessToken: stack.tester.accessToken }
  );
  return Object.keys(joined);
};

/** A state event's content, or null when the room has none. */
const stateContent = (stack: AgentStack, roomId: string, type: string, key: string) =>
  matrixFetch<Record<string, unknown>>(
    stack.homeserver,
    `${roomPath(roomId)}/state/${type}/${encodeURIComponent(key)}`,
    { accessToken: stack.tester.accessToken }
  ).catch(() => null);

const invite = (stack: AgentStack, roomId: string, userId: string) =>
  matrixFetch(stack.homeserver, `${roomPath(roomId)}/invite`, {
    method: 'POST',
    accessToken: stack.tester.accessToken,
    body: JSON.stringify({ user_id: userId }),
  });

/**
 * A sub-room of `parentId` as New Sub-room makes it: listed there, naming it back, and restricted
 * to its members.
 */
const createSubRoom = async (stack: AgentStack, parentId: string, name: string) => {
  const via = [stack.tester.userId.split(':').slice(1).join(':')];
  const { room_id: subId } = await matrixFetch<{ room_id: string }>(
    stack.homeserver,
    '/createRoom',
    {
      method: 'POST',
      accessToken: stack.tester.accessToken,
      body: JSON.stringify({
        name,
        preset: 'private_chat',
        initial_state: [
          {
            type: 'm.space.parent',
            state_key: parentId,
            content: { canonical: true, via },
          },
          {
            type: 'm.room.join_rules',
            state_key: '',
            content: {
              join_rule: 'restricted',
              allow: [{ type: 'm.room_membership', room_id: parentId }],
            },
          },
        ],
      }),
    }
  );
  await sendStateEvent(
    stack.homeserver,
    stack.tester.accessToken,
    parentId,
    'm.space.child',
    subId,
    { via }
  );
  return subId;
};

const goHome = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    window.history.pushState(null, '', '/home/');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
};

const subRoomUnder = (page: Page, parentId: string, subName: string) =>
  page.locator(`[data-sub-rooms-of="${parentId}"]`).getByRole('link', { name: subName });

// Set SUB_ROOM_SHOTS=<directory> to save what the creator and the member see at each step.
const SHOTS = process.env.SUB_ROOM_SHOTS;

const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/upgrade-${name}.png` });
};

const signInMember = async (browser: Browser, stack: AgentStack, username: string) => {
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();
  await routeClientConfig(page, stack);
  await loginWithPassword(page, { homeserver: stack.homeserver, username, password: PASSWORD });
  return page;
};

test('a room upgrade keeps its sub-room under the new room, with its agents', async ({
  page,
  browser,
  stack,
}) => {
  const word = uniqueWord('subupgrade');
  const parentName = `Orchard ${word}`;
  const subName = `Saplings ${word}`;
  const parentId = await createAgentRoom(stack, parentName, false);
  const subId = await createSubRoom(stack, parentId, subName);
  const member = await registerDisposableUser(`upgrade_member_${word}`.toLowerCase(), PASSWORD);
  await invite(stack, parentId, member.userId);
  await joinRoom(stack.homeserver, member.accessToken, parentId);
  await joinRoom(stack.homeserver, member.accessToken, subId);
  const agents = [stack.agents.helper, stack.agents.router];
  await expect
    .poll(() => joinedMembers(stack, subId), AGENT_WAIT)
    .toEqual(expect.arrayContaining(agents));

  const memberPage = await signInMember(browser, stack, member.username);
  await expect(subRoomUnder(memberPage, parentId, subName)).toBeVisible({ timeout: 60_000 });

  // The creator upgrades the room from its settings; the new room opens.
  await page.goto(`/home/${encodeURIComponent(parentId)}`);
  await expect(roomMoreOptions(page)).toBeVisible({ timeout: 120_000 });
  await expect(subRoomUnder(page, parentId, subName)).toBeVisible({ timeout: 60_000 });
  await shot(page, '1-creator-before');
  await roomMoreOptions(page).click();
  await page.getByRole('menuitem', { name: 'Room Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Upgrade', exact: true }).click();
  await page.getByRole('button', { name: 'Upgrade Room', exact: true }).click();
  await expect
    .poll(() => stateContent(stack, parentId, 'm.room.tombstone', ''), AGENT_WAIT)
    .toEqual(expect.objectContaining({ replacement_room: expect.any(String) }));
  const tombstone = await stateContent(stack, parentId, 'm.room.tombstone', '');
  const newId = tombstone?.replacement_room as string;
  await expect(page).toHaveURL(new RegExp(encodeURIComponent(newId)), { timeout: 60_000 });

  // The member and the agents follow the upgrade.
  for (const userId of [member.userId, ...agents]) {
    // eslint-disable-next-line no-await-in-loop
    await invite(stack, newId, userId);
  }
  await joinRoom(stack.homeserver, member.accessToken, newId);
  await expect
    .poll(() => joinedMembers(stack, newId), AGENT_WAIT)
    .toEqual(expect.arrayContaining(agents));

  // The new room lists the sub-room, and the sub-room names the new room as its parent.
  expect
    .soft(await stateContent(stack, newId, 'm.space.child', subId))
    .toEqual(expect.objectContaining({ via: expect.any(Array) }));
  expect
    .soft(await stateContent(stack, subId, 'm.space.parent', newId))
    .toEqual(expect.objectContaining({ canonical: true }));
  expect.soft(await stateContent(stack, subId, 'm.space.parent', parentId)).toEqual({});

  // Someone who joins only the new room may join the sub-room too.
  const newcomer = await registerDisposableUser(`upgrade_newcomer_${word}`.toLowerCase(), PASSWORD);
  await invite(stack, newId, newcomer.userId);
  await joinRoom(stack.homeserver, newcomer.accessToken, newId);
  expect.soft(await stateContent(stack, subId, 'm.room.join_rules', '')).toEqual({
    join_rule: 'restricted',
    allow: [
      { type: 'm.room_membership', room_id: parentId },
      { type: 'm.room_membership', room_id: newId },
    ],
  });
  await joinRoom(stack.homeserver, newcomer.accessToken, subId);
  expect(await joinedMembers(stack, subId)).toContain(newcomer.userId);

  // It shows under the new room for both, not at top level.
  await goHome(page);
  await goHome(memberPage);
  await expect.soft(subRoomUnder(page, newId, subName)).toBeVisible({ timeout: 60_000 });
  await expect.soft(subRoomUnder(memberPage, newId, subName)).toBeVisible({ timeout: 60_000 });
  for (const shown of [page, memberPage]) {
    // eslint-disable-next-line no-await-in-loop
    await expect
      .soft(shown.getByTestId('room-nav-category').getByRole('link', { name: subName }))
      .toHaveCount(1);
  }
  await shot(page, '2-creator-after');
  await shot(memberPage, '3-member-after');

  // The sub-room's menu offers to remove it from one room of that name, the new one.
  await page.goto(`/home/${encodeURIComponent(subId)}`);
  await expect(roomMoreOptions(page)).toBeVisible({ timeout: 60_000 });
  await roomMoreOptions(page).click();
  await expect
    .soft(page.getByRole('menuitem', { name: `Remove from ${parentName}`, exact: true }))
    .toHaveCount(1);
  await page.keyboard.press('Escape');

  // The agents, now in the new room, stay in the sub-room.
  await page.waitForTimeout(20_000);
  expect(await joinedMembers(stack, subId)).toEqual(expect.arrayContaining(agents));
});
