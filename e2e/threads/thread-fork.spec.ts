import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { matrixFetch, sendRoomMessage } from '../helpers/matrix';
import { openMessageMenu } from '../helpers/messageMenu';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// Fork from here on a middle message of a thread opens a draft that shows the thread only up to
// that message, under a "Forking <title>" line, with the composer's "Continue in a new thread".
// Its first message is a new top-level message whose `io.mindroom.fork` names the parent and the
// fork point, and the new thread opens: the parent's messages up to the fork point, a "Forked from
// <title>" line, then its own message, never the parent's later reply. Back in the parent, the fork
// point carries "1 fork", whose menu opens the fork. Needs the slot homeserver:
//   scripts/e2e-slot.sh <slot> --preview npx playwright test e2e/threads/thread-fork.spec.ts

const PASSWORD = 'thread-fork-spec-password';
const TIMEOUT = 60_000;

const ROOT = 'Plan the trip to Lisbon';
const FIRST = 'Flights are cheapest on Tuesday mornings.';
const SECOND = 'Book the hotel near the river, it has late check-in.';
const THIRD = 'Actually, let us look at Porto instead.';
const BRANCH = 'branch';

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

test(
  'Fork from here forks a thread at a middle message, and the parent lists the fork',
  { tag: '@webkit' },
  async ({ page }) => {
    test.skip(
      !(await disposableHomeserverIsUp()),
      `No homeserver at ${HOMESERVER}; run \`just hs-up\``
    );
    // A sign-in, a thread load, a send and two thread switches on a loaded machine.
    test.setTimeout(240_000);

    const user = await registerDisposableUser(
      `thread_fork_${Date.now().toString(36)}_${test.info().project.name}`,
      PASSWORD
    );
    const roomId = await createRoom(HOMESERVER, user.accessToken, { name: 'Trip planning' });
    const rootId = await sendRoomMessage(HOMESERVER, user.accessToken, roomId, {
      msgtype: 'm.text',
      body: ROOT,
    });
    const firstId = await sendRoomMessage(
      HOMESERVER,
      user.accessToken,
      roomId,
      replyTo(rootId, FIRST)
    );
    const secondId = await sendRoomMessage(
      HOMESERVER,
      user.accessToken,
      roomId,
      replyTo(rootId, SECOND)
    );
    const thirdId = await sendRoomMessage(
      HOMESERVER,
      user.accessToken,
      roomId,
      replyTo(rootId, THIRD)
    );

    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: user.username,
      password: PASSWORD,
    });
    const roomPath = `/home/${encodeURIComponent(roomId)}/`;
    await page.goto(`${roomPath}?threadId=${encodeURIComponent(rootId)}`);
    await expect(rowById(page, thirdId)).toBeVisible({ timeout: TIMEOUT });

    // Fork from here on the second reply opens the draft at it.
    await openMessageMenu(page, rowById(page, secondId), 'hotel', false);
    await page.getByRole('menuitem', { name: 'Fork from here', exact: true }).click();
    await expect.poll(() => params(page).get('forkAt'), { timeout: TIMEOUT }).toBe(secondId);
    expect(params(page).get('threadId')).toBe(rootId);

    // The draft: the thread up to the fork point, the Forking line under it, and the composer.
    const forking = column(page).getByText(`Forking ${ROOT}`, { exact: true });
    await expect(forking).toBeVisible({ timeout: TIMEOUT });
    await expect(placeholder(page)).toHaveText('Continue in a new thread', { timeout: TIMEOUT });
    await expect(rowById(page, rootId)).toBeVisible();
    await expect(rowById(page, firstId)).toBeVisible();
    await expect(rowById(page, secondId)).toBeVisible();
    await expect(rowWith(page, THIRD)).toHaveCount(0);
    expect(await top(forking)).toBeGreaterThan(await top(rowById(page, secondId)));

    // Its first message starts the fork, and the new thread takes the draft's place.
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
    expect(params(page).get('forkAt')).toBeNull();

    // On the server it is a top-level message that names the parent and the fork point.
    const forkRoot = await matrixFetch<{ content: Record<string, unknown> }>(
      HOMESERVER,
      `/rooms/${encodeURIComponent(roomId)}/event/${encodeURIComponent(forkId)}`,
      { accessToken: user.accessToken }
    );
    expect(forkRoot.content.body).toBe(BRANCH);
    expect(forkRoot.content['m.relates_to']).toBeUndefined();
    expect(forkRoot.content['io.mindroom.fork']).toEqual({ thread_id: rootId, event_id: secondId });

    // The fork: the parent's root and replies up to the fork point, the Forked from line, its own
    // message, and not the parent's later reply.
    const forkedFrom = column(page).getByRole('button', {
      name: `Forked from ${ROOT}`,
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
    // The parent's messages are read-only here: their menu opens them in the original thread.
    await openMessageMenu(page, rowById(page, firstId), 'cheapest', false);
    const openOriginal = page.getByRole('menuitem', { name: 'Open in original thread' });
    await expect(openOriginal).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Reply in Thread' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(openOriginal).toHaveCount(0);

    // The Forked from line opens the parent, whose fork point shows the fork.
    await forkedFrom.click();
    await expect.poll(() => params(page).get('threadId'), { timeout: TIMEOUT }).toBe(rootId);
    await expect(rowById(page, thirdId)).toBeVisible({ timeout: TIMEOUT });
    const chip = rowById(page, secondId).locator('[data-thread-forks-chip]');
    await expect(chip).toHaveText('1 fork', { timeout: TIMEOUT });
    await expect(column(page).locator('[data-thread-forks-chip]')).toHaveCount(1);

    // Its menu lists the fork and opens it.
    await chip.click();
    const menu = page.getByRole('menu', { name: '1 fork', exact: true });
    await expect(menu).toBeVisible();
    await menu.locator(`[data-fork-thread-id="${forkId}"]`).click();
    await expect.poll(() => params(page).get('threadId'), { timeout: TIMEOUT }).toBe(forkId);
    await expect(forkedFrom).toBeVisible({ timeout: TIMEOUT });
    await expect(rowById(page, forkId)).toContainText(BRANCH);
  }
);
