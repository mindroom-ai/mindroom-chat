import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import {
  composer,
  expect,
  inThread,
  lobbyEvents,
  mentionHelper,
  openLobby,
  openNewSession,
  sendFromComposer,
  showThread,
  startThread,
  test,
  uniqueWord,
  type AgentStack,
  createAgentRoom,
} from '../helpers/agentStack';
import { redactEvent } from '../helpers/matrix';
import { isPhoneLayout, roomMoreOptions } from '../helpers/roomMenu';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

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

/** The thread mode the backend keeps for `roomId` (`!thread_mode`), if any. */
const roomModeOverride = (stack: AgentStack, roomId: string): string | undefined => {
  try {
    const overrides = JSON.parse(
      readFileSync(join(stack.dir, 'storage', 'tracking', 'room_thread_modes.json'), 'utf8')
    ) as Record<string, { mode?: string }>;
    return overrides[roomId]?.mode;
  } catch {
    return undefined;
  }
};

/** Moves the loaded client to `url`, as a link inside the app would. */
const showInApp = (page: Page, url: string) =>
  page.evaluate((target) => {
    window.history.pushState(null, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, url);

/** Moves the loaded client to a thread of `roomId`. */
const showRoomThread = async (page: Page, roomId: string, rootId: string) => {
  await showInApp(page, `/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`);
  await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 60_000 });
};

/** Moves the loaded client to the main conversation of `roomId` (sending from it opens a thread). */
const showRoomMain = async (page: Page, roomId: string) => {
  await showInApp(page, `/home/${encodeURIComponent(roomId)}`);
  await expect(page.locator('[data-thread-context-banner]')).toHaveCount(0, { timeout: 30_000 });
  await expect(composer(page)).toBeVisible({ timeout: 30_000 });
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

type Scenario = { conversation: 'thread' | 'room'; encrypted: boolean };

const SCENARIOS: Scenario[] = [
  { conversation: 'thread', encrypted: false },
  { conversation: 'thread', encrypted: true },
  { conversation: 'room', encrypted: false },
  { conversation: 'room', encrypted: true },
];

const scenarioName = ({ conversation, encrypted }: Scenario) =>
  `${encrypted ? 'an encrypted' : 'a plain'} room's ${
    conversation === 'thread' ? 'thread' : 'main timeline'
  }`;

/**
 * Whether the conversation offers a canvas: the header's button, or on a phone the room menu's
 * entry (the menu opens for the look and closes again).
 */
const canvasOffered = async (page: Page): Promise<boolean> => {
  if (!isPhoneLayout(page)) return (await headerCanvasButton(page).count()) > 0;
  await roomMoreOptions(page).click();
  const entry = page.getByRole('menuitem', { name: /^(Show Canvas|Hide Canvas|Canvases)$/ });
  await expect(page.getByRole('menu')).toBeVisible();
  const offered = (await entry.count()) > 0;
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  return offered;
};

const expectCanvasOffered = async (
  page: Page,
  offered: boolean,
  shot: string,
  timeout = 20_000
) => {
  try {
    await expect.poll(() => canvasOffered(page), { timeout }).toBe(offered);
  } finally {
    await attachIndex(page, `${shot}.json`);
    await page.screenshot({ path: test.info().outputPath(`${shot}.png`) });
  }
};

/**
 * The helper shows a canvas in the conversation while the page stays open, and the room's creator
 * then deletes it: the canvas button (a phone's room menu entry) comes and goes with it.
 */
const canvasComesAndGoes = async (page: Page, stack: AgentStack, scenario: Scenario) => {
  const roomId = await createAgentRoom(stack, `Canvas desk ${uniqueWord('r')}`, scenario.encrypted);
  await page.goto(`/home/${encodeURIComponent(roomId)}`, { timeout: 180_000 });
  await expect(composer(page)).toBeVisible({ timeout: 90_000 });
  if (scenario.conversation === 'room') {
    // The room's creator is its admin, and so may move its agents to the main timeline. The
    // backend keeps the choice in its storage, where the helper reads it when it answers.
    await sendFromComposer(page, '!thread_mode room');
    await expect
      .poll(() => roomModeOverride(stack, roomId), {
        timeout: 60_000,
        message: 'the room answers in its main timeline',
      })
      .toBe('room');
    await showRoomMain(page, roomId);
  }

  const word = uniqueWord('canvasroom');
  await mentionHelper(page, stack, `#canvas ${word}`);
  if (scenario.conversation === 'room') {
    // The helper answers in the main timeline; its canvas belongs to the room's main conversation.
    await showRoomMain(page, roomId);
  } else {
    const root = page.locator('[data-message-id]').filter({ hasText: word }).first();
    // The row carries the local echo's ID until the server's answer arrives.
    await expect(root).toHaveAttribute('data-message-id', /^\$/, { timeout: 30_000 });
    await showRoomThread(page, roomId, (await root.getAttribute('data-message-id')) ?? '');
  }

  // The helper answers within seconds; the button must follow without a reload.
  await expectCanvasOffered(page, true, 'canvas-shown', 120_000);
  const listed = (await listedCanvases(page)) as { canvasId: string; roomId: string }[];
  const canvasId = listed.find((entry) => entry.roomId === roomId)?.canvasId ?? '';
  expect(canvasId).toMatch(/^\$/);
  // The tester made the room, so it may delete the agent's message.
  await redactEvent(stack.homeserver, stack.tester.accessToken, roomId, canvasId);
  await expectCanvasOffered(page, false, 'canvas-deleted');
};

for (const scenario of SCENARIOS) {
  test(`in ${scenarioName(scenario)}, the canvas button comes with the agent's canvas and goes with its deletion`, async ({
    page,
    stack,
  }) => {
    await canvasComesAndGoes(page, stack, scenario);
  });

  test(`in ${scenarioName(scenario)}, the room menu's canvas entry comes and goes on a phone (WebKit)`, async ({
    stack,
    baseURL,
  }) => {
    test.skip(!WEBKIT_EXECUTABLE, 'PLAYWRIGHT_WEBKIT_EXECUTABLE names no WebKit');
    const webkit = await launchWebKit();
    try {
      const page = await openNewSession(webkit, stack, {
        baseURL,
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        // WebKit's routes do not see what a service worker fetches, so the worker would fetch the
        // unrouted config.json, which has canvases off.
        serviceWorkers: 'block',
      });
      await canvasComesAndGoes(page, stack, scenario);
    } finally {
      await webkit.close();
    }
  });
}
