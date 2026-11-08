import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { logoutActiveAccount, switchToStoredUsername } from '../helpers/accounts';
import {
  activeAccountButtonNamePattern,
  chooseFromAccountMenu,
  loginWithPassword,
} from '../helpers/auth';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  type DisposableUser,
} from '../helpers/disposableAccounts';
import { createRoom } from '../helpers/createRoom';
import { joinRoom, registerAgentAccount, sendRoomMessage } from '../helpers/matrix';
import { roomHeader, roomMoreOptions } from '../helpers/roomMenu';
import { showRoom } from '../helpers/sidePanels';
import { serveBuild } from '../helpers/staticBuildServer';

// A production build with the example client plugin (src/app/plugins/__fixtures__/example-plugin),
// served as a deployment serves it, against the disposable homeserver. Each greeting card of the
// plugin opens the plugin's side panel from the plugin's code with the greeting's event ID as its
// request, and the panel reads the greeting and shows it; a second card's request replaces the
// first. Folded to its tab, the panel unfolds from its toggle in the room header with its request.
// The panel remembers it is open: a reload and a switch to another room and back keep it open in
// its room, with its request, which the browser keeps without the greeting's text, and only there.
// Another account in the same browser never sees it, and signing out deletes it. It may take the
// members list's place (`opensOverMembers`): back in its room after the members opened elsewhere, it
// opens again and the members close, while on a phone it opens again over them as before. Its name
// is a key of the plugin's strings, "Beispielbereich" in German: the toggle, the panel and its Close
// follow the language picked in Settings, wide and on a phone, without a reload.
// Set PLUGIN_SHOTS=<directory> to save screenshots.
const PLUGIN = resolve('src/app/plugins/__fixtures__/example-plugin');
const PASSWORD = 'plugin-panel-password';
const RUN = Date.now().toString(36);
const ROOM = `Panel requests ${RUN}`;
const ELSEWHERE = `Elsewhere ${RUN}`;

const PHONE = { width: 390, height: 844 };
const WIDE = { width: 1600, height: 1000 };

test.use({ viewport: WIDE });

let build: string | undefined;
let alice: DisposableUser;
let bob: DisposableUser;
let roomId = '';
let threadPath = '';
let roomPath = '';
const greetings: { id: string; text: string }[] = [];

test.beforeAll(async () => {
  if (!(await disposableHomeserverIsUp())) return;
  test.setTimeout(10 * 60_000);
  build = mkdtempSync(join(tmpdir(), 'mindroom-plugin-panel-open-build-'));
  const result = spawnSync('npx', ['vite', 'build', '--outDir', build, '--emptyOutDir'], {
    env: { ...process.env, MINDROOM_CLIENT_PLUGINS: PLUGIN },
    encoding: 'utf8',
    timeout: 9 * 60_000,
  });
  if (result.status !== 0) {
    throw new Error(
      `the build with the plugin failed:\n${(result.stderr || result.stdout).slice(-3000)}`
    );
  }

  alice = await registerDisposableUser(`panel_alice_${RUN}`, PASSWORD);
  bob = await registerDisposableUser(`panel_bob_${RUN}`, PASSWORD);
  const agent = await registerAgentAccount(HOMESERVER, 'greeter');
  roomId = await createRoom(HOMESERVER, alice.accessToken, {
    name: ROOM,
    invite: [agent.userId, bob.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  await joinRoom(HOMESERVER, bob.accessToken, roomId);
  await createRoom(HOMESERVER, alice.accessToken, { name: ELSEWHERE });
  const rootId = await sendRoomMessage(HOMESERVER, alice.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Greet me twice, please.',
  });
  for (const text of ['Good morning', 'Good evening']) {
    // eslint-disable-next-line no-await-in-loop
    const id = await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
      msgtype: 'm.text',
      body: text,
      'com.example.greeting': { text },
      'm.relates_to': { rel_type: 'm.thread', event_id: rootId },
    });
    greetings.push({ id, text });
  }
  roomPath = `/home/${encodeURIComponent(roomId)}`;
  threadPath = `${roomPath}?threadId=${encodeURIComponent(rootId)}`;
});

test.afterAll(() => {
  if (build) rmSync(build, { recursive: true, force: true });
});

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const shot = async (page: Page, name: string) => {
  const directory = process.env.PLUGIN_SHOTS;
  if (directory) await page.screenshot({ path: `${directory}/${name}.png` });
};

const panel = (page: Page) => page.getByRole('region', { name: 'Example panel', exact: true });
/** The panel's toggle, a button in the room header's row on a wide screen. */
const toggle = (page: Page) =>
  roomHeader(page).getByRole('button', { name: 'Example panel', exact: true });

const membersButton = (page: Page, name: 'Show Members' | 'Hide Members') =>
  roomHeader(page).getByRole('button', { name, exact: true });

/** What Settings is called in each language the test picks, and the language itself. */
const SETTINGS_UI = {
  en: {
    account: activeAccountButtonNamePattern,
    settings: 'Settings',
    page: 'Language & region',
    language: 'English',
  },
  de: {
    account: /Kontomenü für /,
    settings: 'Einstellungen',
    page: 'Sprache & Region',
    language: 'Deutsch',
  },
};

/** Picks the language `to` on the Language & region page of Settings, in the language `from`. */
const pickLanguage = async (
  page: Page,
  from: keyof typeof SETTINGS_UI,
  to: keyof typeof SETTINGS_UI
) => {
  const ui = SETTINGS_UI[from];
  await page.getByRole('button', { name: ui.account }).first().click();
  await page.getByRole('menuitem', { name: ui.settings, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: ui.settings });
  await dialog
    .getByRole('navigation', { name: ui.settings })
    .getByRole('button', { name: ui.page, exact: true })
    .click();
  await dialog.getByRole('button', { name: ui.language, exact: true }).click();
  await page.getByRole('menuitemradio', { name: SETTINGS_UI[to].language, exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('lang', to);
};

/** Serves the build in a browser context of its own, signs Alice in there and runs `steps`. */
const asAlice = async (browser: Browser, steps: (page: Page) => Promise<void>) => {
  test.setTimeout(5 * 60_000);
  const server = await serveBuild(build!);
  const context = await browser.newContext({ baseURL: server.origin });
  const page = await context.newPage();
  try {
    await loginWithPassword(page, { homeserver: HOMESERVER, ...alice });
    await steps(page);
  } finally {
    await context.close();
    await server.close();
  }
};

/** The greeting card of the agent's reply `index`, once the plugin renders it. */
const card = async (page: Page, index: number) => {
  const greeting = greetings[index]!;
  const reply = page.locator(`[data-message-id="${greeting.id}"]`);
  await expect(reply.locator('[data-example-plugin]')).toHaveText(
    `Example plugin: ${greeting.text}`,
    { timeout: 60_000 }
  );
  return reply;
};

/** The localStorage keys of the side panels `userId` keeps open, beside the plugins' values. */
const panelKeysOf = (page: Page, userId: string) =>
  page.evaluate(
    (prefix) => Object.keys(localStorage).filter((key) => key.startsWith(prefix)),
    `mindroom.plugin:${encodeURIComponent(userId)}/:side-panel/`
  );

test("a card opens the plugin's panel with its request, which stays open in its room", ({
  browser,
}) =>
  asAlice(browser, async (page) => {
    await page.goto(threadPath);
    const first = await card(page, 0);
    await first.getByRole('button', { name: 'Show in panel' }).click();
    await expect(panel(page)).toContainText('Greeting: Good morning');
    await expect(first.getByRole('button', { name: 'Close panel' })).toBeVisible();
    await shot(page, 'first-request');

    // A second card's request replaces the first in the open panel.
    await (await card(page, 1)).getByRole('button', { name: 'Show in panel' }).click();
    await expect(panel(page)).toContainText('Greeting: Good evening');
    await expect(panel(page)).not.toContainText('Good morning');
    await shot(page, 'second-request');

    // Folded, its toggle is not pressed; choosing it unfolds the panel, which still shows the
    // greeting.
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    // The frame's strip, with Fold, is beside the panel's own region.
    await page.getByRole('button', { name: 'Fold Example panel to the edge', exact: true }).click();
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    await shot(page, 'folded');
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(panel(page)).toContainText('Greeting: Good evening');
    await shot(page, 'unfolded');

    // A reload keeps it open, with its request: the greeting's event ID, not its text.
    await page.reload();
    await expect(panel(page)).toContainText('Greeting: Good evening', { timeout: 60_000 });
    await shot(page, 'after-reload');
    const [remembered] = await panelKeysOf(page, alice.userId);
    expect(await page.evaluate((key) => localStorage.getItem(key), remembered!)).toBe(
      JSON.stringify({ id: 'example/panel', request: greetings[1]!.id })
    );

    // Another room shows without it. Opened there from its toggle, with no request, it takes the
    // page's place, yet back in the first room the first panel opens again, request and all.
    await showRoom(page, ELSEWHERE);
    await expect(panel(page)).toHaveCount(0);
    await toggle(page).click();
    await expect(panel(page)).toBeVisible();
    await expect(panel(page)).not.toContainText('Greeting:');
    // Meanwhile a new message there shows a count in the first room's row.
    await sendRoomMessage(HOMESERVER, bob.accessToken, roomId, {
      msgtype: 'm.text',
      body: 'Still there?',
    });
    await expect(page.getByRole('link', { name: ROOM })).toHaveAccessibleName(`${ROOM} 1`);
    await showRoom(page, ROOM);
    await expect(panel(page)).toContainText('Greeting: Good evening');
    await shot(page, 'back-in-its-room');
    // Closed there, it stays closed after a reload.
    await showRoom(page, ELSEWHERE);
    await page.getByRole('button', { name: 'Close Example panel', exact: true }).click();
    await page.reload();
    await expect(roomMoreOptions(page)).toBeVisible({ timeout: 60_000 });
    await expect(panel(page)).toHaveCount(0);

    // Another account in this browser never sees it; back on the first, it is still open.
    await chooseFromAccountMenu(page, 'Add Account');
    await loginWithPassword(page, { homeserver: HOMESERVER, ...bob, addAccount: true });
    await page.goto(threadPath);
    await card(page, 1);
    await expect(panel(page)).toHaveCount(0);
    await shot(page, 'other-account');
    await switchToStoredUsername(page, alice.username);
    await showRoom(page, ROOM);
    await expect(panel(page)).toContainText('Greeting: Good evening');

    // Signing out deletes it with the account's plugin storage.
    expect(await panelKeysOf(page, alice.userId)).toHaveLength(1);
    const reloaded = page.waitForEvent('load');
    await logoutActiveAccount(page);
    await reloaded;
    expect(await panelKeysOf(page, alice.userId)).toEqual([]);
  }));

test('the panel opens again over the members beside the conversation, which close; on a phone as before', ({
  browser,
}) =>
  asAlice(browser, async (page) => {
    await page.goto(roomPath);
    // A new browser shows the members beside the conversation; opened, the panel takes their place.
    await expect(membersButton(page, 'Hide Members')).toBeVisible({ timeout: 60_000 });
    await toggle(page).click();
    await expect(panel(page)).toBeVisible();
    await expect(membersButton(page, 'Show Members')).toBeVisible();

    // Back in its room after the members opened in another, it opens again and they close.
    await showRoom(page, ELSEWHERE);
    await expect(panel(page)).toHaveCount(0);
    await membersButton(page, 'Show Members').click();
    await expect(membersButton(page, 'Hide Members')).toBeVisible();
    await shot(page, 'members-elsewhere');
    await showRoom(page, ROOM);
    await expect(panel(page)).toBeVisible();
    await expect(membersButton(page, 'Show Members')).toBeVisible();
    await shot(page, 'over-members');

    // The members take its place again from their button, as before.
    await membersButton(page, 'Show Members').click();
    await expect(panel(page)).toHaveCount(0);
    await expect(membersButton(page, 'Hide Members')).toBeVisible();
    await shot(page, 'members-again');

    // On a phone it opens again over the members as before, and leaves their setting as it was.
    await toggle(page).click();
    await expect(panel(page)).toBeVisible();
    await showRoom(page, ELSEWHERE);
    await membersButton(page, 'Show Members').click();
    await expect(membersButton(page, 'Hide Members')).toBeVisible();
    await page.setViewportSize(PHONE);
    await page.goto(roomPath);
    await expect(panel(page)).toBeVisible({ timeout: 60_000 });
    await shot(page, 'phone');
    await page.getByRole('button', { name: 'Close Example panel', exact: true }).click();
    await page.setViewportSize(WIDE);
    await expect(membersButton(page, 'Hide Members')).toBeVisible();
  }));

test("the panel's name follows the language picked in Settings, wide and on a phone, without a reload", ({
  browser,
}) =>
  asAlice(browser, async (page) => {
    await page.goto(roomPath);
    await expect(toggle(page)).toBeVisible({ timeout: 60_000 });
    await page.evaluate(() => {
      (window as { panelSpecLoad?: boolean }).panelSpecLoad = true;
    });

    await pickLanguage(page, 'en', 'de');
    await roomHeader(page).getByRole('button', { name: 'Beispielbereich', exact: true }).click();
    const german = page.getByRole('region', { name: 'Beispielbereich', exact: true });
    await expect(german).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Beispielbereich schließen', exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Beispielbereich an den Rand einklappen', exact: true })
    ).toBeVisible();
    await shot(page, 'german-wide');

    // On a phone it covers the conversation under its name, and its toggle is in the room menu.
    await page.setViewportSize(PHONE);
    await expect(german).toBeVisible();
    await shot(page, 'german-phone');
    await page.getByRole('button', { name: 'Beispielbereich schließen', exact: true }).click();
    await roomHeader(page).getByRole('button', { name: 'Weitere Optionen', exact: true }).click();
    await expect(
      page.getByRole('menuitemcheckbox', { name: 'Beispielbereich', exact: true })
    ).toBeVisible();
    await shot(page, 'german-phone-menu');
    await page.keyboard.press('Escape');

    // Back in English, it is English again.
    await page.setViewportSize(WIDE);
    await pickLanguage(page, 'de', 'en');
    await toggle(page).click();
    await expect(panel(page)).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Close Example panel', exact: true })
    ).toBeVisible();
    await shot(page, 'english-wide');
    expect(await page.evaluate(() => (window as { panelSpecLoad?: boolean }).panelSpecLoad)).toBe(
      true
    );
  }));
