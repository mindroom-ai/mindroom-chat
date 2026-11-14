import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { joinRoom, matrixFetch } from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  CHROMIUM_WITH_SCROLLBARS,
} from '../helpers/disposableAccounts';

// A mention suggestion shows the member's whole name on a phone; their Matrix ID beside it gives
// way first. Runs in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in
// WebKit, against the disposable homeserver of `just hs-up` or of a slot of scripts/e2e-slot.sh.
const PASSWORD = 'mention-names-spec-password';
const RUN = Date.now().toString(36);
const PHONE = { width: 390, height: 844 };
const SHOTS = process.env.MENTION_NAMES_SHOTS;

test.use({
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
});

const register = async (localpart: string, displayName: string) => {
  const username = `${localpart}_${RUN}`;
  const session = await registerDisposableUser(username, PASSWORD);
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(session.userId)}/displayname`, {
    method: 'PUT',
    accessToken: session.accessToken,
    body: JSON.stringify({ displayname: displayName }),
  });
  return session;
};

const wholeNameShows = async (page: Page, browserName: string) => {
  const reader = await register(`mna_reader_${browserName}`, 'Robin Reader');
  // A long Matrix ID, as bridged and agent accounts have.
  const member = await register(
    `mna_harbor_operations_night_shift_${browserName}`,
    'Wren Harbormaster'
  );
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: `Harbor desk ${browserName} ${RUN}`,
    invite: [member.userId],
  });
  await joinRoom(HOMESERVER, member.accessToken, roomId);

  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: reader.username,
    password: PASSWORD,
  });
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
  const composer = page.locator('[data-editable-name="RoomInput"]');
  await expect(composer).toBeVisible({ timeout: 60_000 });
  await composer.click();
  await page.keyboard.type('@Wren');

  const suggestion = page.getByRole('option', { name: /Wren Harbormaster/ });
  await expect(suggestion).toBeVisible({ timeout: 20_000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/mention-${browserName}.png` });
  const name = await suggestion.evaluate((button) => {
    const label = Array.from(button.querySelectorAll<HTMLElement>('*')).find(
      (element) => element.childElementCount === 0 && element.textContent === 'Wren Harbormaster'
    );
    if (!label) throw new Error('No name in the suggestion');
    return { scrollWidth: label.scrollWidth, clientWidth: label.clientWidth };
  });
  expect(name.scrollWidth, 'the whole name shows').toBeLessThanOrEqual(name.clientWidth);
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const TITLE = 'a mention suggestion shows the whole name beside a long Matrix ID on a phone';

test(`${TITLE} (Chromium)`, async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({ viewport: PHONE, hasTouch: true, baseURL });
  try {
    await wholeNameShows(await context.newPage(), 'c');
  } finally {
    await context.close();
  }
});

test(`${TITLE} (WebKit)`, async ({ baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(180_000);
  const browser = await launchWebKit();
  try {
    const context = await browser.newContext({ viewport: PHONE, hasTouch: true, baseURL });
    await wholeNameShows(await context.newPage(), 'w');
  } finally {
    await browser.close();
  }
});
