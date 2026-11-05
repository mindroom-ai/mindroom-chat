import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type BrowserContextOptions, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { joinRoom, loginToMatrix, sendRoomMessage, type MatrixSession } from '../helpers/matrix';
import { createRoom } from '../helpers/createRoom';
import { launchWebKit } from '../helpers/webkit';

// On a phone, Inbox > Notifications heads each room's group with the room's avatar, its name and,
// while the room has unread notifications, a Mark as Read chip. The chip keeps its label whole on
// one line and the room name gives way, truncated. Checked at 390 by 844 with touch, in dark and
// light, in English and the three languages whose label is widest, in Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit (the iPhone engine), in WebKit.
// Set INBOX_PHONE_SHOTS=<directory> to also save each page.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'inbox-phone-mark-read-spec-password';
const RUN = Date.now().toString(36);
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
const SHOTS = process.env.INBOX_PHONE_SHOTS;

const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
const LONG_NAME = 'Quarterly planning notes for the research and operations team';
const SHORT_NAME = 'Harbor Plans';
// English and the three languages whose label is widest: Russian, Turkish and German (184, 170
// and 169 px in Chromium, against English's 118).
const LOCALES = ['en', 'ru', 'tr', 'de'];
/** Width the room name keeps beside the widest chip: it truncates, but stays readable. */
const MIN_NAME_PX = 96;

test.use({
  ...PHONE,
  launchOptions: {
    // The other launch options repeat playwright.config.ts.
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});

const homeserverIsUp = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${HOMESERVER}/_matrix/client/versions`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
};

const registerAndLogin = async (name: string): Promise<MatrixSession & { username: string }> => {
  const username = `ipm_${name}_${RUN}`;
  const response = await fetch(`${HOMESERVER}/_matrix/client/v3/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password: PASSWORD,
      auth: { type: 'm.login.dummy' },
      inhibit_login: true,
    }),
  });
  expect(response.ok, `registering ${username}`).toBe(true);
  return { ...(await loginToMatrix(HOMESERVER, username, PASSWORD)), username };
};

/** The chip's label in a language, from the app's catalog. */
const chipLabel = (code: string): string => {
  const catalog = JSON.parse(
    readFileSync(path.join(process.cwd(), 'src/app/i18n/locales', `${code}.json`), 'utf8')
  ) as { mindroomUi: { notifications: { mindroomMarkRoomReadChip: { markAsRead: string } } } };
  return catalog.mindroomUi.notifications.mindroomMarkRoomReadChip.markAsRead;
};

/**
 * Two rooms whose messages notify the reader, one with a name too long for a phone's row. Each
 * engine's test has its own two accounts.
 */
const seed = async (engine: string) => {
  const reader = await registerAndLogin(`reader_${engine}`);
  const writer = await registerAndLogin(`writer_${engine}`);
  for (const name of [LONG_NAME, SHORT_NAME]) {
    // eslint-disable-next-line no-await-in-loop
    const roomId = await createRoom(HOMESERVER, reader.accessToken, {
      name,
      invite: [writer.userId],
    });
    // eslint-disable-next-line no-await-in-loop
    await joinRoom(HOMESERVER, writer.accessToken, roomId);
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(HOMESERVER, writer.accessToken, roomId, {
      msgtype: 'm.text',
      body: `${reader.userId} the berth schedule for Friday is ready`,
      'm.mentions': { user_ids: [reader.userId] },
    });
  }
  return reader;
};

type Row = {
  name: string;
  nameWidth: number;
  nameTruncated: boolean;
  chipStart: number;
  chipEnd: number;
  labelLines: number;
  labelClipped: boolean;
};

/** Each group header with a chip labelled `label`: the room name's box and the chip's. */
const measureRows = (page: Page, label: string) =>
  page.evaluate(
    ({ text, names }) => {
      const chips = [...document.querySelectorAll('button')].filter(
        (button) => button.textContent?.trim() === text
      );
      return chips.map((chip): Row => {
        const row = chip.parentElement;
        const name = [...(row?.children ?? [])].find((child) =>
          names.includes(child.textContent?.trim() ?? '')
        );
        const labelElement = chip.lastElementChild ?? chip;
        const range = document.createRange();
        range.selectNodeContents(labelElement);
        const lines = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)));
        const chipBox = chip.getBoundingClientRect();
        return {
          name: name?.textContent?.trim() ?? '',
          nameWidth: name?.getBoundingClientRect().width ?? 0,
          nameTruncated: !!name && name.scrollWidth > name.clientWidth,
          chipStart: chipBox.left,
          chipEnd: chipBox.right,
          labelLines: lines.size,
          labelClipped: labelElement.scrollWidth > labelElement.clientWidth + 1,
        };
      });
    },
    { text: label, names: [LONG_NAME, SHORT_NAME] }
  );

/** Every widest-label language and color scheme on the Notifications page of a signed-in page. */
const checkInbox = async (page: Page, engine: string) => {
  const report: string[] = [];
  for (const code of LOCALES) {
    const label = chipLabel(code);
    // eslint-disable-next-line no-await-in-loop
    await page.evaluate((language) => localStorage.setItem('i18nextLng', language), code);
    // eslint-disable-next-line no-await-in-loop
    await page.goto('/inbox/notifications/');
    // eslint-disable-next-line no-await-in-loop
    await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(2, {
      timeout: 60_000,
    });
    for (const scheme of ['dark', 'light'] as const) {
      // eslint-disable-next-line no-await-in-loop
      await page.emulateMedia({ colorScheme: scheme });
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(200);
      // eslint-disable-next-line no-await-in-loop
      const rows = await measureRows(page, label);
      // eslint-disable-next-line no-await-in-loop
      const width = await page.evaluate(() => window.innerWidth);
      for (const row of rows) {
        report.push(
          `${engine} ${code} ${scheme} ${row.name.slice(0, 12)}: name ${row.nameWidth.toFixed(
            1
          )} px${row.nameTruncated ? ' truncated' : ''}, chip ${(
            row.chipEnd - row.chipStart
          ).toFixed(1)} px ending at ${row.chipEnd.toFixed(1)}, ${row.labelLines} line(s)${
            row.labelClipped ? ', clipped' : ''
          }`
        );
        const where = `${engine}, ${code}, ${scheme}, ${row.name}`;
        expect.soft(row.labelLines, `the chip label fits one line (${where})`).toBe(1);
        expect.soft(row.labelClipped, `the chip label shows whole (${where})`).toBe(false);
        expect
          .soft(row.chipStart, `the chip starts on screen (${where})`)
          .toBeGreaterThanOrEqual(0);
        expect.soft(row.chipEnd, `the chip ends on screen (${where})`).toBeLessThanOrEqual(width);
        expect
          .soft(row.nameWidth, `the room name keeps room to read (${where})`)
          .toBeGreaterThanOrEqual(MIN_NAME_PX);
      }
      if (SHOTS) {
        // eslint-disable-next-line no-await-in-loop
        await page.screenshot({ path: `${SHOTS}/inbox-${engine}-${code}-${scheme}.png` });
      }
    }
  }
  console.log(report.join('\n'));
};

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('a phone keeps each room group’s Mark as Read chip on one line (Chromium)', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const reader = await seed('chromium');
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: reader.username,
    password: PASSWORD,
  });
  await checkInbox(page, 'chromium');
});

test('a phone keeps each room group’s Mark as Read chip on one line (WebKit)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(300_000);
  const reader = await seed('webkit');
  // The runner adds the file's launch options, whose Chromium flag WebKit refuses.
  const browser = await launchWebKit();
  try {
    const context = await browser.newContext({ ...PHONE, baseURL });
    const page = await context.newPage();
    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: reader.username,
      password: PASSWORD,
    });
    await checkInbox(page, 'webkit');
  } finally {
    await browser.close();
  }
});
