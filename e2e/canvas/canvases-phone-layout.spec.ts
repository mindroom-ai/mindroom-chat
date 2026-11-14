import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createThreadFixture, joinRoom, matrixFetch, sendRoomMessage } from '../helpers/matrix';
import { WEBKIT_EXECUTABLE, launchWebKit } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// The Canvases page on a phone (live-test L9-F010): every column of a canvas shows inside the
// viewport, and a long title wraps instead of being cut at the screen's edge. On a desktop the
// list stays a table. Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names it, WebKit; phone
// 390x844 with touch, light and dark. Set CANVASES_SHOTS=<directory> for screenshots.
// The page names each canvas's agent by its display name, also on a device that has not loaded
// the room's members since it started (live-test pass 2, P2-lane9-F004).

const SHOTS = process.env.CANVASES_SHOTS;
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
// A thread title with one long token, as agents' generated titles have.
const LONG_TOKEN = 'canvasoffmw4fjk96a6lq9xk2';

test.use({ video: 'off' });

type Fixture = {
  username: string;
  password: string;
  roomName: string;
  agentName: string;
  roomId: string;
  rootId: string;
};

/**
 * `later` messages from the viewer follow the canvases, so a sync that loads members lazily leaves
 * out the agent, who spoke before the window it sends.
 */
const seed = async (later = 0): Promise<Fixture> => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const password = randomUUID();
  const register = (username: string) =>
    matrixFetch<{ access_token: string; user_id: string }>(HOMESERVER, '/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, auth: { type: 'm.login.dummy' } }),
    });
  const username = `canvas_phone_${suffix}`;
  const viewer = await register(username);
  const agent = await register(`mindroom_planner_${suffix}`);
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(agent.user_id)}/displayname`, {
    method: 'PUT',
    accessToken: agent.access_token,
    body: JSON.stringify({ displayname: 'Planner' }),
  });
  const roomName = 'Weekend planning with the family';
  const fixture = await createThreadFixture(HOMESERVER, viewer.access_token, {
    name: roomName,
    topic: 'Canvases on a phone',
    rootBody: `Stub title: ${LONG_TOKEN} canvas`,
    replyBody: 'The trip conversation',
    invite: [agent.user_id],
  });
  await joinRoom(HOMESERVER, agent.access_token, fixture.roomId);
  const showCanvas = (title: string, threadId: string | null) =>
    sendRoomMessage(HOMESERVER, agent.access_token, fixture.roomId, {
      msgtype: 'm.notice',
      body: `Interactive panel: ${title}.`,
      ...(threadId ? { 'm.relates_to': { rel_type: 'm.thread', event_id: threadId } } : {}),
      'io.mindroom.ui_action': {
        version: 1,
        action: 'show_canvas',
        requester_id: viewer.user_id,
        agent_user_id: agent.user_id,
        room_id: fixture.roomId,
        thread_id: threadId,
        canvas: { title, html: `<h1>${title}</h1>` },
      },
    });
  await showCanvas('Packing list for the coast trip', fixture.rootId);
  await showCanvas('Morning briefing', null);
  for (let index = 0; index < later; index += 1) {
    await sendRoomMessage(HOMESERVER, viewer.access_token, fixture.roomId, {
      msgtype: 'm.text',
      body: `Later note ${index + 1} about the trip, with a few more words to fill the line.`,
    });
  }
  return {
    username,
    password,
    roomName,
    agentName: 'Planner',
    roomId: fixture.roomId,
    rootId: fixture.rootId,
  };
};

const routeConfig = (context: BrowserContext) =>
  context.route('**/config.json', async (route) => {
    const response = await route.fetch();
    const config = await response.json();
    await route.fulfill({
      json: {
        ...config,
        homeserverList: [HOMESERVER],
        defaultHomeserver: 0,
        allowCustomHomeservers: true,
        hashRouter: { enabled: false },
        auth: { allowRegistration: false, disablePasswordLogin: false },
        mindroom: { ...config.mindroom, canvas: { enabled: true } },
      },
    });
  });

const openCanvases = async (page: Page, fixture: Fixture) => {
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: fixture.username,
    password: fixture.password,
  });
  await page.goto('/canvases/');
  const list = page.getByTestId('canvases-view');
  await expect(list.locator('tbody tr')).toHaveCount(2, { timeout: 30_000 });
  // The newest canvas comes first; the one in the thread with the long title is second.
  await expect(list.locator('tbody tr').nth(1)).toContainText(LONG_TOKEN);
  return list;
};

/** Every row's cells lie inside the viewport, nothing scrolls sideways, and no text is cut. */
const expectRowsInside = async (page: Page, fixture: Fixture, label: string) => {
  const list = page.getByTestId('canvases-view');
  const layout = await list.evaluate((root) => {
    const width = document.documentElement.clientWidth;
    const overflowing = [...root.querySelectorAll<HTMLElement>('*')]
      // A box of 1 px or less is visually hidden on purpose (the phone layout's header row).
      .filter((element) => element.clientWidth > 1)
      .filter((element) => element.scrollWidth > element.clientWidth + 1)
      .filter((element) => getComputedStyle(element).overflowX !== 'visible')
      .map((element) => `${element.tagName}.${element.className}`);
    const outside = [...root.querySelectorAll<HTMLElement>('tbody td, tbody td *')]
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return box.width > 0 && (box.left < -1 || box.right > width + 1);
      })
      .map((element) => element.textContent?.slice(0, 40) ?? element.tagName);
    return { overflowing, outside };
  });
  expect(layout.outside, `${label}: cells outside the viewport`).toEqual([]);
  expect(layout.overflowing, `${label}: boxes that scroll sideways or cut text`).toEqual([]);
  const rows = list.locator('tbody tr');
  for (const index of [0, 1]) {
    const row = rows.nth(index);
    // Each row names its room and agent and both dates, all on screen.
    await expect(row.getByRole('button', { name: fixture.roomName })).toBeInViewport();
    await expect(row.getByText(fixture.agentName, { exact: true })).toBeInViewport();
  }
  await expect(rows.nth(1).getByText(LONG_TOKEN, { exact: false })).toBeInViewport({ ratio: 1 });
};

const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

test('the Canvases page fits a phone in Chromium, light and dark', async ({ browser }) => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
  const fixture = await seed();
  for (const colorScheme of ['light', 'dark'] as const) {
    const context = await browser.newContext({ ...PHONE, colorScheme });
    await routeConfig(context);
    const page = await context.newPage();
    await openCanvases(page, fixture);
    await expectRowsInside(page, fixture, `Chromium phone ${colorScheme}`);
    await shot(page, `canvases-phone-chromium-${colorScheme}`);
    await context.close();
  }

  // A desktop keeps the table and its header row.
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await routeConfig(context);
  const page = await context.newPage();
  const list = await openCanvases(page, fixture);
  await expect(list.getByRole('columnheader', { name: 'Room' })).toBeVisible();
  await expect(list.getByRole('columnheader', { name: 'Updated' })).toBeVisible();
  const rowTops = await list
    .locator('tbody tr')
    .first()
    .locator('td')
    .evaluateAll((cells) => cells.map((cell) => Math.round(cell.getBoundingClientRect().top)));
  expect(new Set(rowTops).size, 'desktop: one line of cells per canvas').toBe(1);
  await expectRowsInside(page, fixture, 'Chromium desktop');
  await shot(page, 'canvases-desktop-chromium');
  await context.close();
});

test('the Canvases page fits a phone in WebKit', async () => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
  test.skip(!WEBKIT_EXECUTABLE, 'PLAYWRIGHT_WEBKIT_EXECUTABLE not set');
  const fixture = await seed();
  const browser = await launchWebKit();
  try {
    const context = await browser.newContext({
      ...PHONE,
      baseURL: test.info().project.use.baseURL,
    });
    await routeConfig(context);
    const page = await context.newPage();
    await openCanvases(page, fixture);
    await expectRowsInside(page, fixture, 'WebKit phone');
    await shot(page, 'canvases-phone-webkit');
  } finally {
    await browser.close();
  }
});

/**
 * A fresh sign-in opens the canvas's thread, which lists the canvas, and then starts again on the
 * Canvases page: the room's members are not loaded in that start, and the agent spoke before the
 * window of the room that sync sends. The page still names the agent as the rest of the app does.
 */
const checkAgentName = async (browser: Browser, engine: string) => {
  const fixture = await seed(30);
  const context = await browser.newContext({
    ...PHONE,
    baseURL: test.info().project.use.baseURL,
  });
  try {
    await routeConfig(context);
    const page = await context.newPage();
    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: fixture.username,
      password: fixture.password,
    });
    await page.goto(
      `/home/${encodeURIComponent(fixture.roomId)}?threadId=${encodeURIComponent(fixture.rootId)}`
    );
    await expect(page.getByText('The trip conversation', { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    // The thread's events reach the canvas list after they load.
    await page.waitForTimeout(2_000);
    await page.goto('/canvases/');
    const row = page
      .getByTestId('canvases-view')
      .locator('tbody tr')
      .filter({ hasText: 'Packing list for the coast trip' });
    await expect(row).toHaveCount(1, { timeout: 30_000 });
    await expect(row.getByText(fixture.agentName, { exact: true }), engine).toBeVisible({
      timeout: 15_000,
    });
    await expect(row).not.toContainText('mindroom_planner_');
    // The thread's name follows once the thread is read; the screenshot waits for it.
    await expect(row).toContainText(LONG_TOKEN, { timeout: 30_000 });
    await shot(page, `canvases-agent-name-${engine}`);
  } finally {
    await context.close();
  }
};

test('the Canvases page names the agent after a fresh start (Chromium phone)', async ({
  browser,
}) => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
  await checkAgentName(browser, 'chromium');
});

test('the Canvases page names the agent after a fresh start (WebKit phone)', async () => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
  test.skip(!WEBKIT_EXECUTABLE, 'PLAYWRIGHT_WEBKIT_EXECUTABLE not set');
  const browser = await launchWebKit();
  try {
    await checkAgentName(browser, 'webkit');
  } finally {
    await browser.close();
  }
});
