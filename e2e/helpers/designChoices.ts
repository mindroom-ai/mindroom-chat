import { mkdirSync } from 'node:fs';
import { expect, type BrowserContextOptions, type Page, type TestInfo } from '@playwright/test';
import { createRoom } from './createRoom';
import { DISPOSABLE_HOMESERVER as HOMESERVER } from './disposableAccounts';
import { matrixFetch, sendRoomMessage } from './matrix';

// Shared setup of the design-choice specs (model badge, phone header, Bubble layout, thread
// mode): accounts on the test homeserver, messages, the look of the page and screenshots.

export const PASSWORD = 'design-choices-spec-password';
export const RUN = Date.now().toString(36);
/** Set DESIGN_CHOICES_SHOTS=<directory> to save every screenshot there too. */
const SHOTS = process.env.DESIGN_CHOICES_SHOTS;

export const DESKTOP: BrowserContextOptions = { viewport: { width: 1440, height: 900 } };
export const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
export const SCHEMES = ['light', 'dark'] as const;
export type Scheme = (typeof SCHEMES)[number];

/** Retries what the server refuses with 429. */
export const withRetry = async <T>(run: () => Promise<T>): Promise<T> => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await run();
    } catch (error) {
      if (attempt > 8 || !String(error).includes('429')) throw error;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => {
        setTimeout(resolve, 500 * (attempt + 1));
      });
    }
  }
};

export type Account = { username: string; userId: string; token: string };

/** A new account with a display name; an agent's username starts with `mindroom_`. */
export const register = async (username: string, name: string): Promise<Account> => {
  const body = await withRetry(() =>
    matrixFetch<{ user_id: string; access_token: string }>(HOMESERVER, '/register', {
      method: 'POST',
      body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
    })
  );
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(body.user_id)}/displayname`, {
    method: 'PUT',
    accessToken: body.access_token,
    body: JSON.stringify({ displayname: name }),
  });
  return { username, userId: body.user_id, token: body.access_token };
};

export const join = (account: Account, roomId: string) =>
  withRetry(() =>
    matrixFetch(HOMESERVER, `/join/${encodeURIComponent(roomId)}`, {
      method: 'POST',
      accessToken: account.token,
      body: '{}',
    })
  );

/** Sends a text message, in the thread of `root` when given, with extra content keys. */
export const say = (
  account: Account,
  roomId: string,
  body: string,
  root?: string,
  extra: Record<string, unknown> = {}
) =>
  withRetry(() =>
    sendRoomMessage(HOMESERVER, account.token, roomId, {
      msgtype: 'm.text',
      body,
      ...extra,
      ...(root
        ? {
            'm.relates_to': {
              rel_type: 'm.thread',
              event_id: root,
              is_falling_back: true,
              'm.in_reply_to': { event_id: root },
            },
          }
        : {}),
    })
  );

/** The 24 other rooms each account sees beside the one under test. */
export const createOtherRooms = (account: Account) =>
  Promise.all(
    Array.from({ length: 24 }, (_, index) =>
      withRetry(() => createRoom(HOMESERVER, account.token, { name: `Project room ${index + 1}` }))
    )
  );

/** The model an agent's reply names, as MindRoom's `io.mindroom.ai_run` carries it. */
export const AI_RUN = {
  'io.mindroom.ai_run': {
    version: 1,
    status: 'completed',
    model: {
      config: 'large',
      display_name: 'Stub Large Model',
      id: 'stub-large',
      provider: 'openai',
    },
  },
};

/** Stored settings for the next page load (the app reads them from localStorage). */
export const seedSettings = (page: Page, settings: Record<string, unknown>) =>
  page.addInitScript((values) => {
    const stored = JSON.parse(localStorage.getItem('settings') ?? '{}') as object;
    localStorage.setItem('settings', JSON.stringify({ ...stored, ...values }));
  }, settings);

/** The color scheme and, through the language, the direction: English or Arabic. */
export const setLook = async (page: Page, scheme: Scheme, direction: 'ltr' | 'rtl' = 'ltr') => {
  await page.emulateMedia({ colorScheme: scheme });
  const want = direction === 'rtl' ? 'ar' : 'en';
  const now = await page.evaluate(() => localStorage.getItem('i18nextLng'));
  if (now !== want) {
    await page.evaluate((code) => localStorage.setItem('i18nextLng', code), want);
    await page.reload();
  }
  await expect(page.locator('html')).toHaveAttribute('dir', direction);
};

/** Attaches a screenshot to the test and, with DESIGN_CHOICES_SHOTS, saves it there too. */
export const shot = async (page: Page, testInfo: TestInfo, name: string) => {
  const body = await page.screenshot();
  await testInfo.attach(name, { body, contentType: 'image/png' });
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/${name}.png` });
  }
};
