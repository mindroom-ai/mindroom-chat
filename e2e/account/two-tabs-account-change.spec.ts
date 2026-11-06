import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { chooseFromAccountMenu, loginWithPassword } from '../helpers/auth';
import { logoutActiveAccount } from '../helpers/accounts';
import { createRoom } from '../helpers/createRoom';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  type DisposableUser,
} from '../helpers/disposableAccounts';
import { recordStartFailures } from '../helpers/startFailures';
import { onWebKitPage, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// Two tabs of one browser with two accounts (L5-F027). Switching the account in one tab makes
// the other tab follow; logging the active account out in one tab moves both to the remaining
// account. Neither tab may show "Failed to start account" or the failed screen on the way, not
// even for a moment (the shell helpers would press Retry and hide it). Chromium runs at a quarter
// of the CPU, as a slow laptop does, which widens the windows in which the tabs start the same
// account at once. Runs in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's
// WebKit, in WebKit, against the disposable homeserver.
const PASSWORD = 'two-tabs-account-change-password';
const RUN = Date.now().toString(36);
const ROUNDS = 3;

test.use({ viewport: { width: 1024, height: 768 }, launchOptions: CHROMIUM_WITH_SCROLLBARS });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const accountButton = (page: Page, user: DisposableUser) =>
  page.getByRole('button', { name: new RegExp(`^Open account menu for .*${user.username}`) });

/** Waits until `page` shows `user`'s signed-in shell with its room in the list. */
const expectShellOf = async (page: Page, user: DisposableUser, roomName: string) => {
  await expect(accountButton(page, user)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(roomName, { exact: true }).first()).toBeVisible({
    timeout: 60_000,
  });
};

const switchTo = async (page: Page, user: DisposableUser) => {
  await chooseFromAccountMenu(page, new RegExp(`Switch to account .*${user.username}`));
};

const bothTabsFollow = async (context: BrowserContext, browserName: string) => {
  const failures = await recordStartFailures(context);
  const pageErrors: string[] = [];
  context.on('page', (page) => {
    page.on('pageerror', (error) => pageErrors.push(error.message));
  });
  const first = await registerDisposableUser(`ttac_a_${browserName}_${RUN}`, PASSWORD);
  const second = await registerDisposableUser(`ttac_b_${browserName}_${RUN}`, PASSWORD);
  const firstRoom = `First desk ${browserName} ${RUN}`;
  const secondRoom = `Second desk ${browserName} ${RUN}`;
  await createRoom(HOMESERVER, first.accessToken, { name: firstRoom });
  await createRoom(HOMESERVER, second.accessToken, { name: secondRoom });

  const one = await context.newPage();
  await loginWithPassword(one, { homeserver: HOMESERVER, ...first });
  await expectShellOf(one, first, firstRoom);
  await chooseFromAccountMenu(one, 'Add Account');
  await loginWithPassword(one, { homeserver: HOMESERVER, ...second, addAccount: true });
  await expectShellOf(one, second, secondRoom);

  const two = await context.newPage();
  await two.goto('/home/');
  await expectShellOf(two, second, secondRoom);
  if (browserName === 'chromium') {
    for (const page of [one, two]) {
      // eslint-disable-next-line no-await-in-loop
      const cdp = await context.newCDPSession(page);
      // eslint-disable-next-line no-await-in-loop
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    }
  }

  for (let round = 1; round <= ROUNDS; round += 1) {
    // eslint-disable-next-line no-await-in-loop
    await switchTo(one, first);
    // eslint-disable-next-line no-await-in-loop
    await Promise.all([expectShellOf(one, first, firstRoom), expectShellOf(two, first, firstRoom)]);
    // eslint-disable-next-line no-await-in-loop
    await switchTo(two, second);
    // eslint-disable-next-line no-await-in-loop
    await Promise.all([
      expectShellOf(one, second, secondRoom),
      expectShellOf(two, second, secondRoom),
    ]);
  }

  // The second account signs out in the second tab: both tabs go on with the first one.
  await logoutActiveAccount(two);
  await Promise.all([expectShellOf(one, first, firstRoom), expectShellOf(two, first, firstRoom)]);
  // A failure that shows only after the shell came back would be missed without some time.
  await one.waitForTimeout(5_000);

  expect(failures).toEqual([]);
  // WebKit reports a request cut off by the logout's own reload as "Fetch API cannot load <url>
  // due to access control checks."; that tab is leaving, so it says nothing about a crash.
  expect(pageErrors.filter((message) => !/due to access control checks/.test(message))).toEqual([]);
};

test('a tab follows an account switch or logout in another tab without failing (Chromium)', async ({
  browser,
  browserName,
}) => {
  test.setTimeout(420_000);
  const context = await browser.newContext();
  try {
    await bothTabsFollow(context, browserName);
  } finally {
    await context.close();
  }
});

test('a tab follows an account switch or logout in another tab without failing (WebKit)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(420_000);
  await onWebKitPage({ viewport: { width: 1024, height: 768 }, baseURL }, (page) =>
    bothTabsFollow(page.context(), 'webkit')
  );
});
