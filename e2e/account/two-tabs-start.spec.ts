import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import { onWebKitPage, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// Two tabs of one account, opened one right after the other: both start. A tab that starts while
// the other one is still starting must not land on "Failed to start account". A start never
// creates a database only to delete it again: the other tab may open it in between and then lose
// its connection to the deletion. Chromium runs at a quarter of the CPU, as a slow laptop does,
// which widens the window. Runs in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names
// Playwright's WebKit, in WebKit, against the disposable homeserver.
const PASSWORD = 'two-tabs-start-spec-password';
const RUN = Date.now().toString(36);
const ROUNDS = 5;
const SETTLE_MS = 9_000;

test.use({ viewport: { width: 1024, height: 768 }, launchOptions: CHROMIUM_WITH_SCROLLBARS });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const startFailure = (page: Page) => page.getByText(/Failed to start account/);

/** Records the IndexedDB databases each page load opens and deletes. */
const recordDatabaseUse = (context: BrowserContext) =>
  context.addInitScript(() => {
    const use = { opened: [] as string[], deleted: [] as string[] };
    Object.assign(window, { databaseUse: use });
    const { open, deleteDatabase } = IDBFactory.prototype;
    IDBFactory.prototype.open = function recordOpen(this: IDBFactory, name, version) {
      use.opened.push(name);
      return version === undefined ? open.call(this, name) : open.call(this, name, version);
    };
    IDBFactory.prototype.deleteDatabase = function recordDelete(this: IDBFactory, name) {
      use.deleted.push(name);
      return deleteDatabase.call(this, name);
    };
  });

/** Databases this page load opened and then deleted. */
const createdAndDeleted = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const { opened, deleted } = (
      window as unknown as { databaseUse: { opened: string[]; deleted: string[] } }
    ).databaseUse;
    return Array.from(new Set(deleted.filter((name) => opened.includes(name))));
  });

const bothTabsStart = async (context: BrowserContext, browserName: string) => {
  const user = await registerDisposableUser(`tts_${browserName}_${RUN}`, PASSWORD);
  const room = await createRoom(HOMESERVER, user.accessToken, {
    name: `Shared desk ${browserName} ${RUN}`,
  });
  await recordDatabaseUse(context);
  const first = await context.newPage();
  await loginWithPassword(first, { homeserver: HOMESERVER, ...user });
  const second = await context.newPage();
  if (browserName === 'chromium') {
    for (const page of [first, second]) {
      // eslint-disable-next-line no-await-in-loop
      const cdp = await context.newCDPSession(page);
      // eslint-disable-next-line no-await-in-loop
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    }
  }
  const roomPath = `/home/${encodeURIComponent(room)}`;
  const failures: string[] = [];

  for (let round = 1; round <= ROUNDS; round += 1) {
    // eslint-disable-next-line no-await-in-loop
    await first.goto(roomPath);
    // eslint-disable-next-line no-await-in-loop
    await second.goto(roomPath);
    // eslint-disable-next-line no-await-in-loop
    await second.waitForTimeout(SETTLE_MS);
    for (const [name, page] of [
      ['first', first],
      ['second', second],
    ] as const) {
      // eslint-disable-next-line no-await-in-loop
      if (await startFailure(page).isVisible()) {
        // eslint-disable-next-line no-await-in-loop
        failures.push(`round ${round}, ${name} tab: ${await startFailure(page).innerText()}`);
      }
      // eslint-disable-next-line no-await-in-loop
      const churned = await createdAndDeleted(page);
      if (churned.length > 0) {
        failures.push(`round ${round}, ${name} tab created and deleted ${churned.join(', ')}`);
      }
    }
  }
  expect(failures).toEqual([]);
  for (const page of [first, second]) {
    // eslint-disable-next-line no-await-in-loop
    await expect(page.locator('[data-editable-name="RoomInput"]')).toBeVisible({
      timeout: 30_000,
    });
  }
};

test('two tabs of one account both start (Chromium)', async ({ browser, browserName }) => {
  test.setTimeout(300_000);
  const context = await browser.newContext();
  try {
    await bothTabsStart(context, browserName);
  } finally {
    await context.close();
  }
});

test('two tabs of one account both start (WebKit)', async ({ baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(300_000);
  await onWebKitPage({ viewport: { width: 1024, height: 768 }, baseURL }, (page) =>
    bothTabsStart(page.context(), 'webkit')
  );
});
