import { expect, test } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  type DisposableUser,
} from '../helpers/disposableAccounts';
import {
  createDefaultThreadFilterState,
  joinRoom,
  matrixFetch,
  seedRoomOverviewState,
  sendRoomMessage,
  sendStateEvent,
} from '../helpers/matrix';

// A thread tag names who set it, and a thread shows that person as its resolver only when the tag
// came from that person or from a MindRoom agent on the viewer's homeserver, which resolves threads
// for the people it works for. A member's tag that names someone else shows the member.
const PASSWORD = 'thread-resolver-sender-spec-password';
const RUN = Date.now().toString(36);
const OWNER_NAME = 'Dana Whitfield';
const MEMBER_NAME = 'Sam Ortiz';

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const register = async (username: string, displayname: string): Promise<DisposableUser> => {
  const user = await registerDisposableUser(username, PASSWORD);
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(user.userId)}/displayname`, {
    method: 'PUT',
    accessToken: user.accessToken,
    body: JSON.stringify({ displayname }),
  });
  return user;
};

const startThread = async (roomId: string, author: DisposableUser, body: string) => {
  const rootId = await sendRoomMessage(HOMESERVER, author.accessToken, roomId, {
    msgtype: 'm.text',
    body,
  });
  await sendRoomMessage(HOMESERVER, author.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Done, closing this one.',
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: rootId },
    },
  });
  return rootId;
};

const resolve = (roomId: string, rootId: string, sender: DisposableUser, setBy: string) =>
  sendStateEvent(
    HOMESERVER,
    sender.accessToken,
    roomId,
    'com.mindroom.thread.tags',
    JSON.stringify([rootId, 'resolved']),
    { set_by: setBy, set_at: new Date().toISOString() }
  );

test('a resolved thread names the member who resolved it, or the person an agent resolved it for', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const owner = await register(`trs_owner_${RUN}`, OWNER_NAME);
  const member = await register(`trs_member_${RUN}`, MEMBER_NAME);
  const agent = await register(`mindroom_helper_${RUN}`, 'Helper');
  const roomId = await createRoom(HOMESERVER, owner.accessToken, {
    name: `Release checklist ${RUN}`,
    invite: [member.userId, agent.userId],
  });
  await joinRoom(HOMESERVER, member.accessToken, roomId);
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  // Every member may tag threads, as in a room the app creates.
  const levelsPath = `/rooms/${encodeURIComponent(roomId)}/state/m.room.power_levels/`;
  const levels = await matrixFetch<{ events?: Record<string, number> }>(HOMESERVER, levelsPath, {
    accessToken: owner.accessToken,
  });
  await sendStateEvent(HOMESERVER, owner.accessToken, roomId, 'm.room.power_levels', '', {
    ...levels,
    events: { ...levels.events, 'com.mindroom.thread.tags': 0 },
  });

  const claimedId = await startThread(roomId, member, 'Rotate the staging certificates.');
  const agentId = await startThread(roomId, agent, 'Draft the release notes.');
  await resolve(roomId, claimedId, member, owner.userId);
  await resolve(roomId, agentId, agent, owner.userId);

  await loginWithPassword(page, { homeserver: HOMESERVER, ...owner });
  await seedRoomOverviewState({
    page,
    roomId,
    userId: owner.userId,
    viewMode: 'compact',
    filterState: createDefaultThreadFilterState(),
  });
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);
  const byline = (rootId: string) =>
    page
      .locator(`[data-thread-root-id="${rootId}"]`)
      .first()
      .locator('[data-compact-card-resolution-byline="true"]');
  await expect(byline(claimedId)).toHaveText(`Resolved by ${MEMBER_NAME}`, { timeout: 30_000 });
  await expect(byline(agentId)).toHaveText(`Resolved by ${OWNER_NAME}`);

  // The open thread's header says the same.
  await page.locator(`[data-thread-root-id="${claimedId}"]`).first().click();
  await expect.poll(() => new URL(page.url()).searchParams.get('threadId')).toBe(claimedId);
  await expect(page.locator('[data-thread-resolution-byline="true"]')).toHaveAttribute(
    'aria-label',
    `Resolved by ${MEMBER_NAME}`
  );
});
