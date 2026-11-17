// @ts-check
// Drives the Chat of a `just live up` deployment (scripts/live.py) in Chromium: signs in as the
// e2e helpers do (e2e/helpers/agentStack.ts), sends a message to the lobby and waits until the
// agent's reply is final, which it reads from the Matrix API rather than the page.
//
// Usage: node scripts/live-ask.mjs <state file> <text> <screenshot file>   (`just live ask` runs it)
//
// A custom browser check imports it by absolute path from anywhere, /tmp included:
//   import { readState, launch, login, ask } from '/abs/path/to/scripts/live-ask.mjs';
//   const state = readState('/tmp/mindroom-live/slot-50.json');
//   const browser = await launch(); const page = await browser.newPage();
//   await login(page, state); const reply = await ask(page, state, 'Hello');
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

/** @typedef {import('@playwright/test').Page} Page */
/**
 * @typedef {{ loginUrl: string, username: string, password: string, userId: string,
 *   accessToken: string, homeserver: string, lobby: { roomId: string, url: string } }} LiveState
 * @typedef {{ event_id: string, sender: string, type: string, origin_server_ts: number,
 *   content: Record<string, any> }} MatrixEvent
 */

// The stream states of a reply that is still being written (MindRoom's constants.py).
const UNFINISHED = new Set(['pending', 'streaming', 'approval_pending']);

/** @param {string} path @returns {LiveState} */
export const readState = (path) => JSON.parse(readFileSync(path, 'utf8'));

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

/** @param {LiveState} state @returns {Promise<MatrixEvent[]>} the lobby's latest events, newest first */
const lobbyEvents = async (state) => {
  const room = encodeURIComponent(state.lobby.roomId);
  const response = await fetch(
    `${state.homeserver}/_matrix/client/v3/rooms/${room}/messages?dir=b&limit=200`,
    { headers: { Authorization: `Bearer ${state.accessToken}` } }
  );
  if (!response.ok) throw new Error(`Matrix API ${response.status} for the lobby's messages`);
  return /** @type {{ chunk: MatrixEvent[] }} */ (await response.json()).chunk;
};

/**
 * The final reply in the thread of the tester's message `text` sent at `since` or later, or
 * undefined while there is none: an agent's message whose latest edit has a stream status that
 * is no longer unfinished.
 * @param {MatrixEvent[]} events newest first
 * @param {LiveState} state @param {string} text @param {number} since
 * @returns {{ eventId: string, sender: string, body: string, status: string } | undefined}
 */
export const finalReply = (events, state, text, since) => {
  const root = events.find(
    (event) =>
      event.sender === state.userId &&
      event.type === 'm.room.message' &&
      event.content.body === text &&
      event.origin_server_ts >= since
  );
  if (!root) return undefined;
  /** @type {Map<string, Record<string, any>>} */
  const latest = new Map();
  for (const event of events) {
    const relation = event.content['m.relates_to'];
    if (relation?.rel_type === 'm.replace' && !latest.has(relation.event_id)) {
      latest.set(relation.event_id, event.content['m.new_content'] ?? event.content);
    }
  }
  const replies = events.filter(
    (event) =>
      event.sender !== state.userId &&
      event.content['m.relates_to']?.rel_type === 'm.thread' &&
      event.content['m.relates_to']?.event_id === root.event_id
  );
  for (const event of replies.reverse()) {
    const content = latest.get(event.event_id) ?? event.content;
    const status = content['io.mindroom.stream_status'];
    if (typeof status === 'string' && !UNFINISHED.has(status)) {
      return { eventId: event.event_id, sender: event.sender, body: String(content.body), status };
    }
  }
  return undefined;
};

/**
 * Opens the lobby, sends `text` from the composer and returns the agent's final reply once the
 * page shows it.
 * @param {Page} page @param {LiveState} state @param {string} text
 */
export const ask = async (page, state, text, timeout = 300_000) => {
  await openLobby(page, state);
  // The homeserver's clock is this machine's; a second of slack covers the rounding.
  const since = Date.now() - 1000;
  await composer(page).click();
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  const deadline = Date.now() + timeout;
  for (;;) {
    const reply = finalReply(await lobbyEvents(state), state, text, since);
    if (reply) {
      // The thread opens on its own; give the page a moment to render the final edit.
      await page
        .locator(`[data-message-id="${reply.eventId}"]`)
        .first()
        .waitFor({ timeout: 30_000 })
        .catch(() => undefined);
      await page.waitForTimeout(1500);
      return reply;
    }
    if (Date.now() > deadline)
      throw new Error(`no final reply to "${text}" within ${timeout / 1000} s`);
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
