import { expect, test, type Browser, type Page } from '@playwright/test';
import { loginWithPassword, waitForLoggedInShell } from '../helpers/auth';
import { buildLoginPath } from '../env';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import { createPrivateRoom } from '../helpers/matrix';
import { pressPaletteShortcut } from '../helpers/paletteShortcut';

// The interface tour in the real app against the disposable homeserver: a new account is offered
// it on a card, the Quick tour goes through its six steps and on into the Full tour, Done hands
// over to the room's composer, the answer is kept for the account, and the command palette opens
// the tour at any time.
const PASSWORD = 'tour-spec-account-password';

/**
 * Waits until the account's settings on the server say the offer was answered. The card shows
 * only after a start has synced, later than the shell a spec waits for, so "no card" after a
 * reload proves nothing without this.
 */
const expectAnswerStored = (account: { userId: string; accessToken: string }) =>
  expect
    .poll(async () => {
      const response = await fetch(
        `${HOMESERVER}/_matrix/client/v3/user/${encodeURIComponent(
          account.userId
        )}/account_data/io.mindroom.settings`,
        { headers: { Authorization: `Bearer ${account.accessToken}` } }
      );
      return response.ok
        ? ((await response.json()) as { tourOffered?: boolean }).tourOffered
        : null;
    })
    .toBe(true);

const newAccount = async (roomName: string) => {
  const username = `tour_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const user = await registerDisposableUser(username, PASSWORD);
  const roomId = await createPrivateRoom(HOMESERVER, user.accessToken, { name: roomName });
  return { ...user, roomId };
};

/** A signed-in page whose served config.json leaves the tour's offer on, as a deployment does. */
const signIn = async (browser: Browser, username: string): Promise<Page> => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/config.json', async (route) => {
    const response = await route.fetch();
    const config = (await response.json()) as Record<string, unknown>;
    await route.fulfill({ response, json: { ...config, tour: { offerAtStart: true } } });
  });
  const page = await context.newPage();
  await page.goto(buildLoginPath(HOMESERVER));
  await expect(page.locator('input[name="serverInput"]')).toBeVisible({ timeout: 90_000 });
  await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
  return page;
};

const offer = (page: Page) => page.locator('[data-tour-offer]');
const dialog = (page: Page) => page.locator('[data-tour-dialog]');
const action = (page: Page, name: string) => page.locator(`[data-tour-action="${name}"]`);
const stepOf = (page: Page) => dialog(page).getAttribute('data-tour-step');

test.beforeEach(async () => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
  test.setTimeout(240_000);
});

test('a new account is offered the tour, takes it, and is not asked again', async ({ browser }) => {
  const account = await newAccount('Tour Room');
  const page = await signIn(browser, account.username);

  // The card, with both levels on it.
  await expect(offer(page)).toBeVisible({ timeout: 60_000 });
  await expect(offer(page)).toContainText('Take a tour of MindRoom');
  await expect(page.locator('[data-tour-offer-action="full"]')).toHaveText('Full tour (5 min)');

  // The room is open behind the tour, so Done has a composer to hand over to.
  await page.getByRole('link', { name: 'Tour Room' }).first().click();
  const composer = page.locator('[data-room-footer="true"] [data-editable-name="RoomInput"]');
  await expect(composer).toBeVisible({ timeout: 60_000 });

  await page.locator('[data-tour-offer-action="quick"]').click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page)).toHaveAttribute('data-tour-level', 'quick');
  await expect(offer(page)).toHaveCount(0);
  await expect(dialog(page)).toContainText('Step 1 of 6');
  await expect(action(page, 'next')).toBeFocused();

  // Six steps, Enter going on; the last offers the rest.
  const quick = ['conversation', 'start', 'reply', 'title', 'order', 'states'];
  for (const [index, step] of quick.entries()) {
    expect(await stepOf(page)).toBe(step);
    if (index < quick.length - 1) await page.keyboard.press('Enter');
  }
  await expect(dialog(page)).toContainText('Step 6 of 6');
  await expect(action(page, 'done')).toBeFocused();
  await action(page, 'keepGoing').click();
  await expect(dialog(page)).toHaveAttribute('data-tour-level', 'full');
  await expect(dialog(page)).toContainText('Step 7 of 12');
  expect(await stepOf(page)).toBe('resolve');

  // On to the end with the arrow key, back one, and Done.
  for (let at = 7; at < 12; at += 1) await page.keyboard.press('ArrowRight');
  expect(await stepOf(page)).toBe('activity');
  await page.keyboard.press('ArrowRight');
  expect(await stepOf(page)).toBe('activity');
  await page.keyboard.press('ArrowLeft');
  expect(await stepOf(page)).toBe('views');
  await page.keyboard.press('ArrowRight');
  await action(page, 'done').click();
  await expect(dialog(page)).toHaveCount(0);
  // Typing now starts a thread in the room.
  await expect(composer).toBeFocused();

  // The answer went to the account: another start does not ask again.
  await expectAnswerStored(account);
  await page.reload();
  await waitForLoggedInShell(page);
  await expect(composer).toBeVisible({ timeout: 60_000 });
  await expect(offer(page)).toHaveCount(0);
  await page.context().close();
});

test('the card is dismissed for good, and the command palette still opens the tour', async ({
  browser,
}) => {
  const account = await newAccount('Palette Room');
  const page = await signIn(browser, account.username);
  await expect(offer(page)).toBeVisible({ timeout: 60_000 });
  await page.locator('[data-tour-offer-action="dismiss"]').click();
  await expect(offer(page)).toHaveCount(0);
  await expectAnswerStored(account);

  await pressPaletteShortcut(page);
  const palette = page.getByRole('dialog').filter({ has: page.getByRole('combobox') });
  await palette.getByRole('combobox').fill('tour');
  await palette.getByRole('option', { name: /Take the full tour/ }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page)).toHaveAttribute('data-tour-level', 'full');
  await expect(dialog(page)).toContainText('Step 1 of 12');

  // The stage shows and cannot be operated: Tab goes round the dialog's own controls only.
  const stage = page.locator('[data-tour-stage]');
  await expect(stage.locator('[data-thread-root-id]').first()).toBeVisible();
  for (let presses = 0; presses < 6; presses += 1) {
    await page.keyboard.press('Tab');
    expect(
      await page.evaluate(() => document.activeElement?.closest('[data-tour-stage]') === null)
    ).toBe(true);
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(
      true
    );
  }

  // The palette opens over the tour, as over the app's other dialogs: a tour chosen there
  // starts over at its first step.
  await action(page, 'next').click();
  await expect(dialog(page)).toContainText('Step 2 of 12');
  await pressPaletteShortcut(page);
  await palette.getByRole('combobox').fill('tour');
  await palette.getByRole('option', { name: /Take the quick tour/ }).click();
  await expect(dialog(page)).toHaveAttribute('data-tour-level', 'quick');
  await expect(dialog(page)).toContainText('Step 1 of 6');

  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  await page.reload();
  await waitForLoggedInShell(page);
  await expect(page.getByRole('link', { name: 'Palette Room' }).first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(offer(page)).toHaveCount(0);
  await page.context().close();
});
