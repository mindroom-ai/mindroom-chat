/**
 * PR #84 review deferral (finding #3): `meta.expectedReplyCount` merge
 * policy. Background sweep chunks persist a per-thread
 * expectedReplyCount derived from the live root's bundled
 * `m.thread.count` — which the SDK does NOT update as replies arrive
 * and which is stale when the root is restored from the SDK store. An
 * unconditional overwrite let a stale-LOW sweep value replace a
 * fresher count, weakening the reply-count completeness proof the
 * eager-cache open path leans on.
 *
 * Policy under test:
 *   - snapshotComplete !== true writes (sweeps, partial persists):
 *     expectedReplyCount merges MONOTONICALLY (max of stored/incoming)
 *     — a stale-low value can never weaken the proof.
 *   - snapshotComplete === true writes (authoritative full-drain
 *     proof): SET absolutely — the only writer allowed to LOWER the
 *     count, because redactions legitimately shrink threads and the
 *     drain observed the real reply set.
 */

import 'fake-indexeddb/auto';
import type { IEvent } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  loadLatestCachedThreadEvents,
  resetCacheStoreForTesting,
  saveRoomEventsToCache,
  saveThreadEventsToCache,
} from '..';
import { openCacheStore } from '../cacheStoreDb';
import { buildMetaKey, META_STORE, type CachedMetaRecord } from '../cacheStoreSchema';

const SESSION_ID = 'reply-count-merge-session';
const ROOM_ID = '!room:example.org';
const THREAD_ID = '$thread-root:example.org';

const rawReply = (id: string, ts: number): Partial<IEvent> => ({
  event_id: id,
  origin_server_ts: ts,
  type: 'm.room.message',
  room_id: ROOM_ID,
  sender: '@alice:example.org',
  content: {
    body: id,
    'm.relates_to': { event_id: THREAD_ID, rel_type: 'm.thread' },
  },
});

const saveWithCount = (
  expectedReplyCount: number | undefined,
  snapshotComplete: boolean | undefined,
  eventId = '$reply-1',
  eventTs = 1_000
) =>
  saveThreadEventsToCache(
    SESSION_ID,
    ROOM_ID,
    THREAD_ID,
    [rawReply(eventId, eventTs)],
    undefined,
    undefined,
    undefined,
    snapshotComplete,
    expectedReplyCount,
    undefined
  );

const storedCount = async (): Promise<number | undefined> =>
  (await loadLatestCachedThreadEvents(SESSION_ID, ROOM_ID, THREAD_ID, 5)).expectedReplyCount;

describe('thread meta expectedReplyCount merge policy', () => {
  beforeEach(() => resetCacheStoreForTesting());
  afterEach(() => resetCacheStoreForTesting());

  it('a non-complete write with a stale-LOW count cannot lower the stored value', async () => {
    await saveWithCount(282, undefined, '$reply-1', 1_000);
    await saveWithCount(20, undefined, '$reply-2', 2_000);
    expect(await storedCount()).toBe(282);
  });

  it('a non-complete write with a HIGHER count raises the stored value', async () => {
    await saveWithCount(20, undefined, '$reply-1', 1_000);
    await saveWithCount(282, undefined, '$reply-2', 2_000);
    expect(await storedCount()).toBe(282);
  });

  it('a complete-proof write may LOWER the stored value (redactions shrink threads)', async () => {
    await saveWithCount(282, undefined, '$reply-1', 1_000);
    await saveWithCount(200, true, '$reply-2', 3_000);
    expect(await storedCount()).toBe(200);
  });

  it('an undefined incoming count keeps the stored value', async () => {
    await saveWithCount(282, undefined, '$reply-1');
    await saveWithCount(undefined, undefined, '$reply-2');
    expect(await storedCount()).toBe(282);
  });

  it('a count-LESS complete write retains the stored value (refreshLatestThreadSlice shape)', async () => {
    // Production-reachable: refreshLatestThreadSlice persists complete
    // snapshots without an expectedReplyCount argument. The complete-
    // proof "set absolutely" rule applies only when the write carries
    // a count — with none, there is no observation to prefer.
    await saveWithCount(282, undefined, '$reply-1');
    await saveWithCount(undefined, true, '$reply-2');
    expect(await storedCount()).toBe(282);
  });

  it('downgrades a relation-complete write that omits both count and evidence', async () => {
    const sessionId = `${SESSION_ID}-countless-complete`;
    await saveThreadEventsToCache(
      sessionId,
      ROOM_ID,
      THREAD_ID,
      [rawReply('$stale-reply', 1_000)],
      undefined,
      undefined,
      undefined,
      undefined,
      24,
      true
    );
    const completeReplies = Array.from({ length: 23 }, (_, index) =>
      rawReply(`$complete-reply-${index}`, 2_000 + index)
    );

    await saveThreadEventsToCache(
      sessionId,
      ROOM_ID,
      THREAD_ID,
      completeReplies,
      undefined,
      undefined,
      true,
      true,
      undefined,
      true
    );

    const page = await loadLatestCachedThreadEvents(sessionId, ROOM_ID, THREAD_ID, 32);
    expect(page.expectedReplyCount).toBe(24);
    expect(page.relationSnapshotComplete).toBe(false);
    expect(page.expectedReplyCountEvidence).toBeUndefined();
  });

  it('downgrades an explicit partial relation write without erasing its count baseline', async () => {
    const sessionId = `${SESSION_ID}-explicit-incomplete`;
    await saveThreadEventsToCache(
      sessionId,
      ROOM_ID,
      THREAD_ID,
      [rawReply('$proven-reply', 1_000)],
      undefined,
      undefined,
      undefined,
      true,
      1,
      true
    );
    await saveThreadEventsToCache(
      sessionId,
      ROOM_ID,
      THREAD_ID,
      [rawReply('$partial-reply', 2_000)],
      undefined,
      undefined,
      true,
      undefined,
      undefined,
      false
    );

    const page = await loadLatestCachedThreadEvents(sessionId, ROOM_ID, THREAD_ID, 5);
    expect(page.expectedReplyCount).toBe(2);
    expect(page.relationSnapshotComplete).toBe(false);
    expect(page.expectedReplyCountSnapshotTs).toBeGreaterThanOrEqual(2_000);
    expect(page.expectedReplyCountEvidence).toEqual({
      knownEventIds: ['$proven-reply', '$partial-reply'],
      visibleEventIds: ['$proven-reply', '$partial-reply'],
    });
  });

  it('applies durable redaction markers before reconciling partial metadata', async () => {
    const sessionId = `${SESSION_ID}-marked-redaction`;
    await saveThreadEventsToCache(
      sessionId,
      ROOM_ID,
      THREAD_ID,
      [rawReply('$reply', 1_000)],
      undefined,
      undefined,
      true,
      true,
      1,
      true,
      'partial',
      { knownEventIds: ['$reply'], visibleEventIds: ['$reply'] }
    );
    await saveThreadEventsToCache(
      sessionId,
      ROOM_ID,
      THREAD_ID,
      [
        {
          event_id: '$redaction',
          origin_server_ts: 2_000,
          room_id: ROOM_ID,
          sender: '@moderator:example.org',
          type: 'm.room.redaction',
          redacts: '$reply',
          content: {},
        },
      ],
      undefined,
      undefined,
      true,
      false,
      undefined,
      undefined
    );
    const redactedPage = await loadLatestCachedThreadEvents(sessionId, ROOM_ID, THREAD_ID, 5);
    expect(redactedPage.expectedReplyCount).toBe(0);
    expect(redactedPage.expectedReplyCountSnapshotTs).toBeGreaterThanOrEqual(2_000);
    expect(redactedPage.expectedReplyCountEvidence).toEqual({
      knownEventIds: ['$reply'],
      visibleEventIds: [],
    });
    expect(redactedPage.relationSnapshotComplete).toBe(true);

    await saveThreadEventsToCache(
      sessionId,
      ROOM_ID,
      THREAD_ID,
      [rawReply('$reply', 3_000)],
      undefined,
      undefined,
      true,
      false,
      0,
      false
    );

    const page = await loadLatestCachedThreadEvents(sessionId, ROOM_ID, THREAD_ID, 5);
    expect(page.events.map((event) => event.event_id)).not.toContain('$reply');
    expect(page.expectedReplyCount).toBe(0);
    expect(page.expectedReplyCountSnapshotTs).toBeGreaterThanOrEqual(2_000);
    expect(page.expectedReplyCountEvidence).toEqual({
      knownEventIds: ['$reply'],
      visibleEventIds: [],
    });
    expect(page.relationSnapshotComplete).toBe(false);
  });

  it('loads a room-scope marker timestamp before reconciling a stale thread reply', async () => {
    const sessionId = `${SESSION_ID}-stored-marker-horizon`;
    await saveThreadEventsToCache(
      sessionId,
      ROOM_ID,
      THREAD_ID,
      [rawReply('$reply', 1_000)],
      undefined,
      undefined,
      true,
      true,
      1,
      true,
      'partial',
      { knownEventIds: ['$reply'], visibleEventIds: ['$reply'] }
    );
    await saveRoomEventsToCache(sessionId, ROOM_ID, [
      {
        event_id: '$redaction',
        origin_server_ts: 2_000,
        room_id: ROOM_ID,
        sender: '@moderator:example.org',
        type: 'm.room.redaction',
        redacts: '$reply',
        content: {},
      },
    ]);
    await saveThreadEventsToCache(
      sessionId,
      ROOM_ID,
      THREAD_ID,
      [rawReply('$reply', 1_000)],
      undefined,
      undefined,
      true,
      false,
      1,
      false
    );

    const page = await loadLatestCachedThreadEvents(sessionId, ROOM_ID, THREAD_ID, 5);
    expect(page.expectedReplyCount).toBe(0);
    expect(page.expectedReplyCountSnapshotTs).toBe(2_000);
    expect(page.expectedReplyCountEvidence).toEqual({
      knownEventIds: ['$reply'],
      visibleEventIds: [],
    });
  });

  it('sanitizes a stale relation-complete snapshot against durable markers', async () => {
    const sessionId = `${SESSION_ID}-marked-complete`;
    await saveRoomEventsToCache(sessionId, ROOM_ID, [
      {
        event_id: '$redaction',
        origin_server_ts: 2_000,
        room_id: ROOM_ID,
        sender: '@moderator:example.org',
        type: 'm.room.redaction',
        redacts: '$reply',
        content: {},
      },
    ]);
    await saveThreadEventsToCache(
      sessionId,
      ROOM_ID,
      THREAD_ID,
      [rawReply('$reply', 1_000)],
      undefined,
      undefined,
      true,
      true,
      1,
      true,
      'partial',
      { knownEventIds: ['$reply'], visibleEventIds: ['$reply'] }
    );

    const page = await loadLatestCachedThreadEvents(sessionId, ROOM_ID, THREAD_ID, 5);
    expect(page.events.map((event) => event.event_id)).not.toContain('$reply');
    expect(page.expectedReplyCount).toBe(0);
    expect(page.expectedReplyCountSnapshotTs).toBe(2_000);
    expect(page.expectedReplyCountEvidence).toEqual({
      knownEventIds: ['$reply'],
      visibleEventIds: [],
    });
    expect(page.relationSnapshotComplete).toBe(true);
  });

  it('applies a marker when the incoming bundled count is stale and lower', async () => {
    const sessionId = `${SESSION_ID}-lower-bundled-marker`;
    await saveThreadEventsToCache(
      sessionId,
      ROOM_ID,
      THREAD_ID,
      [rawReply('$reply', 1_000)],
      undefined,
      undefined,
      true,
      true,
      282,
      true,
      'partial',
      { knownEventIds: ['$reply'], visibleEventIds: ['$reply'] }
    );
    await saveRoomEventsToCache(sessionId, ROOM_ID, [
      {
        event_id: '$redaction',
        origin_server_ts: 2_000,
        room_id: ROOM_ID,
        sender: '@moderator:example.org',
        type: 'm.room.redaction',
        redacts: '$reply',
        content: {},
      },
    ]);
    await saveThreadEventsToCache(
      sessionId,
      ROOM_ID,
      THREAD_ID,
      [rawReply('$reply', 1_000)],
      undefined,
      undefined,
      true,
      undefined,
      24,
      undefined
    );

    const page = await loadLatestCachedThreadEvents(sessionId, ROOM_ID, THREAD_ID, 5);
    expect(page.expectedReplyCount).toBe(281);
    expect(page.expectedReplyCountSnapshotTs).toBe(2_000);
    expect(page.expectedReplyCountEvidence).toEqual({
      knownEventIds: ['$reply'],
      visibleEventIds: [],
    });
    expect(page.relationSnapshotComplete).toBe(true);
  });

  it('keeps an authoritative lower snapshot instead of reviving the old baseline', async () => {
    const sessionId = `${SESSION_ID}-absolute-lower-marker`;
    await saveThreadEventsToCache(
      sessionId,
      ROOM_ID,
      THREAD_ID,
      [rawReply('$reply', 1_000)],
      undefined,
      undefined,
      true,
      true,
      282,
      true,
      'partial',
      { knownEventIds: ['$reply'], visibleEventIds: ['$reply'] }
    );
    await saveRoomEventsToCache(sessionId, ROOM_ID, [
      {
        event_id: '$redaction',
        origin_server_ts: 2_000,
        room_id: ROOM_ID,
        sender: '@moderator:example.org',
        type: 'm.room.redaction',
        redacts: '$reply',
        content: {},
      },
    ]);
    await saveThreadEventsToCache(
      sessionId,
      ROOM_ID,
      THREAD_ID,
      [rawReply('$reply', 1_000)],
      undefined,
      undefined,
      true,
      true,
      24,
      false
    );

    const page = await loadLatestCachedThreadEvents(sessionId, ROOM_ID, THREAD_ID, 5);
    expect(page.expectedReplyCount).toBe(24);
    expect(page.expectedReplyCountEvidence).toBeUndefined();
    expect(page.relationSnapshotComplete).toBe(false);
  });

  it('advances a complete snapshot that already excludes the marked reply', async () => {
    const sessionId = `${SESSION_ID}-excluded-complete-marker`;
    await saveRoomEventsToCache(sessionId, ROOM_ID, [
      {
        event_id: '$redaction',
        origin_server_ts: 2_000,
        room_id: ROOM_ID,
        sender: '@moderator:example.org',
        type: 'm.room.redaction',
        redacts: '$reply',
        content: {},
      },
    ]);
    await saveThreadEventsToCache(
      sessionId,
      ROOM_ID,
      THREAD_ID,
      [rawReply('$reply', 1_000)],
      undefined,
      undefined,
      true,
      true,
      0,
      true,
      'partial',
      { knownEventIds: ['$reply'], visibleEventIds: [] }
    );

    const page = await loadLatestCachedThreadEvents(sessionId, ROOM_ID, THREAD_ID, 5);
    expect(page.expectedReplyCount).toBe(0);
    expect(page.expectedReplyCountSnapshotTs).toBe(2_000);
    expect(page.expectedReplyCountEvidence).toEqual({
      knownEventIds: ['$reply'],
      visibleEventIds: [],
    });
    expect(page.relationSnapshotComplete).toBe(true);
  });

  it('prefers a newer stored marker horizon over a stale duplicate redaction', async () => {
    const sessionId = `${SESSION_ID}-duplicate-redaction-horizon`;
    await saveThreadEventsToCache(
      sessionId,
      ROOM_ID,
      THREAD_ID,
      [rawReply('$reply', 1_000)],
      undefined,
      undefined,
      true,
      true,
      1,
      true,
      'partial',
      { knownEventIds: ['$reply'], visibleEventIds: ['$reply'] }
    );
    await saveRoomEventsToCache(sessionId, ROOM_ID, [
      {
        event_id: '$redaction',
        origin_server_ts: 2_000,
        room_id: ROOM_ID,
        sender: '@moderator:example.org',
        type: 'm.room.redaction',
        redacts: '$reply',
        content: {},
      },
    ]);
    await saveThreadEventsToCache(
      sessionId,
      ROOM_ID,
      THREAD_ID,
      [
        {
          ...rawReply('$reply', 1_000),
          unsigned: { redacted_because: { origin_server_ts: 1_500 } },
        },
      ],
      undefined,
      undefined,
      true,
      false,
      1,
      false
    );

    const page = await loadLatestCachedThreadEvents(sessionId, ROOM_ID, THREAD_ID, 5);
    expect(page.expectedReplyCount).toBe(0);
    expect(page.expectedReplyCountSnapshotTs).toBe(2_000);
    expect(page.expectedReplyCountEvidence).toEqual({
      knownEventIds: ['$reply'],
      visibleEventIds: [],
    });
  });

  it('advances already-excluded retained evidence from a newer marker', async () => {
    const sessionId = `${SESSION_ID}-excluded-retained-marker`;
    await saveThreadEventsToCache(
      sessionId,
      ROOM_ID,
      THREAD_ID,
      [],
      {
        event_id: THREAD_ID,
        origin_server_ts: 1_000,
        room_id: ROOM_ID,
        sender: '@alice:example.org',
        type: 'm.room.message',
        content: { body: 'Root', msgtype: 'm.text' },
      },
      undefined,
      true,
      true,
      0,
      true,
      'partial',
      { knownEventIds: ['$reply'], visibleEventIds: [] }
    );
    await saveThreadEventsToCache(
      sessionId,
      ROOM_ID,
      THREAD_ID,
      [
        {
          ...rawReply('$reply', 1_000),
          unsigned: { redacted_because: { origin_server_ts: 2_000 } },
        },
      ],
      undefined,
      undefined,
      true,
      false,
      0,
      false
    );

    const page = await loadLatestCachedThreadEvents(sessionId, ROOM_ID, THREAD_ID, 5);
    expect(page.expectedReplyCount).toBe(0);
    expect(page.expectedReplyCountSnapshotTs).toBe(2_000);
    expect(page.expectedReplyCountEvidence).toEqual({
      knownEventIds: ['$reply'],
      visibleEventIds: [],
    });
  });

  it('keeps the newest redaction timestamp when one batch repeats a target', async () => {
    const sessionId = `${SESSION_ID}-batch-redaction-max`;
    await saveThreadEventsToCache(
      sessionId,
      ROOM_ID,
      THREAD_ID,
      [rawReply('$reply', 1_000)],
      undefined,
      undefined,
      true,
      true,
      1,
      true,
      'partial',
      { knownEventIds: ['$reply'], visibleEventIds: ['$reply'] }
    );
    await saveThreadEventsToCache(
      sessionId,
      ROOM_ID,
      THREAD_ID,
      [
        {
          event_id: '$redaction',
          origin_server_ts: 2_000,
          room_id: ROOM_ID,
          sender: '@moderator:example.org',
          type: 'm.room.redaction',
          redacts: '$reply',
          content: {},
        },
        {
          ...rawReply('$reply', 1_000),
          unsigned: { redacted_because: { origin_server_ts: 1_500 } },
        },
      ],
      undefined,
      undefined,
      true,
      false,
      1,
      false
    );

    const page = await loadLatestCachedThreadEvents(sessionId, ROOM_ID, THREAD_ID, 5);
    expect(page.expectedReplyCount).toBe(0);
    expect(page.expectedReplyCountSnapshotTs).toBe(2_000);
  });

  it('keeps a count horizon only when relation coverage proves what the count includes', async () => {
    const sessionId = `${SESSION_ID}-snapshot-timestamp`;
    const save = (
      count: number,
      complete: boolean | undefined,
      id: string,
      ts: number,
      relationComplete = false
    ) =>
      saveThreadEventsToCache(
        sessionId,
        ROOM_ID,
        THREAD_ID,
        [rawReply(id, ts)],
        undefined,
        undefined,
        undefined,
        complete,
        count,
        relationComplete || undefined
      );
    const loadSnapshotTs = async () =>
      (await loadLatestCachedThreadEvents(sessionId, ROOM_ID, THREAD_ID, 5))
        .expectedReplyCountSnapshotTs;

    await save(282, true, '$timestamp-1', 1_000, true);
    const completePage = await loadLatestCachedThreadEvents(sessionId, ROOM_ID, THREAD_ID, 5);
    const completeSnapshotTs = completePage.expectedReplyCountSnapshotTs;
    expect(completeSnapshotTs).toBeGreaterThanOrEqual(1_000);
    expect(completePage.expectedReplyCountEvidence).toEqual({
      knownEventIds: ['$timestamp-1'],
      visibleEventIds: ['$timestamp-1'],
    });

    await save(20, undefined, '$timestamp-3', 3_000);
    expect(await loadSnapshotTs()).toBe(completeSnapshotTs);

    await save(300, undefined, '$timestamp-4', 4_000);
    expect(await loadSnapshotTs()).toBeUndefined();

    await save(299, true, '$timestamp-5', 5_000, true);
    expect(await loadSnapshotTs()).toBeGreaterThanOrEqual(5_000);

    await save(280, true, '$timestamp-6', 6_000);
    expect(await loadSnapshotTs()).toBeUndefined();
  });

  it('downgrades a legacy relation-complete row that has no identity evidence', async () => {
    const sessionId = `${SESSION_ID}-legacy-evidence`;
    const db = await openCacheStore(sessionId);
    expect(db).toBeDefined();
    await new Promise<void>((resolve, reject) => {
      const transaction = db!.transaction(META_STORE, 'readwrite');
      transaction.objectStore(META_STORE).put({
        metaKey: buildMetaKey(ROOM_ID, THREAD_ID),
        roomId: ROOM_ID,
        scope: THREAD_ID,
        expectedReplyCount: 23,
        relationSnapshotComplete: true,
        updatedAt: 1,
      } satisfies CachedMetaRecord);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });

    const page = await loadLatestCachedThreadEvents(sessionId, ROOM_ID, THREAD_ID, 5);
    expect(page.expectedReplyCount).toBe(23);
    expect(page.relationSnapshotComplete).toBe(false);
    expect(page.expectedReplyCountEvidence).toBeUndefined();
  });
});
