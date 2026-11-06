import type { Page } from '@playwright/test';
import {
  composer,
  expect,
  inThread,
  lobbyEvents,
  mentionHelper,
  openLobby,
  showThread,
  startThread,
  test,
  uniqueWord,
  type AgentStack,
} from '../helpers/agentStack';
import { matrixFetch, redactEvent } from '../helpers/matrix';

// The header's canvas button follows the conversation's canvases while the page stays open: it
// appears when the agent shows a canvas and goes away when the last one is deleted, with no reload.
// Runs against a live MindRoom backend with the stub model (#canvas makes the helper show one).
test.describe.configure({ timeout: 300_000 });

const headerCanvasButton = (page: Page) =>
  page.locator('header').getByRole('button', { name: /^(Show Canvas|Hide Canvas|Canvases)$/ });

/** What this browser's canvas index lists, for a failure's report. */
const listedCanvases = (page: Page) =>
  page.evaluate(async () => {
    const names = (await indexedDB.databases())
      .map((database) => database.name ?? '')
      .filter((name) => name.startsWith('mindroom-canvas-index::'));
    const rows: unknown[] = [];
    for (const name of names) {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      rows.push(
        ...(await new Promise<unknown[]>((resolve) => {
          const request = database.transaction('canvases').objectStore('canvases').getAll();
          request.onsuccess = () => resolve(request.result as unknown[]);
          request.onerror = () => resolve([]);
        }))
      );
      database.close();
    }
    return rows;
  });

const attachIndex = async (page: Page, name: string) => {
  await test.info().attach(name, {
    body: JSON.stringify(await listedCanvases(page).catch(String), null, 2),
    contentType: 'application/json',
  });
};

/** A room of the tester with the helper and the router, once both joined it. */
const createAgentRoom = async (
  stack: AgentStack,
  name: string,
  encrypted: boolean
): Promise<string> => {
  const { room_id: roomId } = await matrixFetch<{ room_id: string }>(
    stack.homeserver,
    '/createRoom',
    {
      method: 'POST',
      accessToken: stack.tester.accessToken,
      body: JSON.stringify({
        name,
        preset: 'private_chat',
        invite: [stack.agents.helper, stack.agents.router],
        initial_state: encrypted
          ? [
              {
                type: 'm.room.encryption',
                state_key: '',
                content: { algorithm: 'm.megolm.v1.aes-sha2' },
              },
            ]
          : [],
      }),
    }
  );
  await expect
    .poll(
      async () => {
        const { joined } = await matrixFetch<{ joined: Record<string, unknown> }>(
          stack.homeserver,
          `/rooms/${encodeURIComponent(roomId)}/joined_members`,
          { accessToken: stack.tester.accessToken }
        );
        return !!joined[stack.agents.helper] && !!joined[stack.agents.router];
      },
      { timeout: 90_000, intervals: [500, 1000], message: 'the agents join the room' }
    )
    .toBe(true);
  return roomId;
};

/** Moves the loaded client to a thread of `roomId`, as a link inside the app would. */
const showRoomThread = async (page: Page, roomId: string, rootId: string) => {
  await page.evaluate((url) => {
    window.history.pushState(null, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, `/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`);
  await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 60_000 });
};

test('a canvas the agent shows in the open thread puts the canvas button in the header', async ({
  page,
  stack,
}) => {
  await openLobby(page, stack);
  const rootId = await startThread(stack, `${uniqueWord('livecanvas')} #canvas`);
  await showThread(page, stack, rootId);
  await expect(headerCanvasButton(page)).toHaveCount(0);

  await expect
    .poll(
      async () =>
        (await lobbyEvents(stack)).some(
          (event) =>
            inThread(event, rootId) &&
            (event.content['io.mindroom.ui_action'] as { action?: string } | undefined)?.action ===
              'show_canvas'
        ),
      { timeout: 120_000, message: 'the helper shows its canvas' }
    )
    .toBe(true);
  try {
    await expect(headerCanvasButton(page)).toBeVisible({ timeout: 20_000 });
  } finally {
    await attachIndex(page, 'canvas-index.json');
    await page.screenshot({ path: test.info().outputPath('lobby-thread.png') });
  }
});

for (const encrypted of [false, true]) {
  const kind = encrypted ? 'an encrypted' : 'a plain';
  test(`in ${kind} room, the canvas button comes with the agent's canvas and goes with its deletion`, async ({
    page,
    stack,
  }) => {
    const roomId = await createAgentRoom(stack, `Canvas desk ${uniqueWord('r')}`, encrypted);
    await page.goto(`/home/${encodeURIComponent(roomId)}`, { timeout: 180_000 });
    await expect(composer(page)).toBeVisible({ timeout: 90_000 });

    const word = uniqueWord('canvasroom');
    await mentionHelper(page, stack, `#canvas ${word}`);
    const root = page.locator('[data-message-id]').filter({ hasText: word }).first();
    // The row carries the local echo's ID until the server's answer arrives.
    await expect(root).toHaveAttribute('data-message-id', /^\$/, { timeout: 30_000 });
    const rootId = (await root.getAttribute('data-message-id')) ?? '';
    await showRoomThread(page, roomId, rootId);

    const open = page.getByRole('button', { name: 'Open canvas', exact: true }).first();
    await expect(open).toBeVisible({ timeout: 120_000 });
    try {
      await expect(headerCanvasButton(page)).toBeVisible({ timeout: 20_000 });
    } finally {
      await attachIndex(page, 'canvas-index-shown.json');
      await page.screenshot({ path: test.info().outputPath('canvas-shown.png') });
    }

    const canvasRow = page
      .locator('[data-message-id]')
      .filter({ has: page.getByRole('button', { name: 'Open canvas', exact: true }) })
      .last();
    const canvasId = (await canvasRow.getAttribute('data-message-id')) ?? '';
    expect(canvasId).toMatch(/^\$/);
    // The tester made the room, so it may delete the agent's message.
    await redactEvent(stack.homeserver, stack.tester.accessToken, roomId, canvasId);
    await expect(open).toHaveCount(0, { timeout: 30_000 });
    try {
      await expect(headerCanvasButton(page)).toHaveCount(0, { timeout: 20_000 });
    } finally {
      await attachIndex(page, 'canvas-index-deleted.json');
      await page.screenshot({ path: test.info().outputPath('canvas-deleted.png') });
    }
  });
}
