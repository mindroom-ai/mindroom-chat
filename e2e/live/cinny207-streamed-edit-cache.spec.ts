import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { expectLoggedInShellStable, loginWithPassword } from '../helpers/auth';
import {
  createDefaultThreadFilterState,
  createPrivateRoom,
  loginToMatrix,
  seedRoomOverviewState,
  sendMessageEdit,
  sendRoomMessage,
} from '../helpers/matrix';
import { readThreadEventCacheRecords } from '../helpers/storage';

const hasCredentials = !!process.env.E2E_USERNAME;
const EDIT_COUNT = 25;

// CINNY-207 P0.2: red spec for finding F5 (every intermediate streaming edit
// is persisted as its own cache record). Flips green in P1.4 (edit
// compaction). See docs/mindroom-cache-overhaul-plan.md (AC4).
test.describe('CINNY-207 streamed edit cache compaction', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

  test('a streamed message leaves one cached record with the final content', async ({ page }) => {
    // Expected red until P1.4: today the cache holds ~EDIT_COUNT records.
    test.fail();

    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const { accessToken, userId } = await loginToMatrix(homeserver, username, password);
    const stamp = Date.now();
    const roomId = await createPrivateRoom(homeserver, accessToken, {
      name: `CINNY-207 Streamed Edits ${stamp}`,
      topic: 'Live fixture for streamed-edit cache compaction.',
    });
    const rootId = await sendRoomMessage(
      homeserver,
      accessToken,
      roomId,
      { msgtype: 'm.text', body: `Streamed edits thread root ${stamp}` },
      'cinny-207'
    );
    const replyId = await sendRoomMessage(
      homeserver,
      accessToken,
      roomId,
      {
        msgtype: 'm.text',
        body: 'Streaming…',
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: rootId,
          is_falling_back: true,
          'm.in_reply_to': { event_id: rootId },
        },
      },
      'cinny-207'
    );

    let streamedBody = '';
    for (let editIndex = 1; editIndex <= EDIT_COUNT; editIndex += 1) {
      streamedBody = `Streamed content ${stamp} token-${editIndex}`;
      // Sequential sends emulate MindRoom streaming (placeholder + rapid edits).
      // eslint-disable-next-line no-await-in-loop
      await sendMessageEdit(homeserver, accessToken, roomId, replyId, streamedBody, 'cinny-207');
    }
    const finalBody = streamedBody;

    await loginWithPassword(page, { homeserver, username, password });
    await expectLoggedInShellStable(page);
    await seedRoomOverviewState({
      page,
      roomId,
      userId,
      viewMode: 'threaded',
      filterState: createDefaultThreadFilterState(),
    });

    const threadUrl = `/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`;
    await page.goto(threadUrl);
    const replyItem = page.locator(`[data-message-id="${replyId}"]`);
    await expect(replyItem).toBeVisible({ timeout: 30_000 });
    await expect(replyItem.getByText(finalBody)).toBeVisible({ timeout: 30_000 });

    // Give the write-through a moment to settle, then reload and confirm the
    // cached shell paints the final content, not the placeholder.
    await page.waitForTimeout(3_000);
    await page.reload();
    await expectLoggedInShellStable(page);
    await page.goto(threadUrl);
    await expect(replyItem).toBeVisible({ timeout: 30_000 });
    await expect(replyItem.getByText(finalBody)).toBeVisible({ timeout: 30_000 });

    const cachedRecords = await readThreadEventCacheRecords(page, roomId, rootId);
    const replaceRecords = cachedRecords.filter((record) => record.eventId !== replyId);
    // Baseline capture for the plan scorecard (AC4 "before" column).
    console.log(
      `[cinny-207] thread cache records for streamed thread: total=${cachedRecords.length} standalone-non-target=${replaceRecords.length}`
    );

    // AC4: exactly one record for the logical message (the target with the
    // bundled latest edit); allow the root event as a second record.
    expect(cachedRecords.length).toBeLessThanOrEqual(2);
  });
});
