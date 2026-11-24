import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { matrixFetch, sendRoomMessage } from '../helpers/matrix';
import { openMessageMenu } from '../helpers/messageMenu';
import { setRoomCompact } from '../helpers/roomViewSwitch';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// Cross-room thread fork: "Fork to room…" from the thread menu or from a middle message opens a
// searchable room picker. Picking a target room navigates there under
// `?forkRoom=<source>&forkThread=<root>&forkAt=<point>` (with `threadId` unset), showing the
// source thread up to the fork point, the "Forking <title> into <target>" divider, and the target
// room's composer. Sending the first message creates a top-level message in the target room with
// `io.mindroom.fork: { room_id, thread_id, event_id }`, renders the prefix + "Forked from <title>
// in <source>" divider + new message, labels the Compact thread card, and clicking the divider
// navigates back to the source thread. Needs the slot homeserver:
//   scripts/e2e-slot.sh <slot> --preview npx playwright test e2e/threads/cross-room-thread-fork.spec.ts

const PASSWORD = 'cross-room-fork-spec-password';
const TIMEOUT = 60_000;
const SHOTS = process.env.CROSS_ROOM_FORK_SHOTS;

const ALPHA_NAME = 'Project Alpha';
const BETA_NAME = 'Project Beta';

const ROOT = 'Evaluate database migration strategy';
const FIRST = 'Dual-write avoids downtime during schema cutover.';
const SECOND = 'We should benchmark read latency on staging before deciding.';
const THIRD = 'Also check if rollback snapshots fit within our storage quota.';
const BRANCH = 'Following up on staging benchmarks in Project Beta.';

test.use({ viewport: { width: 1280, height: 800 } });

const replyTo = (rootId: string, body: string) => ({
  msgtype: 'm.text',
  body,
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: rootId },
  },
});

const column = (page: Page) => page.getByTestId('thread-column');
const rowsOf = (page: Page) => column(page).locator('[data-message-item]');
const rowWith = (page: Page, text: string) => rowsOf(page).filter({ hasText: text });
const rowById = (page: Page, eventId: string) =>
  column(page).locator(`[data-message-item][data-message-id="${eventId}"]`);
const composer = (page: Page) => column(page).locator('[data-editable-name="RoomInput"]');
const placeholder = (page: Page) => composer(page).locator('[data-slate-placeholder="true"]');
const params = (page: Page) => new URL(page.url()).searchParams;

const top = async (locator: Locator) => (await locator.boundingBox())!.y;

const snap = async (page: Page, filename: string) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, filename) });
};

test(
  'Fork to room… forks a thread from Project Alpha into Project Beta with draft, divider, and Compact card',
  { tag: '@webkit' },
  async ({ page }) => {
    test.skip(
      !(await disposableHomeserverIsUp()),
      `No homeserver at ${HOMESERVER}; run \`just hs-up\``
    );
    test.setTimeout(240_000);

    const user = await registerDisposableUser(
      `cross_room_fork_${Date.now().toString(36)}_${test.info().project.name}`,
      PASSWORD
    );
    const alphaRoomId = await createRoom(HOMESERVER, user.accessToken, { name: ALPHA_NAME });
    const betaRoomId = await createRoom(HOMESERVER, user.accessToken, { name: BETA_NAME });

    const rootId = await sendRoomMessage(HOMESERVER, user.accessToken, alphaRoomId, {
      msgtype: 'm.text',
      body: ROOT,
    });
    const firstId = await sendRoomMessage(
      HOMESERVER,
      user.accessToken,
      alphaRoomId,
      replyTo(rootId, FIRST)
    );
    const secondId = await sendRoomMessage(
      HOMESERVER,
      user.accessToken,
      alphaRoomId,
      replyTo(rootId, SECOND)
    );
    const thirdId = await sendRoomMessage(
      HOMESERVER,
      user.accessToken,
      alphaRoomId,
      replyTo(rootId, THIRD)
    );

    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: user.username,
      password: PASSWORD,
    });

    const alphaPath = `/home/${encodeURIComponent(alphaRoomId)}/`;
    const betaPath = `/home/${encodeURIComponent(betaRoomId)}/`;
    await page.goto(`${alphaPath}?threadId=${encodeURIComponent(rootId)}`);
    await expect(rowById(page, thirdId)).toBeVisible({ timeout: TIMEOUT });

    // 1. ThreadActionsMenu offers "Fork to room…" beside "Fork thread" and opens the picker.
    await column(page)
      .locator('[data-thread-context-banner]')
      .getByRole('button', { name: 'Thread options', exact: true })
      .click();
    const forkToRoomAction = page.locator('[data-thread-action="forkToRoom"]');
    await expect(forkToRoomAction).toBeVisible({ timeout: TIMEOUT });
    await forkToRoomAction.click();
    const picker = page.getByRole('dialog', { name: 'Fork to room', exact: true });
    await expect(picker).toBeVisible({ timeout: TIMEOUT });
    await expect(picker.locator(`[data-fork-room-id="${betaRoomId}"]`)).toBeVisible({
      timeout: TIMEOUT,
    });
    await expect(picker.locator(`[data-fork-room-id="${alphaRoomId}"]`)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(picker).toHaveCount(0);

    // 2. "Fork to room…" from a middle message opens the picker over Project Alpha.
    await openMessageMenu(page, rowById(page, secondId), 'benchmark', false);
    await page.getByRole('menuitem', { name: 'Fork to room…', exact: true }).click();
    await expect(picker).toBeVisible({ timeout: TIMEOUT });
    const betaOption = picker.locator(`[data-fork-room-id="${betaRoomId}"]`);
    await expect(betaOption).toBeVisible({ timeout: TIMEOUT });
    await snap(page, '01-picker.png');

    // Search for Project Beta and pick it with Enter.
    const search = picker.locator('[data-fork-room-search]');
    await search.fill('Beta');
    await expect(picker.getByRole('option')).toHaveCount(1);
    await search.press('Enter');

    // 3. Cross-room draft opens in Project Beta under ?forkRoom=&forkThread=&forkAt= (no threadId).
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: TIMEOUT })
      .toContain(encodeURIComponent(betaRoomId));
    await expect.poll(() => params(page).get('forkRoom'), { timeout: TIMEOUT }).toBe(alphaRoomId);
    expect(params(page).get('forkThread')).toBe(rootId);
    expect(params(page).get('forkAt')).toBe(secondId);
    expect(params(page).get('threadId')).toBeNull();

    // Draft shows Project Alpha's messages up to secondId, draft banner, Forking divider, and composer.
    await expect(column(page).locator('[data-cross-room-fork-banner]')).toContainText(
      `Forking from ${ALPHA_NAME}`,
      { timeout: TIMEOUT }
    );
    const forkingDivider = column(page).getByText(`Forking ${ROOT} into ${BETA_NAME}`, {
      exact: true,
    });
    await expect(forkingDivider).toBeVisible({ timeout: TIMEOUT });
    await expect(placeholder(page)).toHaveText('Continue in a new thread', { timeout: TIMEOUT });
    await expect(rowById(page, rootId)).toBeVisible();
    await expect(rowById(page, firstId)).toBeVisible();
    await expect(rowById(page, secondId)).toBeVisible();
    await expect(rowWith(page, THIRD)).toHaveCount(0);
    expect(await top(forkingDivider)).toBeGreaterThan(await top(rowById(page, secondId)));
    await snap(page, '02-draft.png');

    // 4. Send the first message: creates the sent cross-room fork in Project Beta.
    await composer(page).click();
    await page.keyboard.type(BRANCH);
    await page.keyboard.press('Enter');

    await expect
      .poll(
        () => {
          const threadId = params(page).get('threadId');
          return threadId?.startsWith('$') && threadId !== rootId ? threadId : undefined;
        },
        { timeout: TIMEOUT }
      )
      .toBeDefined();
    const forkId = params(page).get('threadId')!;
    expect(params(page).get('forkRoom')).toBeNull();
    expect(params(page).get('forkThread')).toBeNull();
    expect(params(page).get('forkAt')).toBeNull();

    // Verify server event in Project Beta carries top-level io.mindroom.fork with room_id.
    const forkRoot = await matrixFetch<{ content: Record<string, unknown> }>(
      HOMESERVER,
      `/rooms/${encodeURIComponent(betaRoomId)}/event/${encodeURIComponent(forkId)}`,
      { accessToken: user.accessToken }
    );
    expect(forkRoot.content.body).toBe(BRANCH);
    expect(forkRoot.content['m.relates_to']).toBeUndefined();
    expect(forkRoot.content['io.mindroom.fork']).toEqual({
      room_id: alphaRoomId,
      thread_id: rootId,
      event_id: secondId,
    });

    // 5. Sent fork in Project Beta renders Alpha's prefix, cross-room divider, and its own message.
    const forkedFrom = column(page).getByRole('button', {
      name: `Forked from ${ROOT} in ${ALPHA_NAME}`,
      exact: true,
    });
    await expect(forkedFrom).toBeVisible({ timeout: TIMEOUT });
    await expect(rowById(page, forkId)).toBeVisible({ timeout: TIMEOUT });
    await expect(rowById(page, forkId)).toContainText(BRANCH);
    await expect(rowById(page, rootId)).toBeVisible();
    await expect(rowById(page, firstId)).toBeVisible();
    await expect(rowById(page, secondId)).toBeVisible();
    await expect(rowWith(page, THIRD)).toHaveCount(0);
    const dividerTop = await top(forkedFrom);
    expect(dividerTop).toBeGreaterThan(await top(rowById(page, secondId)));
    expect(dividerTop).toBeLessThan(await top(rowById(page, forkId)));
    await snap(page, '03-sent-fork.png');

    // 6. Compact view in Project Beta shows the forked thread card with its cross-room badge/tooltip.
    await page.goto(betaPath);
    await setRoomCompact(page, true);
    const forkCard = page.locator(`[data-thread-root-id="${forkId}"]`);
    await expect(forkCard).toBeVisible({ timeout: TIMEOUT });
    const forkBadge = forkCard.locator('[data-compact-card-fork-badge]');
    await expect(forkBadge).toBeVisible({ timeout: TIMEOUT });
    await expect(forkBadge).toHaveAttribute('title', `Forked from ${ROOT} in ${ALPHA_NAME}`);
    await snap(page, '04-compact-card.png');

    // 7. Clicking the cross-room divider navigates back to Project Alpha at the fork point.
    await forkCard.click();
    await expect(forkedFrom).toBeVisible({ timeout: TIMEOUT });
    await forkedFrom.click();
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: TIMEOUT })
      .toContain(encodeURIComponent(alphaRoomId));
    await expect.poll(() => params(page).get('threadId'), { timeout: TIMEOUT }).toBe(rootId);
    await expect(rowById(page, thirdId)).toBeVisible({ timeout: TIMEOUT });
    // Cross-room forks do not pollute Project Alpha's room-local fork chips.
    await expect(column(page).locator('[data-thread-forks-chip]')).toHaveCount(0);
  }
);
