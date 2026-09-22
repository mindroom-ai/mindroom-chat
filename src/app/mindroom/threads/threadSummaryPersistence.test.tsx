import 'fake-indexeddb/auto';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { MatrixEvent, type Thread } from 'matrix-js-sdk';
import { expect, it } from 'vitest';
import { getMindroomThreadSummaryInfo } from '../messages/threadSummary';
import { loadCachedThreadSummaries, saveCachedThreadSummary } from './cacheStore';
import { useThreadSummaryPublishController } from './threadSummaryPublishController';
import {
  clearThreadSummarySharedState,
  ensureThreadSummaryStateLoaded,
  getThreadSummaryStateSnapshot,
  storeThreadSummaryInState,
} from './threadSummaryState';
import { useRoomThreadSummaryState } from './useRoomThreadSummaryState';

it('retains a newer disk title when partial live history publishes before initial hydration', async () => {
  const sessionId = 'summary-partial-history';
  const roomId = '!summary:test';
  await saveCachedThreadSummary(sessionId, roomId, '$root', {
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
  await saveCachedThreadSummary(sessionId, roomId, '$root', {
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
  'persists legacy-cache enrichment from the %s (initial cache read pending: %s)',
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
    await saveCachedThreadSummary(
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
