import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  createDefaultThreadFilterState,
  joinRoom,
  loginToMatrix,
  registerAgentAccount,
  seedRoomOverviewState,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';
import { createRoom } from '../helpers/createRoom';

// The room list's unread mark and the room's unread thread filter agree, against the disposable
// homeserver of `just hs-up` (or a slot of scripts/e2e-slot.sh): a root an agent posted keeps the
// room unread and the filter finds it, and a root the reader answered in its thread leaves the
// room read. Each run registers its own reader and agent.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'room-unread-filter-spec-password';
const RUN = Date.now().toString(36);

const homeserverIsUp = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${HOMESERVER}/_matrix/client/versions`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
};

const registerAndLogin = async (name: string): Promise<MatrixSession & { username: string }> => {
  const username = `ruf_${name}_${RUN}`;
  const response = await fetch(`${HOMESERVER}/_matrix/client/v3/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password: PASSWORD,
      auth: { type: 'm.login.dummy' },
      inhibit_login: true,
    }),
  });
  expect(response.ok, `registering ${username}`).toBe(true);
  return { ...(await loginToMatrix(HOMESERVER, username, PASSWORD)), username };
};

const inThread = (rootId: string, content: Record<string, unknown>) => ({
  ...content,
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: rootId },
  },
});

/** The room's row in the room list; `data-highlight` says whether it shows as unread. */
const roomRow = (page: Page, name: string) =>
  page.locator('[data-highlight]').filter({ has: page.getByRole('link', { name }) });

/** Opens the room in Compact view and turns its Unread filter on; answers the cards it shows. */
const openUnreadThreads = async (page: Page, roomId: string, title: string) => {
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);
  await expect(page.getByRole('heading', { name: title }).first()).toBeVisible({
    timeout: 30_000,
  });
  // The Unread filter is one of the advanced filters.
  const advancedFilters = page.locator('[data-thread-filter-mode-switch]');
  if ((await advancedFilters.getAttribute('aria-pressed')) !== 'true')
    await advancedFilters.click();
  await expect(advancedFilters).toHaveAttribute('aria-pressed', 'true');
  const unreadFilter = page.locator('[data-filter-key="unread"]');
  await unreadFilter.click();
  await expect(unreadFilter).toHaveAttribute('data-filter-state', 'include');
  return page.locator('[data-thread-root-id]');
};

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('the room list marks a room unread only for threads its unread filter finds', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const reader = await registerAndLogin('reader');
  // An agent, so the rooms show the agent rooms' thread filters, Unread among them.
  const writer = await registerAgentAccount(HOMESERVER, 'router');
  const makeRoom = async (name: string) => {
    const roomId = await createRoom(HOMESERVER, reader.accessToken, {
      name,
      invite: [writer.userId],
    });
    await joinRoom(HOMESERVER, writer.accessToken, roomId);
    return roomId;
  };

  // A welcome the agent posted, titled by a summary notice in its thread and not answered.
  const welcomeId = await makeRoom('Welcome Desk');
  const welcomeRoot = await sendRoomMessage(HOMESERVER, writer.accessToken, welcomeId, {
    msgtype: 'm.text',
    body: 'Welcome to the desk',
  });
  await sendRoomMessage(
    HOMESERVER,
    writer.accessToken,
    welcomeId,
    inThread(welcomeRoot, {
      msgtype: 'm.notice',
      body: 'Welcome',
      'io.mindroom.thread_summary': { version: 1, summary: 'Welcome', message_count: 0 },
    })
  );

  // A report the agent posted and answered, and the reader's own reply in its thread.
  const reportId = await makeRoom('Weekly Report');
  const reportRoot = await sendRoomMessage(HOMESERVER, writer.accessToken, reportId, {
    msgtype: 'm.text',
    body: 'The weekly numbers are in',
  });
  await sendRoomMessage(
    HOMESERVER,
    writer.accessToken,
    reportId,
    inThread(reportRoot, { msgtype: 'm.text', body: 'Orders grew this week' })
  );
  await sendRoomMessage(
    HOMESERVER,
    reader.accessToken,
    reportId,
    inThread(reportRoot, { msgtype: 'm.text', body: 'Thanks for the summary' })
  );

  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: reader.username,
    password: PASSWORD,
  });
  for (const roomId of [welcomeId, reportId]) {
    await seedRoomOverviewState({
      page,
      roomId,
      userId: reader.userId,
      viewMode: 'compact',
      filterState: createDefaultThreadFilterState(),
    });
  }

  // The unanswered welcome makes its room unread, and the unread filter finds it.
  await expect(roomRow(page, 'Welcome Desk')).toHaveAttribute('data-highlight', 'true', {
    timeout: 30_000,
  });
  // The answered report leaves its room read.
  await expect(roomRow(page, 'Weekly Report')).toHaveAttribute('data-highlight', 'false');

  const welcomeCards = await openUnreadThreads(page, welcomeId, 'Welcome Desk');
  await expect(welcomeCards).toHaveCount(1);
  await expect(welcomeCards).toHaveAttribute('data-thread-root-id', welcomeRoot);
  await expect(welcomeCards).toHaveAttribute('data-thread-unread', 'true');

  const reportCards = await openUnreadThreads(page, reportId, 'Weekly Report');
  await expect(reportCards).toHaveCount(0);
});
