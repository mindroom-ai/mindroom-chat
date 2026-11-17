// @ts-check
// Drives the Chat of a `just live up` deployment (scripts/live.py) in Chromium: signs in as the
// e2e helpers do (e2e/helpers/agentStack.ts), sends a message to the lobby and waits until the
// agent's reply is final, which it reads from the Matrix API rather than the page.
//
// Usage: node scripts/live-ask.mjs <state file> <text> <screenshot file>   (`just live ask` runs it)
//
// A custom check (`just live run <script.mjs>`, from any directory) imports it by absolute path;
// `ask` returns the reply's text and `locator`, its row on the page, still open in its thread:
//   import { readState, launch, login, ask } from '/abs/path/to/scripts/live-ask.mjs';
//   const state = readState(); // MINDROOM_LIVE_STATE, which `just live run` sets
//   const browser = await launch(); const page = await browser.newPage();
//   await login(page, state); const reply = await ask(page, state, 'Hello');
//   await reply.locator.locator('table').waitFor();
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

/** @typedef {import('@playwright/test').Page} Page */
/**
 * @typedef {{ loginUrl: string, username: string, password: string, userId: string,
 *   accessToken: string, homeserver: string, lobby: { roomId: string, url: string } }} LiveState
 * @typedef {{ event_id: string, sender: string, type: string, origin_server_ts: number,
 *   content: Record<string, any> }} MatrixEvent
 * @typedef {(path: string) => Promise<any>} FetchJson
 */

// The stream states of a reply that is still being written (MindRoom's constants.py).
const UNFINISHED = new Set(['pending', 'streaming', 'approval_pending']);

/** @param {string | undefined} path @returns {LiveState} */
export const readState = (path = process.env.MINDROOM_LIVE_STATE) => {
  if (!path) throw new Error('no state file: pass its path or run the script with `just live run`');
  return JSON.parse(readFileSync(path, 'utf8'));
};

/** Chromium from CHROMIUM_PATH (`nix develop` sets it). */
export const launch = () =>
  chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

/** @param {Page} page */
export const composer = (page) => page.getByRole('textbox', { name: 'Send a message...' });

/**
 * Signs in through the login page and waits for the signed-in shell, whose first start sets up
 * encryption (minutes on a loaded machine): navigate only after it returns.
 * @param {Page} page @param {LiveState} state
 */
export const login = async (page, state) => {
  // A new browser starts without the member list, and agent replies show their tool calls.
  await page.addInitScript(() => {
    if (!localStorage.getItem('settings')) {
      localStorage.setItem(
        'settings',
        JSON.stringify({ isPeopleDrawer: false, showToolCalls: true })
      );
    }
  });
  await page.goto(state.loginUrl, { timeout: 180_000 });
  await page.locator('input[name="usernameInput"]').fill(state.username);
  await page.locator('input[name="passwordInput"]').fill(state.password);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page
    .getByRole('button', { name: /Open account menu for / })
    .first()
    .waitFor({ timeout: 240_000 });
};

/** @param {Page} page @param {LiveState} state */
export const openLobby = async (page, state) => {
  await page.goto(state.lobby.url, { timeout: 180_000 });
  await composer(page).waitFor({ timeout: 90_000 });
};

/** @param {LiveState} state @returns {FetchJson} GET requests to the homeserver as the tester */
export const matrixGet = (state) => async (path) => {
  const response = await fetch(`${state.homeserver}/_matrix/client${path}`, {
    headers: { Authorization: `Bearer ${state.accessToken}` },
  });
  if (!response.ok) throw new Error(`Matrix API ${response.status} for ${path}`);
  return response.json();
};

/**
 * The ID of the tester's newest message `text` in the lobby sent at `since` or later, if any.
 * @param {LiveState} state @param {string} text @param {number} since @param {FetchJson} get
 */
export const sentEventId = async (state, text, since, get) => {
  const room = encodeURIComponent(state.lobby.roomId);
  const { chunk } = /** @type {{ chunk: MatrixEvent[] }} */ (
    await get(`/v3/rooms/${room}/messages?dir=b&limit=50`)
  );
  return chunk.find(
    (event) =>
      event.sender === state.userId &&
      event.type === 'm.room.message' &&
      event.content.body === text &&
      event.origin_server_ts >= since
  )?.event_id;
};

/**
 * The agent's final reply in the thread of `rootId`, or undefined while there is none: a message
 * of the thread whose newest edit (one request each, however many edits it has) carries a stream
 * status that is no longer unfinished.
 * @param {LiveState} state @param {string} rootId @param {FetchJson} get
 * @returns {Promise<{ eventId: string, sender: string, body: string, status: string } | undefined>}
 */
export const finalReply = async (state, rootId, get) => {
  const room = encodeURIComponent(state.lobby.roomId);
  const { chunk } = /** @type {{ chunk: MatrixEvent[] }} */ (
    await get(`/v1/rooms/${room}/relations/${encodeURIComponent(rootId)}/m.thread?dir=f&limit=50`)
  );
  for (const event of chunk) {
    if (event.sender === state.userId || !('io.mindroom.stream_status' in event.content)) continue;
    const edits = /** @type {{ chunk: MatrixEvent[] }} */ (
      await get(
        `/v1/rooms/${room}/relations/${encodeURIComponent(event.event_id)}/m.replace?dir=b&limit=1`
      )
    );
    const newest = edits.chunk[0];
    const content = newest ? newest.content['m.new_content'] ?? newest.content : event.content;
    const status = content['io.mindroom.stream_status'];
    if (typeof status === 'string' && !UNFINISHED.has(status)) {
      return { eventId: event.event_id, sender: event.sender, body: String(content.body), status };
    }
  }
  return undefined;
};

/**
 * Opens the lobby, sends `text` from the composer and returns the agent's final reply with
 * `locator`, its row on the page (the thread stays open), once the page shows it.
 * @param {Page} page @param {LiveState} state @param {string} text
 */
export const ask = async (page, state, text, timeout = 300_000) => {
  const get = matrixGet(state);
  await openLobby(page, state);
  // The homeserver's clock is this machine's; a second of slack covers the rounding.
  const since = Date.now() - 1000;
  await composer(page).click();
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  const deadline = Date.now() + timeout;
  /** @type {string | undefined} */
  let rootId;
  for (;;) {
    rootId ??= await sentEventId(state, text, since, get);
    const reply = rootId ? await finalReply(state, rootId, get) : undefined;
    if (reply) {
      const locator = page.locator(`[data-message-id="${reply.eventId}"]`).first();
      await locator.waitFor({ timeout: 30_000 }).catch(() => undefined);
      // A moment to render the final edit.
      await page.waitForTimeout(1500);
      return { ...reply, locator };
    }
    if (Date.now() > deadline) {
      const what = rootId ? 'no final reply' : 'the sent message never reached the lobby';
      throw new Error(`${what} for "${text}" within ${timeout / 1000} s`);
    }
    await page.waitForTimeout(1000);
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [stateFile, text, screenshot] = process.argv.slice(2);
  if (!stateFile || !text || !screenshot) {
    console.error('usage: node scripts/live-ask.mjs <state file> <text> <screenshot file>');
    process.exit(2);
  }
  const state = readState(stateFile);
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await login(page, state);
    const reply = await ask(page, state, text);
    await page.screenshot({ path: screenshot });
    console.log(`${reply.sender} (${reply.status}):\n${reply.body}\n\nscreenshot: ${screenshot}`);
  } finally {
    await browser.close();
  }
}
