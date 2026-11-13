import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  joinRoom,
  loginToMatrix,
  matrixFetch,
  registerAgentAccount,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// Text reads as each language writes it, on a real homeserver: a mention keeps its "@" in front
// inside right-to-left text, an agent's model badge keeps the start of the model name in
// Arabic, German shows its own 24-hour clock, and Bengali writes every number on screen in the
// digits the browser's Intl gives it (Bengali digits in Chromium; WebKit's data says Latin ones,
// so there the times are Latin too and so must be the rest). Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit,
// WebKit; a desktop and a phone. LOCALE_TEXT_SHOTS names a directory for screenshots.
const PASSWORD = 'locale-text-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.LOCALE_TEXT_SHOTS;
const MODEL = 'Stub Fast Reasoning';
const DESK = 'Planning desk';
const ANY_DIGIT = /[0-9০-৯]/;

test.use({
  launchOptions: {
    // The other launch options repeat playwright.config.ts.
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});
test.describe.configure({ timeout: 240_000 });

const registerAndLogin = async (name: string): Promise<MatrixSession & { username: string }> => {
  const username = `lt_${name}_${RUN}`;
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

const aiRun = {
  version: 1,
  status: 'completed',
  run_id: 'locale-text-run',
  model: { config: 'stub', display_name: MODEL, id: 'stub-fast', provider: 'openai' },
};

/**
 * A room with an agent and one thread: the reader's question, then the agent's Arabic answer that
 * mentions the reader, with its model. A second room holds three messages the reader has not read.
 */
const seed = async (tag: string) => {
  const reader = await registerAndLogin(`reader_${tag}`);
  const agent = await registerAgentAccount(HOMESERVER, `helper_${tag}`);
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(agent.userId)}/displayname`, {
    method: 'PUT',
    accessToken: agent.accessToken,
    body: JSON.stringify({ displayname: 'Helper' }),
  });
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: 'Launch room',
    invite: [agent.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  const rootId = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Can you plan the launch and tell me when it is ready?',
  });
  const link = `<a href="https://matrix.to/#/${reader.userId}">${reader.userId}</a>`;
  await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
    msgtype: 'm.text',
    body: `مرحبا ${reader.userId}، الخطة جاهزة: نبدأ بالاختبار ثم النشر.`,
    format: 'org.matrix.custom.html',
    formatted_body: `<p>مرحبا ${link}، الخطة جاهزة: نبدأ بالاختبار ثم النشر.</p>`,
    'io.mindroom.stream_status': 'completed',
    'io.mindroom.ai_run': aiRun,
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: rootId },
    },
  });

  const deskId = await createRoom(HOMESERVER, reader.accessToken, {
    name: DESK,
    invite: [agent.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, deskId);
  for (const body of ['Morning numbers are in.', 'The build is green.', 'Review is due today.']) {
    await sendRoomMessage(HOMESERVER, agent.accessToken, deskId, { msgtype: 'm.text', body });
  }
  return { reader, roomId, rootId };
};

/** Whether a line's first character shows inside its box, and the direction the line reads in. */
const placement = (line: Locator) =>
  line.evaluate((element) => {
    const text = element.firstChild;
    if (text?.nodeType !== Node.TEXT_NODE || !text.textContent) throw new Error('No text');
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 1);
    const first = range.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    return {
      direction: getComputedStyle(element).direction,
      firstCharInside: first.left >= box.left - 1 && first.right <= box.right + 1,
    };
  });

/** Whether a mention's characters run left to right, its "@" leftmost. */
const atSignFirst = (mention: Locator) =>
  mention.evaluate((element) => {
    const text = element.firstChild;
    if (text?.nodeType !== Node.TEXT_NODE || !text.textContent) throw new Error('No text');
    const range = document.createRange();
    const left = (offset: number) => {
      range.setStart(text, offset);
      range.setEnd(text, offset + 1);
      return range.getBoundingClientRect().left;
    };
    return text.textContent.startsWith('@') && left(0) < left(1) && left(1) < left(2);
  });

const shoot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
};

const switchLanguage = async (page: Page, code: string, path: string) => {
  await page.evaluate((language) => localStorage.setItem('i18nextLng', language), code);
  await page.goto(path);
  await expect(page.locator('html')).toHaveAttribute('lang', code);
};

const check = async (browser: Browser, engine: string, phone: boolean, baseURL?: string) => {
  const device = phone ? 'phone' : 'desktop';
  const world = await seed(`${engine.slice(0, 2)}_${device.slice(0, 1)}`);
  const context = await browser.newContext({
    ...(phone
      ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }
      : { viewport: { width: 1440, height: 900 } }),
    baseURL,
  });
  await context.route('**/v1/local-mindroom/connections', (route) =>
    route.fulfill({ json: { connections: [] } })
  );
  const page = await context.newPage();
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: world.reader.username,
    password: PASSWORD,
  });
  const room = `/home/${encodeURIComponent(world.roomId)}`;
  const thread = `${room}?threadId=${encodeURIComponent(world.rootId)}`;
  const mention = page.locator(`a[data-mention-id="${world.reader.userId}"]`).first();
  const badge = page.getByText(MODEL, { exact: true }).first();
  const times = page.locator('time');
  const bengaliDigits = await page.evaluate(() =>
    new Intl.NumberFormat('bn', { useGrouping: false }).format(1234567890)
  );
  /** The digits in `text` that are not the ones Intl writes Bengali in. */
  const otherDigits = (text: string) =>
    [...text].filter((char) => ANY_DIGIT.test(char) && !bengaliDigits.includes(char)).join('');

  for (const language of phone ? ['en', 'ar'] : ['en', 'ar', 'de', 'bn']) {
    await switchLanguage(page, language, thread);
    await expect(mention).toBeVisible({ timeout: 30_000 });
    await expect(badge).toBeVisible();
    await expect(times.first()).toBeVisible();
    // The Arabic answer reads right to left; the Matrix ID inside it reads left to right.
    expect.soft(await atSignFirst(mention), `${language}: the mention reads @ first`).toBe(true);
    const timeTexts = await times.allInnerTexts();
    if (language === 'en') {
      expect
        .soft(
          timeTexts.every((text) => / (AM|PM)$/.test(text)),
          timeTexts.join()
        )
        .toBe(true);
    }
    if (language === 'ar') {
      expect.soft(await placement(badge), 'the model name keeps its start').toEqual({
        direction: 'ltr',
        firstCharInside: true,
      });
    }
    if (language === 'de') {
      // German tells the time on a 24-hour clock with no day period.
      expect
        .soft(
          timeTexts.every((text) => /^\d{2}:\d{2}$/.test(text)),
          timeTexts.join()
        )
        .toBe(true);
    }
    if (language === 'bn') {
      const members = page.getByRole('heading', { level: 2, name: /সদস্য/ });
      const desk = page.getByRole('link', { name: new RegExp(DESK) });
      await expect(members).toBeVisible();
      // The room's unread count, in whichever digits.
      await expect(desk).toContainText(ANY_DIGIT);
      const screen = {
        times: timeTexts.join(' '),
        members: await members.innerText(),
        desk: (await desk.innerText()).replace(DESK, ''),
      };
      Object.entries(screen).forEach(([where, text]) => {
        expect.soft(text, `${where} has a number`).toMatch(ANY_DIGIT);
        expect.soft(otherDigits(text), `${where} in the digits of ${bengaliDigits}`).toBe('');
      });
    }
    await shoot(page, `${language}-thread-${engine}-${device}`);
  }

  if (!phone) {
    // Bengali: the filter bar's thread count beside the cards' ages and reply counts.
    await page.goto(room);
    const count = page.locator('[data-thread-count]');
    await expect(count).toBeVisible({ timeout: 30_000 });
    expect.soft(otherDigits(await count.innerText()), 'the thread count').toBe('');
    await shoot(page, `bn-room-${engine}-${device}`);
  }
  await context.close();
};

for (const phone of [false, true]) {
  const device = phone ? 'phone' : 'desktop';
  test(`text reads as each language writes it, Chromium ${device}`, async ({
    browser,
    baseURL,
  }) => {
    test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
    await check(browser, 'chromium', phone, baseURL);
  });

  test(`text reads as each language writes it, WebKit ${device}`, async ({ baseURL }) => {
    test.skip(!WEBKIT_EXECUTABLE, 'PLAYWRIGHT_WEBKIT_EXECUTABLE not set');
    test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
    const browser = await launchWebKit();
    try {
      await check(browser, 'webkit', phone, baseURL);
    } finally {
      await browser.close();
    }
  });
}
