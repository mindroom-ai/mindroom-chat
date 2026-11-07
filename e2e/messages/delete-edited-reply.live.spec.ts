import { expect, test, type Page } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  createDefaultThreadFilterState,
  createPrivateRoom,
  loginToMatrix,
  redactEvent,
  seedRoomOverviewState,
  sendMessageEdit,
  sendRoomMessage,
} from '../helpers/matrix';
import { onWebKitPage, WEBKIT_EXECUTABLE } from '../helpers/webkit';

/**
 * Deleting your own messages (live-test lane 9, L9-F008 and L9-F009): an edited thread reply
 * deleted from the message menu leaves the thread at once, and neither the saved sync nor the
 * app's cache keeps any text of the deleted messages or of their edits, before a reload or after
 * it. A homeserver that bundles a thread's latest reply beside its summary
 * (`io.mindroom.latest_reply`, live-test pass 2, P2-lane9-F002) gives the root a copy of it too.
 */

type Fixture = {
  roomId: string;
  rootId: string;
  stamp: string;
  plainReplyId: string;
  editedReplyId: string;
  mainPlainId: string;
  mainEditedId: string;
};

const thread = (rootId: string) => ({
  rel_type: 'm.thread',
  event_id: rootId,
  is_falling_back: true,
  'm.in_reply_to': { event_id: rootId },
});

const createFixture = async (): Promise<Fixture> => {
  const homeserver = getHomeserver();
  const { username, password } = getPrimaryCredentials();
  const { accessToken } = await loginToMatrix(homeserver, username, password);
  const stamp = `${Date.now()}`;
  const roomId = await createPrivateRoom(homeserver, accessToken, {
    name: `Delete edited ${stamp}`,
    topic: 'Deleting edited messages.',
  });
  const say = (content: Record<string, unknown>) =>
    sendRoomMessage(homeserver, accessToken, roomId, { msgtype: 'm.text', ...content });
  const mainPlainId = await say({ body: `mainplain v1 ${stamp}` });
  const mainEditedId = await say({ body: `mainedited v1 ${stamp}` });
  await sendMessageEdit(homeserver, accessToken, roomId, mainEditedId, `mainedited v2 ${stamp}`);
  const rootId = await say({ body: `Thread root ${stamp}` });
  const plainReplyId = await say({
    body: `threadplain v1 ${stamp}`,
    'm.relates_to': thread(rootId),
  });
  const editedReplyId = await say({
    body: `threadedited v1 ${stamp}`,
    'm.relates_to': thread(rootId),
  });
  await sendMessageEdit(homeserver, accessToken, roomId, editedReplyId, `threadedited v2 ${stamp}`);
  return { roomId, rootId, stamp, plainReplyId, editedReplyId, mainPlainId, mainEditedId };
};

const deleteFromMenu = async (page: Page, eventId: string) => {
  const item = page.locator(`[data-message-id="${eventId}"]`).first();
  await item.hover();
  await item.getByRole('button', { name: 'More Options', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete Message' });
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(dialog).toBeHidden();
};

/** Every record of the account's saved sync stores and of the app's cache. */
const readSavedStores = (page: Page): Promise<unknown[]> =>
  page.evaluate(async () => {
    const names = (await indexedDB.databases())
      .map((database) => database.name ?? '')
      .filter(
        (name) =>
          name.startsWith('matrix-js-sdk:web-sync-store') || name.startsWith('mindroom-cache')
      );
    const dumps = await Promise.all(
      names.map(
        (name) =>
          new Promise<unknown[]>((resolve, reject) => {
            const request = indexedDB.open(name);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const db = request.result;
              const stores = Array.from(db.objectStoreNames);
              const transaction = db.transaction(stores, 'readonly');
              const reads = stores.map((store) => transaction.objectStore(store).getAll());
              transaction.oncomplete = () => {
                db.close();
                resolve(reads.map((read) => read.result as unknown));
              };
              transaction.onerror = () => reject(transaction.error);
            };
          })
      )
    );
    return dumps;
  });

/** The paths in `value` of every string that contains `needle`; events show their type. */
const findText = (value: unknown, needle: string, path = ''): string[] => {
  if (typeof value === 'string') return value.includes(needle) ? [path] : [];
  if (!value || typeof value !== 'object') return [];
  const { type } = value as { type?: unknown };
  const here = typeof type === 'string' ? `${path}(${type})` : path;
  return Object.entries(value).flatMap(([key, child]) => findText(child, needle, `${here}/${key}`));
};

const DELETED_TEXTS = [
  'mainplain v1',
  'mainedited v1',
  'mainedited v2',
  'threadplain v1',
  'threadedited v1',
  'threadedited v2',
];

/** The deleted texts the saved stores still hold, with where they are. */
const keptTexts = async (page: Page, stamp: string, texts = DELETED_TEXTS) => {
  const saved = await readSavedStores(page);
  // The message that was not deleted is there, so the stores were read.
  expect(findText(saved, `Thread root ${stamp}`).length).toBeGreaterThan(0);
  return texts
    .map((text) => ({ text, paths: findText(saved, `${text} ${stamp}`) }))
    .filter(({ paths }) => paths.length > 0);
};

/** Signs in and opens the fixture's thread. */
const openThread = async (page: Page, fixture: Fixture) => {
  const homeserver = getHomeserver();
  const { username, password } = getPrimaryCredentials();
  const { userId } = await loginToMatrix(homeserver, username, password);
  const { roomId, rootId, stamp } = fixture;
  await loginWithPassword(page, { homeserver, username, password });
  await seedRoomOverviewState({
    page,
    roomId,
    userId,
    viewMode: 'threaded',
    filterState: createDefaultThreadFilterState(),
  });
  await page.goto(`/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`);
  await expect(page.getByText(`threadedited v2 ${stamp}`)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(`threadplain v1 ${stamp}`)).toBeVisible();
};

/**
 * L9-F008: an edited reply deleted from its menu leaves the thread with the server's answer.
 * P2-lane9-F002: the stores keep none of its text once the next save ran, nor after a reload.
 */
const deleteEditedReply = async (page: Page) => {
  const fixture = await createFixture();
  const { stamp } = fixture;
  await openThread(page, fixture);

  await deleteFromMenu(page, fixture.editedReplyId);
  await expect(page.getByText(`threadedited v2 ${stamp}`)).toHaveCount(0, { timeout: 5_000 });
  // DELETE_SHOTS names a directory for a screenshot of the thread after the delete.
  const shots = process.env.DELETE_SHOTS;
  if (shots)
    await page.screenshot({ path: `${shots}/after-delete-${test.info().title.split(':')[0]}.png` });
  await deleteFromMenu(page, fixture.plainReplyId);
  await expect(page.getByText(`threadplain v1 ${stamp}`)).toHaveCount(0, { timeout: 5_000 });

  // A redaction is saved at most two seconds after it arrives.
  const deleted = ['threadplain v1', 'threadedited v1', 'threadedited v2'];
  await page.waitForTimeout(5_000);
  expect(await keptTexts(page, stamp, deleted), 'deleted texts before a reload').toEqual([]);
  await page.reload();
  await expect(page.getByText(`Thread root ${stamp}`).first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(5_000);
  expect(await keptTexts(page, stamp, deleted), 'deleted texts after a reload').toEqual([]);
};

/** L9-F009: after a reload, the saved stores hold no text of a deleted message or its edits. */
const reloadAfterDeletes = async (page: Page) => {
  const homeserver = getHomeserver();
  const { username, password } = getPrimaryCredentials();
  const { accessToken } = await loginToMatrix(homeserver, username, password);
  const fixture = await createFixture();
  const { roomId, stamp } = fixture;
  await openThread(page, fixture);

  // Deleted from another device while the thread is open, so the app learns of it by sync.
  for (const eventId of [
    fixture.editedReplyId,
    fixture.plainReplyId,
    fixture.mainPlainId,
    fixture.mainEditedId,
  ]) {
    await redactEvent(homeserver, accessToken, roomId, eventId);
  }
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
  await expect(page.getByText(`mainedited v2 ${stamp}`)).toHaveCount(0, { timeout: 15_000 });
  await page.waitForTimeout(4_000);
  await page.reload();
  await expect(page.getByText(`Thread root ${stamp}`).first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(5_000);

  expect(await keptTexts(page, stamp), 'deleted texts in the saved stores').toEqual([]);
};

const onWebKit = (baseURL: string | undefined, check: (page: Page) => Promise<void>) => {
  test.skip(!WEBKIT_EXECUTABLE, 'PLAYWRIGHT_WEBKIT_EXECUTABLE not set');
  return onWebKitPage({ baseURL, viewport: { width: 1280, height: 800 } }, check);
};

test.describe('deleting edited messages', () => {
  test.skip(!process.env.E2E_USERNAME, 'E2E_USERNAME / E2E_PASSWORD not set');
  test.setTimeout(4 * 60_000);

  test('Chromium: an edited thread reply leaves at once when deleted', async ({ page }) => {
    await deleteEditedReply(page);
  });

  test('WebKit: an edited thread reply leaves at once when deleted', async ({ baseURL }) => {
    await onWebKit(baseURL, deleteEditedReply);
  });

  test('Chromium: the saved stores keep no text of deleted messages', async ({ page }) => {
    await reloadAfterDeletes(page);
  });

  test('WebKit: the saved stores keep no text of deleted messages', async ({ baseURL }) => {
    await onWebKit(baseURL, reloadAfterDeletes);
  });
});
