import 'fake-indexeddb/auto';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { MatrixEvent, type Thread } from 'matrix-js-sdk';
import { expect, it, vi } from 'vitest';
import { getMindroomThreadSummaryInfo } from '../messages/threadSummary';
import { loadCachedThreadSummaries, saveThreadEventsToCache } from './cacheStore';
import { seedLegacyCachedThreadSummary } from './cacheStore/__tests__/summaryFixtures';
import { useThreadSummaryPublishController } from './threadSummaryPublishController';
import {
  clearThreadSummarySharedState,
  ensureThreadSummaryStateLoaded,
  getThreadSummaryStateSnapshot,
  storeThreadSummaryInState,
  subscribeToThreadSummaryState,
} from './threadSummaryState';
import { useRoomThreadSummaryState } from './useRoomThreadSummaryState';

it('displays a live title queued during hydration without turning it into durable history', async () => {
  const sessionId = 'summary-read-settlement';
  const roomId = '!summary:test';
  await seedLegacyCachedThreadSummary(sessionId, roomId, '$root', {
    summaryText: 'Cached title',
    generatedTs: 1000,
  });
  let queued = false;
  const unsubscribe = subscribeToThreadSummaryState(sessionId, roomId, () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      storeThreadSummaryInState(sessionId, roomId, '$other', {
        summaryText: 'Published after hydration',
        generatedTs: 2000,
      });
    });
  });
  try {
    await ensureThreadSummaryStateLoaded(sessionId, roomId);
    expect(getThreadSummaryStateSnapshot(sessionId, roomId).get('$other')?.summaryText).toBe(
      'Published after hydration'
    );
    expect((await loadCachedThreadSummaries(sessionId, roomId)).has('$other')).toBe(false);
  } finally {
    unsubscribe();
    clearThreadSummarySharedState(sessionId);
  }
});

it.each([false, true])(
  'retries failed cache reads without losing disk titles or migration evidence (manual edit: %s)',
  async (manualEdit) => {
    const sessionId = `summary-failed-read-${manualEdit}`;
    const roomId = '!summary:test';
    const cached = { summaryText: 'Newer cached title', generatedTs: 9000 };
    await seedLegacyCachedThreadSummary(sessionId, roomId, '$root', cached);
    const originalTransaction = IDBDatabase.prototype.transaction;
    let failRead = true;
    const transaction = vi
      .spyOn(IDBDatabase.prototype, 'transaction')
      .mockImplementation(function failSummaryRead(this: IDBDatabase, stores, mode, options) {
        // Migration is a write that can fall back to the committed index;
        // this regression must fail the actual summary read instead.
        if (failRead && stores === 'thread_summaries' && mode === 'readonly') {
          failRead = false;
          throw new DOMException('Temporarily unavailable', 'InvalidStateError');
        }
        return originalTransaction.call(this, stores, mode, options);
      });
    try {
      storeThreadSummaryInState(
        sessionId,
        roomId,
        '$root',
        manualEdit
          ? { ...cached, eventTs: 1000 }
          : { summaryText: 'Older live title', generatedTs: 1000, eventTs: 1000 },
        manualEdit
          ? {
              summaryText: 'Accepted human title',
              generatedTs: 1000,
              eventTs: 1200,
              isManual: true,
            }
          : undefined
      );
      await ensureThreadSummaryStateLoaded(sessionId, roomId);
      expect(failRead).toBe(false);
      expect((await loadCachedThreadSummaries(sessionId, roomId)).get('$root')?.summaryText).toBe(
        'Newer cached title'
      );

      // A later live publication retries hydration without resending the first batch.
      storeThreadSummaryInState(sessionId, roomId, '$other', {
        summaryText: 'Another thread',
        generatedTs: 2000,
      });
      await ensureThreadSummaryStateLoaded(sessionId, roomId);
      const expected = manualEdit ? 'Accepted human title' : 'Newer cached title';
      expect(getThreadSummaryStateSnapshot(sessionId, roomId).get('$root')?.summaryText).toBe(
        expected
      );
      expect((await loadCachedThreadSummaries(sessionId, roomId)).get('$root')?.summaryText).toBe(
        'Newer cached title'
      );
    } finally {
      transaction.mockRestore();
      clearThreadSummarySharedState(sessionId);
    }
  }
);

it('retains a newer disk title when partial live history publishes before initial hydration', async () => {
  const sessionId = 'summary-partial-history';
  const roomId = '!summary:test';
  await seedLegacyCachedThreadSummary(sessionId, roomId, '$root', {
    summaryText: 'Newer cached title',
    generatedTs: 9000,
  });
  storeThreadSummaryInState(sessionId, roomId, '$root', {
    summaryText: 'Older live title',
    generatedTs: 1000,
    eventTs: 1000,
  });
  await ensureThreadSummaryStateLoaded(sessionId, roomId);
  expect(getThreadSummaryStateSnapshot(sessionId, roomId).get('$root')?.summaryText).toBe(
    'Newer cached title'
  );
  expect((await loadCachedThreadSummaries(sessionId, roomId)).get('$root')?.summaryText).toBe(
    'Newer cached title'
  );
  clearThreadSummarySharedState(sessionId);
});

it('does not flush a pending publication after its session state is removed', async () => {
  const sessionId = 'summary-removed-session';
  const roomId = '!summary:test';
  await seedLegacyCachedThreadSummary(sessionId, roomId, '$root', {
    summaryText: 'Existing title',
    generatedTs: 9000,
  });
  storeThreadSummaryInState(sessionId, roomId, '$root', {
    summaryText: 'Removed session title',
    generatedTs: 10000,
    eventTs: 10000,
  });
  const pending = ensureThreadSummaryStateLoaded(sessionId, roomId);
  clearThreadSummarySharedState(sessionId);
  await pending;
  expect((await loadCachedThreadSummaries(sessionId, roomId)).get('$root')?.summaryText).toBe(
    'Existing title'
  );
});

it.each([
  ['overview', false],
  ['thread', false],
  ['overview', true],
  ['thread', true],
] as const)(
  'displays legacy-cache enrichment from the %s and persists accepted event ingestion (initial read pending: %s)',
  async (surface, pendingCacheRead) => {
    const sessionId = `summary-migration-${surface}-${pendingCacheRead}`;
    const roomId = '!summary-migration:test';
    const event = (
      id: string,
      summary: string,
      timestamp: number,
      generated: number,
      manual = false
    ) =>
      new MatrixEvent({
        event_id: id,
        type: 'm.room.message',
        origin_server_ts: timestamp,
        content: {
          msgtype: 'm.notice',
          body: summary,
          'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
          'io.mindroom.thread_summary': {
            version: 1,
            summary,
            generated_at: new Date(generated).toISOString(),
            ...(manual ? { model: 'manual' } : {}),
          },
        },
      });
    const automatic = event('$auto', 'Stale automatic', 1100, 9000);
    const manual = event('$manual', 'Accepted human title', 1200, 1000, true);
    await seedLegacyCachedThreadSummary(
      sessionId,
      roomId,
      '$root',
      getMindroomThreadSummaryInfo(automatic.getContent())!
    );
    if (!pendingCacheRead) await ensureThreadSummaryStateLoaded(sessionId, roomId);
    const threadEvents = [automatic, manual];
    const thread = { events: threadEvents, timeline: threadEvents } as Thread;
    const summaries = new Map([['$root', getMindroomThreadSummaryInfo(manual.getContent())!]]);
    const room = { getThread: () => thread };
    const Harness = () => {
      const { storeThreadSummary, summaryMap } = useRoomThreadSummaryState({ sessionId, roomId });
      useThreadSummaryPublishController({
        onStoreThreadSummary: storeThreadSummary,
        room,
        thread,
        threadEvents,
        threadId: surface === 'thread' ? '$root' : undefined,
        threadSummaryInfoMap: summaries,
      });
      return <span>{summaryMap.get('$root')?.summaryText}</span>;
    };
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<Harness />);
    });
    await act(async () => ensureThreadSummaryStateLoaded(sessionId, roomId));
    try {
      expect(renderer.root.findByType('span').children).toEqual(['Accepted human title']);
      expect((await loadCachedThreadSummaries(sessionId, roomId)).get('$root')?.summaryText).toBe(
        'Stale automatic'
      );
      await act(async () => {
        await saveThreadEventsToCache(sessionId, roomId, '$root', [automatic.event, manual.event]);
      });
      expect((await loadCachedThreadSummaries(sessionId, roomId)).get('$root')?.summaryText).toBe(
        'Accepted human title'
      );
    } finally {
      act(() => renderer.unmount());
    }
    clearThreadSummarySharedState(sessionId);
    await ensureThreadSummaryStateLoaded(sessionId, roomId);
    expect(getThreadSummaryStateSnapshot(sessionId, roomId).get('$root')?.summaryText).toBe(
      'Accepted human title'
    );
  }
);
