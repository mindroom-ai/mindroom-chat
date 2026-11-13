import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from '@playwright/test';
import { chooseFromAccountMenu, loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  joinRoom,
  loginToMatrix,
  matrixFetch,
  sendRoomMessage,
  setAccountData,
  type MatrixSession,
} from '../helpers/matrix';
import { holdFirstWrites } from '../helpers/holdWrites';
import { launchWebKit } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// Settings that follow the account: browser contexts signed in to one account on the disposable
// homeserver of `just hs-up` (or a slot of scripts/e2e-slot.sh) share the 8 roaming settings
// through the `io.mindroom.client.settings` account data, live and without a reload, while
// device settings such as the theme stay where they were changed. Nothing about the account data
// is mocked. Classic scrollbars, as desktop browsers show them; the launch options repeat
// playwright.config.ts.
test.use({
  launchOptions: {
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
  viewport: { width: 1280, height: 800 },
});

const PASSWORD = 'settings-roaming-spec-password';
const RUN = Date.now().toString(36);
const EVENT_TYPE = 'io.mindroom.client.settings';

type Account = MatrixSession & { username: string };

const register = async (name: string): Promise<Account> => {
  const username = `roam_${name}_${RUN}`;
  await matrixFetch(HOMESERVER, '/register', {
    method: 'POST',
    body: JSON.stringify({
      username,
      password: PASSWORD,
      auth: { type: 'm.login.dummy' },
      inhibit_login: true,
    }),
  });
  return { ...(await loginToMatrix(HOMESERVER, username, PASSWORD)), username };
};

const TOPICS = [
  'Quarterly planning',
  'Design reviews',
  'Customer support',
  'Release notes',
  'Hiring',
  'Infrastructure',
  'Marketing site',
  'Travel',
  'Book club',
  'Random',
  'Announcements',
];

/**
 * An account as people have one: a dozen rooms, and a conversation with a colleague long enough
 * to scroll. Answers the conversation's room ID.
 */
const seedAccount = async (account: Account, name: string): Promise<string> => {
  const colleague = await register(`${name}_colleague`);
  for (const topic of TOPICS) {
    // eslint-disable-next-line no-await-in-loop
    await createRoom(HOMESERVER, account.accessToken, { name: topic });
  }
  const roomId = await createRoom(HOMESERVER, account.accessToken, {
    name: 'Launch checklist',
    invite: [colleague.userId],
  });
  await joinRoom(HOMESERVER, colleague.accessToken, roomId);
  for (let index = 1; index <= 40; index += 1) {
    const sender = index % 3 === 0 ? account : colleague;
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(HOMESERVER, sender.accessToken, roomId, {
      msgtype: 'm.text',
      body: `Launch item ${index}: copy, screenshots and the pricing page are on track.`,
    });
  }
  return roomId;
};

/**
 * The account's roaming settings content, straight from the homeserver, without the revision
 * each write stores (`rev`, `base_rev`); undefined while unset.
 */
const accountContent = async (account: Account): Promise<Record<string, unknown> | undefined> => {
  try {
    const content = await matrixFetch<Record<string, unknown>>(
      HOMESERVER,
      `/user/${encodeURIComponent(account.userId)}/account_data/${EVENT_TYPE}`,
      { accessToken: account.accessToken }
    );
    const { rev, base_rev: baseRev, ...settings } = content;
    return settings;
  } catch {
    return undefined;
  }
};

/**
 * A browser of its own (a device) signed in to `account`; `deviceSettings` go into its `settings`
 * entry before the sign-in, as an earlier version of the app left them.
 */
const openDevice = async (
  browser: Browser,
  account: Account,
  deviceSettings?: Record<string, unknown>,
  options?: BrowserContextOptions
) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...options });
  const page = await context.newPage();
  if (deviceSettings) {
    await page.goto('/');
    await page.evaluate((settings) => {
      localStorage.setItem('settings', JSON.stringify(settings));
    }, deviceSettings);
  }
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: account.username,
    password: PASSWORD,
    // The device keeps only the settings each test gives it, so the account holds what they say.
    showToolCalls: false,
  });
  return { context, page };
};

const openRoom = async (page: Page, roomId: string) => {
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
  await expect(page.getByTestId('room-virtual-inner')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Launch item 40:', { exact: false })).toBeVisible({
    timeout: 30_000,
  });
};

/** The newest message's time; its title holds the whole date and time in the chosen formats. */
const newestTime = (page: Page) => page.getByTestId('room-virtual-inner').locator('time').last();

const TWELVE_HOUR = /^\d{1,2} \w{3} \d{4} \d{1,2}:\d{2}:\d{2} [AP]M$/;
const TWENTY_FOUR_HOUR = /^\d{1,2} \w{3} \d{4} \d{2}:\d{2}:\d{2}$/;
const ISO_DATE_24_HOUR = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

const openSettingsPage = async (page: Page, name: string) => {
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  if (!(await dialog.isVisible())) await chooseFromAccountMenu(page, 'Settings');
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole('navigation', { name: 'Settings' })
    .getByRole('button', { name, exact: true })
    .click();
  return dialog;
};

const closeSettings = async (page: Page) => {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Settings' })).toHaveCount(0);
};

const tile = (dialog: Locator, id: string) => dialog.locator(`[data-setting-id="${id}"]`);
const toggle = (dialog: Locator, id: string) => tile(dialog, id).getByRole('switch');

const storedDeviceSettings = (page: Page) =>
  page.evaluate(
    () => JSON.parse(localStorage.getItem('settings') ?? '{}') as Record<string, unknown>
  );

test.beforeEach(async () => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
});

test('the clock and Markdown follow the account to the other devices; the theme stays', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const account = await register('live');
  const roomId = await seedAccount(account, 'live');
  // Content written by a later build, and the sidebar switches of `io.mindroom.settings`, which
  // other MindRoom clients write too: the roaming settings must leave both alone.
  await setAccountData(HOMESERVER, account.accessToken, account.userId, EVENT_TYPE, {
    version: 1,
    laterKey: 'kept',
  });
  const sidebarSettings = { showThreadsInSidebar: false, otherClientKey: 'kept' };
  await setAccountData(
    HOMESERVER,
    account.accessToken,
    account.userId,
    'io.mindroom.settings',
    sidebarSettings
  );

  const laptop = await openDevice(browser, account);
  const phone = await openDevice(browser, account);
  try {
    await openRoom(phone.page, roomId);
    await expect(newestTime(phone.page)).toHaveAttribute('title', TWELVE_HOUR);

    // The laptop turns on the 24-hour clock; the tile says it applies to the whole account.
    let laptopDialog = await openSettingsPage(laptop.page, 'Language & region');
    await expect(tile(laptopDialog, 'hour24Clock')).toContainText('Your account (all devices)');
    await expect(toggle(laptopDialog, 'hour24Clock')).not.toBeChecked();
    await toggle(laptopDialog, 'hour24Clock').click();
    await expect(toggle(laptopDialog, 'hour24Clock')).toBeChecked();

    // The phone's open timeline switches to it without a reload.
    await expect(newestTime(phone.page)).toHaveAttribute('title', TWENTY_FOUR_HOUR, {
      timeout: 30_000,
    });

    // The laptop turns Markdown off; the phone's switch follows.
    laptopDialog = await openSettingsPage(laptop.page, 'Chats');
    await expect(tile(laptopDialog, 'markdown')).toContainText('Your account (all devices)');
    await toggle(laptopDialog, 'markdown').click();
    await expect(toggle(laptopDialog, 'markdown')).not.toBeChecked();
    await expect
      .poll(() => accountContent(account), { timeout: 30_000 })
      .toEqual({ version: 1, laterKey: 'kept', hour24Clock: true, isMarkdown: false });
    const phoneDialog = await openSettingsPage(phone.page, 'Chats');
    await expect(toggle(phoneDialog, 'markdown')).not.toBeChecked();
    await openSettingsPage(phone.page, 'Language & region');
    await expect(toggle(phoneDialog, 'hour24Clock')).toBeChecked();

    // The theme belongs to the device: the laptop stops following the system theme, the phone
    // keeps following it, and the account data never holds it.
    laptopDialog = await openSettingsPage(laptop.page, 'Appearance');
    await expect(tile(laptopDialog, 'systemTheme')).toContainText('This device');
    await toggle(laptopDialog, 'systemTheme').click();
    await expect(toggle(laptopDialog, 'systemTheme')).not.toBeChecked();
    await expect
      .poll(async () => (await storedDeviceSettings(laptop.page)).useSystemTheme)
      .toBe(false);
    await openSettingsPage(phone.page, 'Appearance');
    await expect(toggle(phoneDialog, 'systemTheme')).toBeChecked();
    expect(await accountContent(account)).toEqual({
      version: 1,
      laterKey: 'kept',
      hour24Clock: true,
      isMarkdown: false,
    });
    expect(
      await matrixFetch(
        HOMESERVER,
        `/user/${encodeURIComponent(account.userId)}/account_data/io.mindroom.settings`,
        { accessToken: account.accessToken }
      )
    ).toEqual(sidebarSettings);
    await closeSettings(phone.page);
    await closeSettings(laptop.page);

    // A third device signing in for the first time starts from the account's values, and from
    // its own theme.
    const desktop = await openDevice(browser, account);
    try {
      await openRoom(desktop.page, roomId);
      await expect(newestTime(desktop.page)).toHaveAttribute('title', TWENTY_FOUR_HOUR);
      const desktopDialog = await openSettingsPage(desktop.page, 'Chats');
      await expect(toggle(desktopDialog, 'markdown')).not.toBeChecked();
      await openSettingsPage(desktop.page, 'Language & region');
      await expect(toggle(desktopDialog, 'hour24Clock')).toBeChecked();
      await openSettingsPage(desktop.page, 'Appearance');
      await expect(toggle(desktopDialog, 'systemTheme')).toBeChecked();
    } finally {
      await desktop.context.close();
    }
  } finally {
    await laptop.context.close();
    await phone.context.close();
  }
});

test("a device's own earlier choices fill what the account lacks; the account wins elsewhere", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const account = await register('migrate');
  const roomId = await seedAccount(account, 'migrate');

  // The laptop kept its choices on the device before they roamed, and a zoom of its own.
  const laptop = await openDevice(browser, account, {
    hour24Clock: true,
    hideActivity: true,
    dateFormatString: 'YYYY-MM-DD',
    pageZoom: 90,
  });
  try {
    await expect
      .poll(() => accountContent(account), { timeout: 30_000 })
      .toEqual({
        version: 1,
        hour24Clock: true,
        hideActivity: true,
        dateFormatString: 'YYYY-MM-DD',
      });
  } finally {
    await laptop.context.close();
  }

  // The phone had picked another date format: the account's wins there, and the phone's own
  // entry keeps its old choice.
  const phone = await openDevice(browser, account, { dateFormatString: 'DD/MM/YYYY' });
  try {
    await openRoom(phone.page, roomId);
    await expect(newestTime(phone.page)).toHaveAttribute('title', ISO_DATE_24_HOUR);
    const dialog = await openSettingsPage(phone.page, 'Privacy & security');
    await expect(tile(dialog, 'hideActivity')).toContainText('Your account (all devices)');
    await expect(toggle(dialog, 'hideActivity')).toBeChecked();
    await openSettingsPage(phone.page, 'Language & region');
    await expect(toggle(dialog, 'hour24Clock')).toBeChecked();
    expect(await accountContent(account)).toEqual({
      version: 1,
      hour24Clock: true,
      hideActivity: true,
      dateFormatString: 'YYYY-MM-DD',
    });
    expect((await storedDeviceSettings(phone.page)).dateFormatString).toBe('DD/MM/YYYY');
  } finally {
    await phone.context.close();
  }
});

test('an edit made offline shows at once and reaches the other device on reconnect', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const account = await register('offline');
  await seedAccount(account, 'offline');
  const laptop = await openDevice(browser, account);
  const phone = await openDevice(browser, account);
  try {
    const phoneDialog = await openSettingsPage(phone.page, 'Chats');
    await expect(toggle(phoneDialog, 'hideMembershipEvents')).not.toBeChecked();

    await laptop.context.setOffline(true);
    const laptopDialog = await openSettingsPage(laptop.page, 'Chats');
    await toggle(laptopDialog, 'hideMembershipEvents').click();
    await expect(toggle(laptopDialog, 'hideMembershipEvents')).toBeChecked();
    // Nothing reaches the homeserver while the laptop is offline; the edit waits on the device.
    await laptop.page.waitForTimeout(3_000);
    expect((await accountContent(account))?.hideMembershipEvents).toBeUndefined();
    await expect(toggle(phoneDialog, 'hideMembershipEvents')).not.toBeChecked();
    await expect(toggle(laptopDialog, 'hideMembershipEvents')).toBeChecked();

    await laptop.context.setOffline(false);
    await expect(toggle(phoneDialog, 'hideMembershipEvents')).toBeChecked({ timeout: 60_000 });
    expect((await accountContent(account))?.hideMembershipEvents).toBe(true);
    await expect
      .poll(() =>
        laptop.page.evaluate(() =>
          Object.keys(localStorage).filter((key) => key.startsWith('roamingSettingsPending:'))
        )
      )
      .toEqual([]);
  } finally {
    await laptop.context.close();
    await phone.context.close();
  }
});

/**
 * Two devices of one account change different settings at the same moment: both writes read the
 * account data before either lands (the writes are held until both are sent). Both changes stay,
 * on the homeserver and on both devices.
 */
const changeTogether = async (
  browser: Browser,
  engine: string,
  options?: BrowserContextOptions
) => {
  const account = await register(`together_${engine}`);
  await seedAccount(account, `together_${engine}`);
  const laptop = await openDevice(browser, account, undefined, options);
  const phone = await openDevice(browser, account, undefined, options);
  try {
    const laptopDialog = await openSettingsPage(laptop.page, 'Chats');
    const phoneDialog = await openSettingsPage(phone.page, 'Chats');
    await expect(toggle(laptopDialog, 'markdown')).toBeChecked();
    await expect(toggle(phoneDialog, 'enterForNewline')).not.toBeChecked();
    const writes = await holdFirstWrites([laptop.page, phone.page], `/account_data/${EVENT_TYPE}`);
    await Promise.all([
      toggle(laptopDialog, 'markdown').click(),
      toggle(phoneDialog, 'enterForNewline').click(),
    ]);
    await writes.release();
    const both = { version: 1, isMarkdown: false, enterForNewline: true };
    await expect.poll(() => accountContent(account), { timeout: 30_000 }).toEqual(both);
    for (const dialog of [laptopDialog, phoneDialog]) {
      // eslint-disable-next-line no-await-in-loop
      await expect(toggle(dialog, 'markdown')).not.toBeChecked();
      // eslint-disable-next-line no-await-in-loop
      await expect(toggle(dialog, 'enterForNewline')).toBeChecked();
    }
    // And they stay.
    await laptop.page.waitForTimeout(2_000);
    expect(await accountContent(account)).toEqual(both);
    await expect(toggle(laptopDialog, 'markdown')).not.toBeChecked();
    await expect(toggle(phoneDialog, 'enterForNewline')).toBeChecked();
  } finally {
    await laptop.context.close();
    await phone.context.close();
  }
};

test('two devices that change different settings at the same moment keep both (Chromium)', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  await changeTogether(browser, 'chromium');
});

test('two devices that change different settings at the same moment keep both (WebKit)', async ({
  baseURL,
}) => {
  test.skip(!process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE');
  test.setTimeout(240_000);
  const browser = await launchWebKit();
  try {
    // Playwright's WebKit does not route what the app's service worker fetches.
    await changeTogether(browser, 'webkit', { baseURL, serviceWorkers: 'block' });
  } finally {
    await browser.close();
  }
});
