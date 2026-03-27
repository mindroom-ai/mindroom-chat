import { expect, test, type Page } from '@playwright/test';
import { expectLoggedInShellStable, loginWithPassword } from '../helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from '../helpers/browserDiagnostics';

const DEFAULT_HOMESERVER = 'http://localhost:8008';
const DEFAULT_USERNAME = 'e2e-test-bot';
const DEFAULT_PASSWORD = 'e2e-test-pw-2026';

type ThreadFixture = {
  roomId: string;
  roomName: string;
  rootId: string;
};

const getHomeserver = () => process.env.E2E_HOMESERVER ?? DEFAULT_HOMESERVER;
const getUsername = () => process.env.E2E_USERNAME ?? DEFAULT_USERNAME;
const getPassword = () => process.env.E2E_PASSWORD ?? DEFAULT_PASSWORD;

const matrixFetch = async (
  homeserver: string,
  path: string,
  options: RequestInit & { accessToken?: string } = {}
) => {
  const { accessToken, headers, ...rest } = options;
  const response = await fetch(`${homeserver}/_matrix/client/v3${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
  });
  const body = await response.json();

  if (!response.ok) {
    const error = [body.errcode, body.error].filter(Boolean).join(' ');
    throw new Error(`Matrix API ${response.status} for ${path}: ${error || 'unknown error'}`);
  }

  return body;
};

const loginToMatrix = async (homeserver: string, username: string, password: string) => {
  const body = await matrixFetch(homeserver, '/login', {
    method: 'POST',
    body: JSON.stringify({
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user: username },
      password,
    }),
  });

  return body.access_token as string;
};

const sendRoomMessage = async (
  homeserver: string,
  accessToken: string,
  roomId: string,
  content: Record<string, unknown>
) => {
  const txnId = `cinny-030-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const body = await matrixFetch(
    homeserver,
    `/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`,
    {
      method: 'PUT',
      accessToken,
      body: JSON.stringify(content),
    }
  );

  return body.event_id as string;
};

const seedThreadRoom = async (
  homeserver: string,
  accessToken: string,
  roomLabel: string
): Promise<ThreadFixture> => {
  const roomName = `CINNY-030 ${roomLabel} ${Date.now()}`;
  const roomBody = await matrixFetch(homeserver, '/createRoom', {
    method: 'POST',
    accessToken,
    body: JSON.stringify({
      name: roomName,
      topic: `Live fixture for CINNY-030 ${roomLabel}.`,
      preset: 'private_chat',
    }),
  });
  const roomId = roomBody.room_id as string;

  await sendRoomMessage(homeserver, accessToken, roomId, {
    msgtype: 'm.text',
    body: `${roomLabel} filler message`,
  });

  const rootId = await sendRoomMessage(homeserver, accessToken, roomId, {
    msgtype: 'm.text',
    body: `${roomLabel} thread root`,
  });

  await sendRoomMessage(homeserver, accessToken, roomId, {
    msgtype: 'm.text',
    body: `${roomLabel} thread reply`,
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: rootId },
    },
  });

  return { roomId, roomName, rootId };
};

const waitForThreadOverview = async (page: Page) => {
  await expect(page.locator('[data-room-thread-overview="true"]')).toBeVisible({
    timeout: 30_000,
  });
};

const navigateToRoom = async (page: Page, roomName: string) => {
  const roomLink = page.locator('nav a', { hasText: roomName }).first();

  await expect(roomLink).toBeVisible({ timeout: 30_000 });
  await roomLink.click();
  await expect(roomLink).toHaveAttribute('aria-selected', 'true');
  await waitForThreadOverview(page);
  await expect(page.getByText('Unexpected Application Error!')).toHaveCount(0);
};

const expectPressedState = async (page: Page, label: RegExp | string, pressed: boolean) => {
  const button = page.getByRole('button', { name: label });
  await expect(button).toHaveAttribute('aria-pressed', pressed ? 'true' : 'false');
};

test.describe('live cinny-030 thread filter persistence', () => {
  test('thread overview toolbar state persists per room across navigation', async ({ page }) => {
    test.slow();

    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const username = getUsername();
    const password = getPassword();
    const accessToken = await loginToMatrix(homeserver, username, password);
    const roomA = await seedThreadRoom(homeserver, accessToken, 'Room A');
    const roomB = await seedThreadRoom(homeserver, accessToken, 'Room B');

    await loginWithPassword(page, { homeserver, username, password });
    await expectLoggedInShellStable(page);

    await navigateToRoom(page, roomA.roomName);
    await page.getByRole('button', { name: /Show unresolved threads/ }).click();
    await page.getByRole('button', { name: 'Sort threads by streaming activity' }).click();
    await expectPressedState(page, /Show unresolved threads/, true);
    await expectPressedState(page, 'Sort threads by streaming activity', true);

    await navigateToRoom(page, roomB.roomName);
    await expectPressedState(page, /Show all threads/, true);
    await expectPressedState(page, /Show unresolved threads/, false);
    await expectPressedState(page, 'Sort threads by streaming activity', false);

    await page.getByRole('button', { name: /Show resolved threads/ }).click();
    await page.getByRole('button', { name: 'Sort threads by scheduled tasks' }).click();
    await expectPressedState(page, /Show resolved threads/, true);
    await expectPressedState(page, 'Sort threads by scheduled tasks', true);

    await navigateToRoom(page, roomA.roomName);
    await expectPressedState(page, /Show unresolved threads/, true);
    await expectPressedState(page, /Show resolved threads/, false);
    await expectPressedState(page, 'Sort threads by streaming activity', true);
    await expectPressedState(page, 'Sort threads by scheduled tasks', false);

    await navigateToRoom(page, roomB.roomName);
    await expectPressedState(page, /Show resolved threads/, true);
    await expectPressedState(page, /Show all threads/, false);
    await expectPressedState(page, 'Sort threads by scheduled tasks', true);
    await expectPressedState(page, 'Sort threads by streaming activity', false);

    await page.screenshot({
      path: 'test-results/cinny030-thread-filter-persistence.png',
      fullPage: true,
    });
    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'cinny-030-thread-filter-persistence');
  });
});
