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

// CINNY-207 P1.4 (AC4): edit compaction at the write boundary. Streaming a
// message with N edits must produce exactly one cached record for the logical
// message (the target with the bundled latest edit in
// `unsigned['m.relations']['m.replace']`) plus at most the root event; reload
// must paint the final content. Was P0.2-red (test.fail); flipped to real
// green in P1.4. See docs/mindroom-cache-overhaul-plan.md (AC4).
test.describe('CINNY-207 streamed edit cache compaction', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

  test('a streamed message leaves one cached record with the final content', async ({ page }) => {
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
    const nonTargetRecords = cachedRecords.filter((record) => record.eventId !== replyId);
    // Evidence capture for the plan scorecard (AC4 "after" column).
    console.log(
      `[cinny-207] thread cache records for streamed thread: total=${cachedRecords.length} non-target=${nonTargetRecords.length}`
    );

    // AC4: exactly one record for the logical message (the target with the
    // bundled latest edit). No standalone m.replace records must remain
    // (they compact into the target). The root event and the target may
    // both be present — pre-P1.4 this was EDIT_COUNT+1 records.
    const replyRecord = cachedRecords.find((record) => record.eventId === replyId);
    expect(replyRecord).toBeDefined();
    const standaloneReplaceRecords = cachedRecords.filter(
      (record) => record.eventId !== replyId && record.eventId !== rootId
    );
    expect(standaloneReplaceRecords).toEqual([]);
  });
});
