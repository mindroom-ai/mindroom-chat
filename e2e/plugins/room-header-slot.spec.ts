import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  type DisposableUser,
} from '../helpers/disposableAccounts';
import { createRoom } from '../helpers/createRoom';
import { dropFile } from '../helpers/fileDrop';
import { sendRoomMessage } from '../helpers/matrix';
import { roomHeader } from '../helpers/roomMenu';
import { serveBuild } from '../helpers/staticBuildServer';

// A production build with the example client plugin (src/app/plugins/__fixtures__/example-plugin),
// whose room header slot shows "Example banner in <room name>", and a plugin whose slot component
// throws, served as a deployment serves it, against the disposable homeserver. The banner shows
// under the room header, across the conversation column and above the conversation, on the header's
// own frosted surface in light and dark; the broken component shows nothing and the room keeps
// working; `?plugins=off` and `plugins.example.enabled: false` leave the banner out. The example's
// panel item, dragged onto the room's name, shows in the banner through the header element its slot
// gets, while a file dropped there still goes to the composer. A thread shown beside the messages
// leaves the banner above them; while the thread's column fills the page, made full or by a narrow
// window, the banner shows once, under the column's copy of the room header, whose element it gets,
// and a file dropped on that header goes to the thread's composer.
// Set PLUGIN_SHOTS=<directory> to save screenshots.
const PLUGIN = resolve('src/app/plugins/__fixtures__/example-plugin');
const PASSWORD = 'room-header-slot-password';
const RUN = Date.now().toString(36);
const ROOM_NAME = 'Slot room';
const BANNER = `Example banner in ${ROOM_NAME}`;
const SEEDED = 'The first message of the slot room';
const DROPPED_FILE = 'header-drop.txt';

test.use({ viewport: { width: 1280, height: 800 } });
test.describe.configure({ mode: 'serial' });

type Seed = { person: DisposableUser; roomId: string };

let build: string | undefined;
let broken: string | undefined;
let shippedConfig: Record<string, unknown> = {};
let seeded: Seed | undefined;

test.beforeAll(async () => {
  if (!(await disposableHomeserverIsUp())) return;
  test.setTimeout(10 * 60_000);
  build = mkdtempSync(join(tmpdir(), 'mindroom-slot-build-'));
  broken = mkdtempSync(join(tmpdir(), 'mindroom-slot-broken-'));
  writeFileSync(
    join(broken, 'package.json'),
    JSON.stringify({
      name: 'broken-slot-plugin',
      version: '1.0.0',
      mindroomClientPlugin: { id: 'broken', apiVersion: 1, entry: './index.js' },
    })
  );
  writeFileSync(
    join(broken, 'index.js'),
    "export default { roomHeaderSlot: [() => { throw new Error('broken slot'); }] };\n"
  );
  const result = spawnSync('npx', ['vite', 'build', '--outDir', build, '--emptyOutDir'], {
    env: { ...process.env, MINDROOM_CLIENT_PLUGINS: `${PLUGIN},${broken}` },
    encoding: 'utf8',
    timeout: 9 * 60_000,
  });
  if (result.status !== 0) {
    throw new Error(
      `the build with the plugins failed:\n${(result.stderr || result.stdout).slice(-3000)}`
    );
  }
  shippedConfig = JSON.parse(readFileSync(join(build, 'config.json'), 'utf8'));

  const person = await registerDisposableUser(`slot_person_${RUN}`, PASSWORD);
  const roomId = await createRoom(HOMESERVER, person.accessToken, { name: ROOM_NAME });
  await sendRoomMessage(HOMESERVER, person.accessToken, roomId, {
    msgtype: 'm.text',
    body: SEEDED,
  });
  seeded = { person, roomId };
});

test.afterAll(() => {
  for (const dir of [build, broken]) if (dir) rmSync(dir, { recursive: true, force: true });
});

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

/**
 * Serves the build, with `plugins` as config.json's plugin sections, on a new origin, signs in in a
 * page of a new browser context there, and runs `check` with the console errors the page logs.
 */
const onBuild = async (
  browser: Browser,
  plugins: Record<string, unknown>,
  check: (page: Page, data: Seed, errors: string[]) => Promise<void>
) => {
  writeFileSync(join(build!, 'config.json'), JSON.stringify({ ...shippedConfig, plugins }));
  const server = await serveBuild(build!);
  const context = await browser.newContext({ baseURL: server.origin });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  try {
    await loginWithPassword(page, { homeserver: HOMESERVER, ...seeded!.person });
    await check(page, seeded!, errors);
  } finally {
    await context.close();
    await server.close();
  }
};

const roomPath = ({ roomId }: Seed, query = '') => `/home/${encodeURIComponent(roomId)}${query}`;

const shot = async (page: Page, name: string) => {
  const directory = process.env.PLUGIN_SHOTS;
  if (directory) await page.screenshot({ path: `${directory}/${name}.png` });
};

const banner = (page: Page) => page.locator('[data-example-plugin-banner]');

/** Waits for the open room: its header and its first message. */
const roomShown = async (page: Page) => {
  await expect(roomHeader(page)).toContainText(ROOM_NAME, { timeout: 60_000 });
  await expect(page.getByText(SEEDED)).toBeVisible({ timeout: 60_000 });
};

/**
 * Where the room timeline's content starts when scrolled to the top: below the inset its scroll
 * area keeps clear of what floats over it.
 */
const conversationTop = (page: Page) =>
  page.evaluate(() => {
    const content = document.querySelector('[data-testid="room-virtual-inner"]')?.parentElement;
    const scroller = content?.parentElement;
    if (!content || !scroller) throw new Error('Room timeline missing');
    return scroller.getBoundingClientRect().top + parseFloat(getComputedStyle(content).paddingTop);
  });

const box = async (locator: Locator) => {
  const found = await locator.boundingBox();
  expect(found).not.toBeNull();
  return found!;
};

test("shows the plugin's banner under the room header, across the conversation, above it", ({
  browser,
}) =>
  onBuild(browser, {}, async (page, data) => {
    await page.goto(roomPath(data));
    await roomShown(page);
    await expect(banner(page)).toHaveText(BANNER);
    const header = await box(roomHeader(page));
    const shown = await box(banner(page));
    expect(shown.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
    expect(shown.x).toBeCloseTo(header.x, 0);
    expect(shown.width).toBeCloseTo(header.width, 0);
    await expect
      .poll(() => conversationTop(page))
      .toBeGreaterThanOrEqual(shown.y + shown.height - 1);
    await shot(page, 'room-header-slot');
  }));

/** The background, backdrop filter and text colour of the header's element, row and slot box. */
const surfaces = (page: Page) =>
  banner(page).evaluate((shown) => {
    const slot = shown.parentElement!;
    const header = slot.parentElement!;
    const paint = (element: Element) => {
      const style = getComputedStyle(element);
      return {
        background: style.backgroundColor,
        filter: style.backdropFilter,
        color: style.color,
      };
    };
    return {
      header: paint(header),
      row: paint(header.querySelector(':scope > header')!),
      slot: paint(slot),
    };
  });

test("the banner shows the header's own frosted surface and text colour, as the row does, in light and dark", ({
  browser,
}) =>
  onBuild(browser, {}, async (page, data) => {
    await page.goto(roomPath(data));
    await roomShown(page);
    await expect(banner(page)).toHaveText(BANNER);
    const clear = { background: 'rgba(0, 0, 0, 0)', filter: 'none' };
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${colorScheme}-theme\\b`));
      const { header, row, slot } = await surfaces(page);
      // One translucent, blurred surface behind the row and the slot together, in one text colour.
      expect(header.background).toMatch(/\/ 0?\.\d+\)$/);
      expect(header.filter).toContain('blur(');
      expect(row).toEqual({ ...clear, color: header.color });
      expect(slot).toEqual({ ...clear, color: header.color });
      await shot(page, `room-header-slot-surface-${colorScheme}`);
    }
  }));

test('a slot component that throws shows nothing, is reported, and leaves the room working', ({
  browser,
}) =>
  onBuild(browser, {}, async (page, data, errors) => {
    await page.goto(roomPath(data));
    await roomShown(page);
    await expect(banner(page)).toHaveText(BANNER);
    await expect
      .poll(() => errors.some((text) => text.includes('[plugin broken@1.0.0]')))
      .toBe(true);
    const sent = `Sent past the broken plugin ${RUN}`;
    const composer = page.getByRole('textbox', { name: 'Send a message...' });
    await composer.click();
    await page.keyboard.type(sent);
    await page.keyboard.press('Enter');
    await expect(page.getByText(sent)).toBeVisible({ timeout: 60_000 });
    await shot(page, 'room-header-slot-broken');
  }));

test('?plugins=off leaves the banner out', ({ browser }) =>
  onBuild(browser, {}, async (page, data, errors) => {
    await page.goto(roomPath(data, '?plugins=off'));
    await roomShown(page);
    await expect(banner(page)).toHaveCount(0);
    expect(errors.filter((text) => text.includes('[plugin '))).toEqual([]);
    await shot(page, 'room-header-slot-plugins-off');
  }));

test('plugins.example.enabled: false leaves the banner out', ({ browser }) =>
  onBuild(browser, { example: { enabled: false } }, async (page, data) => {
    await page.goto(roomPath(data));
    await roomShown(page);
    await expect(banner(page)).toHaveCount(0);
    await shot(page, 'room-header-slot-disabled');
  }));

test("the example panel's item dropped on the room's name shows in the banner; a file dropped there goes to the composer", ({
  browser,
}) =>
  onBuild(browser, {}, async (page, data) => {
    await page.goto(roomPath(data));
    await roomShown(page);
    await roomHeader(page).getByRole('button', { name: 'Example panel', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Example panel', exact: true });
    const item = panel.getByText('Example item', { exact: true });
    const name = roomHeader(page).locator('h1');
    const dropped = banner(page).locator('[data-example-plugin-dropped]');
    const footer = page.locator('[data-room-footer]');

    // Only the header takes it: dropped on the conversation, it lands nowhere.
    await item.dragTo(page.getByText(SEEDED));
    await expect(dropped).toHaveCount(0);
    await item.dragTo(name);
    await expect(dropped).toHaveText('Dropped: Example item');
    await expect(footer).not.toContainText('Example item');
    await shot(page, 'room-header-slot-item-dropped');

    await dropFile(name, DROPPED_FILE);
    await expect(footer.getByText(DROPPED_FILE)).toBeVisible();
    await expect(dropped).toHaveText('Dropped: Example item');
    await shot(page, 'room-header-slot-file-dropped');
  }));

test("a thread's column filling the page has the banner under its own header, once, and gives it back beside the messages", ({
  browser,
}) =>
  onBuild(browser, {}, async (page, data) => {
    const { accessToken } = data.person;
    const rootId = await sendRoomMessage(HOMESERVER, accessToken, data.roomId, {
      msgtype: 'm.text',
      body: `The slot thread ${RUN}`,
    });
    await sendRoomMessage(HOMESERVER, accessToken, data.roomId, {
      msgtype: 'm.text',
      body: `A reply in the slot thread ${RUN}`,
      'm.relates_to': { rel_type: 'm.thread', event_id: rootId, is_falling_back: true },
    });
    // Wide enough for the thread beside the messages and the members beside both.
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(roomPath(data, `?threadId=${encodeURIComponent(rootId)}`));
    const column = page.getByTestId('thread-column');
    const inColumn = column.locator('[data-example-plugin-banner]');
    const threadBanner = page.locator('[data-thread-context-banner]');
    await expect(threadBanner).toBeVisible({ timeout: 60_000 });
    await threadBanner.getByRole('button', { name: 'Thread options', exact: true }).click();
    await page
      .getByRole('menuitem', { name: 'Show the thread beside the messages', exact: true })
      .click();
    await expect(column).toBeVisible();

    // Beside the messages, the banner stays above them, once.
    const besideMessages = async () => {
      await expect(column).not.toHaveAttribute('data-filled', 'true');
      await expect(banner(page)).toHaveCount(1);
      await expect(banner(page)).toBeVisible();
      await expect(inColumn).toHaveCount(0);
    };
    // Filling the page, the column's header has it, and the hidden room area none.
    const fillingPage = async () => {
      await expect(column).toHaveAttribute('data-filled', 'true');
      await expect(banner(page)).toHaveCount(1);
      await expect(inColumn).toBeVisible();
      await expect(inColumn).toContainText(BANNER);
    };
    await besideMessages();
    await shot(page, 'room-header-slot-thread-beside');

    await column.getByRole('button', { name: 'Show the thread in full', exact: true }).click();
    await fillingPage();
    await shot(page, 'room-header-slot-thread-full');
    // It gets the column's header: the example panel's item dropped on the name there shows in it.
    await roomHeader(page).getByRole('button', { name: 'Example panel', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Example panel', exact: true });
    await panel.getByText('Example item', { exact: true }).dragTo(column.locator('h1'));
    await expect(inColumn.locator('[data-example-plugin-dropped]')).toHaveText(
      'Dropped: Example item'
    );
    await roomHeader(page).getByRole('button', { name: 'Example panel', exact: true }).click();
    await expect(panel).toHaveCount(0);
    // A file dropped on that header goes to the thread's composer, not the room's under it.
    await dropFile(column.locator('h1'), DROPPED_FILE);
    await expect(column.getByText(DROPPED_FILE)).toBeVisible();
    await expect(page.locator('[data-room-footer]').getByText(DROPPED_FILE)).toHaveCount(0);
    await shot(page, 'room-header-slot-thread-full-file-dropped');

    await column
      .getByRole('button', { name: 'Show the thread beside the messages', exact: true })
      .click();
    await besideMessages();

    // A window too narrow for both fills the page with the column too, until it widens.
    await page.setViewportSize({ width: 1000, height: 900 });
    await fillingPage();
    await shot(page, 'room-header-slot-thread-narrow');
    await page.setViewportSize({ width: 1600, height: 900 });
    await besideMessages();
    await shot(page, 'room-header-slot-thread-beside-again');
  }));
