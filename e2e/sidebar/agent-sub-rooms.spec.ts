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
import { joinRoom, matrixFetch } from '../helpers/matrix';
import { roomMoreOptions } from '../helpers/roomMenu';

// Sub-rooms: New Sub-room in a room's menu makes a room only the room's members may join, listed
// under it. It shows under its room for everyone in the room, and a member who has not joined it
// joins it from there; the room's agents join it on their own (the backend's rooms under a room).
// Someone outside the room cannot join it. Remove from takes it off the room's list: it shows at
// top level again for both members, and the agents leave it.
test.describe.configure({ timeout: 480_000 });

const PASSWORD = 'agent-sub-rooms-spec-password';
const AGENT_WAIT = { timeout: 120_000, intervals: [1000, 2000] };

const joinedMembers = async (stack: AgentStack, roomId: string): Promise<string[]> => {
  const { joined } = await matrixFetch<{ joined: Record<string, unknown> }>(
    stack.homeserver,
    `/rooms/${encodeURIComponent(roomId)}/joined_members`,
    { accessToken: stack.tester.accessToken }
  );
  return Object.keys(joined);
};

/** The rooms `parentId` lists under it (`m.space.child` with servers). */
const listedRooms = async (stack: AgentStack, parentId: string): Promise<string[]> => {
  const state = await matrixFetch<
    { type: string; state_key: string; content: { via?: unknown } }[]
  >(stack.homeserver, `/rooms/${encodeURIComponent(parentId)}/state`, {
    accessToken: stack.tester.accessToken,
  });
  return state
    .filter((event) => event.type === 'm.space.child' && Array.isArray(event.content.via))
    .map((event) => event.state_key);
};

const goHome = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    window.history.pushState(null, '', '/home/');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
};

/** The Rooms section of Home. */
const homeRooms = (page: Page) => page.getByTestId('room-nav-category');

const expectUnderParent = async (page: Page, parentId: string, subName: string) => {
  await expect(
    page.locator(`[data-sub-rooms-of="${parentId}"]`).getByRole('link', { name: subName })
  ).toBeVisible({ timeout: 60_000 });
  // Once: not again at top level.
  await expect(homeRooms(page).getByRole('link', { name: subName })).toHaveCount(1);
};

const expectAtTopLevel = async (page: Page, subId: string) => {
  await expect(homeRooms(page).locator(`[data-room-id="${subId}"]`)).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.locator(`[data-sub-rooms-of] [data-room-id="${subId}"]`)).toHaveCount(0);
};

const signInMember = async (browser: Browser, stack: AgentStack, username: string) => {
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();
  await routeClientConfig(page, stack);
  await loginWithPassword(page, { homeserver: stack.homeserver, username, password: PASSWORD });
  return page;
};

test('a sub-room shows under its room, opens to its members and brings its agents', async ({
  page,
  browser,
  stack,
}) => {
  const word = uniqueWord('subrooms');
  const parentName = `Garden ${word}`;
  const subName = `Seeds ${word}`;
  const parentId = await createAgentRoom(stack, parentName, false);
  const member = await registerDisposableUser(`subroom_member_${word}`.toLowerCase(), PASSWORD);
  const outsider = await registerDisposableUser(`subroom_out_${word}`.toLowerCase(), PASSWORD);
  await matrixFetch(stack.homeserver, `/rooms/${encodeURIComponent(parentId)}/invite`, {
    method: 'POST',
    accessToken: stack.tester.accessToken,
    body: JSON.stringify({ user_id: member.userId }),
  });
  await joinRoom(stack.homeserver, member.accessToken, parentId);

  // The creator makes the sub-room from the room's menu.
  await page.goto(`/home/${encodeURIComponent(parentId)}`);
  await expect(roomMoreOptions(page)).toBeVisible({ timeout: 120_000 });
  await roomMoreOptions(page).click();
  await page.getByRole('menuitem', { name: 'New Sub-room', exact: true }).click();
  await page.getByRole('textbox', { name: 'Name' }).fill(subName);
  await page.getByRole('button', { name: 'Create', exact: true }).click();

  await expect.poll(() => listedRooms(stack, parentId), AGENT_WAIT).toHaveLength(1);
  const [subId] = await listedRooms(stack, parentId);
  await goHome(page);
  await expectUnderParent(page, parentId, subName);

  // The agents in the room join it on their own.
  await expect
    .poll(() => joinedMembers(stack, subId!), AGENT_WAIT)
    .toEqual(expect.arrayContaining([stack.agents.helper, stack.agents.router]));

  // A member of the room sees it under the room and joins it from there.
  const memberPage = await signInMember(browser, stack, member.username);
  const toJoin = memberPage.locator(`[data-sub-room-to-join="${subId}"]`);
  await expect(toJoin).toContainText(subName, { timeout: 60_000 });
  await toJoin.getByRole('link').click();
  await memberPage.getByRole('button', { name: 'Join', exact: true }).click();
  await goHome(memberPage);
  await expectUnderParent(memberPage, parentId, subName);
  await expect(toJoin).toHaveCount(0);

  // Someone outside the room cannot join it.
  await expect(joinRoom(stack.homeserver, outsider.accessToken, subId!)).rejects.toThrow(/403/);

  // Taking it off the room's list puts it at top level for both, and the agents leave.
  await page.goto(`/home/${encodeURIComponent(subId!)}`);
  await expect(roomMoreOptions(page)).toBeVisible({ timeout: 60_000 });
  await roomMoreOptions(page).click();
  await page.getByRole('menuitem', { name: `Remove from ${parentName}`, exact: true }).click();
  await goHome(page);
  await expectAtTopLevel(page, subId!);
  await expectAtTopLevel(memberPage, subId!);
  await expect
    .poll(() => joinedMembers(stack, subId!), AGENT_WAIT)
    .not.toEqual(expect.arrayContaining([stack.agents.helper]));
});
