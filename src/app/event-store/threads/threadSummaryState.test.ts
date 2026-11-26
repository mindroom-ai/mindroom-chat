import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThreadSummaryInfo } from '../../matrix/protocol/threadSummary';
import { loadCachedThreadSummaries, saveCachedThreadSummary } from '../cache/db';
import {
  clearThreadSummarySharedState,
  ensureThreadSummaryStateLoaded,
  forgetRedactedThreadSummaries,
  getThreadSummaryStateSnapshot,
  storeThreadSummaryInState,
} from './threadSummaryState';

vi.mock('../cache/db', () => ({
  loadCachedThreadSummaries: vi.fn().mockResolvedValue(new Map()),
  saveCachedThreadSummary: vi.fn().mockResolvedValue(undefined),
}));

describe('threadSummaryState cleanup', () => {
  beforeEach(() => {
    clearThreadSummarySharedState();
    vi.mocked(loadCachedThreadSummaries).mockReset().mockResolvedValue(new Map());
    vi.mocked(saveCachedThreadSummary).mockReset().mockResolvedValue(undefined);
  });

  it('evicts only the removed session so re-adding it cannot reuse stale summaries', () => {
    const summary = {
      summaryText: 'stale summary',
      generatedTs: 1,
      messageCount: 1,
    };
    storeThreadSummaryInState('session-a', '!room:example.org', '$thread-a', summary);
    storeThreadSummaryInState('session-b', '!room:example.org', '$thread-b', summary);

    clearThreadSummarySharedState('session-a');

    expect(getThreadSummaryStateSnapshot('session-a', '!room:example.org')).toEqual(new Map());
    expect(getThreadSummaryStateSnapshot('session-b', '!room:example.org').has('$thread-b')).toBe(
      true
    );
  });

  it('keeps titles redacted during an in-flight cache load from appearing when decryption resolves', async () => {
    let resolveLoad!: (value: Map<string, ThreadSummaryInfo>) => void;
    vi.mocked(loadCachedThreadSummaries).mockReturnValueOnce(
      new Promise<Map<string, ThreadSummaryInfo>>((resolve) => {
        resolveLoad = resolve;
      })
    );

    const sessionId = 'session-redacted-race';
    const roomId = '!encrypted:example.org';
    const pending = ensureThreadSummaryStateLoaded(sessionId, roomId);

    // Live candidate arrives during load on a second thread, then both get redacted before load resolves.
    storeThreadSummaryInState(sessionId, roomId, '$thread-live', {
      summaryText: 'Live withdrawn title',
      eventId: '$sum-live-redacted',
      eventTs: 2000,
    });
    forgetRedactedThreadSummaries(
      sessionId,
      roomId,
      new Set(['$sum-cached-redacted', '$sum-live-redacted'])
    );

    resolveLoad(
      new Map([
        [
          '$thread-cached',
          { summaryText: 'Cached withdrawn title', eventId: '$sum-cached-redacted', eventTs: 1000 },
        ],
        [
          '$thread-kept',
          { summaryText: 'Retained harbor title', eventId: '$sum-kept', eventTs: 1000 },
        ],
      ])
    );
    await pending;

    const snapshot = getThreadSummaryStateSnapshot(sessionId, roomId);
    expect(snapshot.has('$thread-cached')).toBe(false);
    expect(snapshot.has('$thread-live')).toBe(false);
    expect(snapshot.get('$thread-kept')?.summaryText).toBe('Retained harbor title');
    expect(saveCachedThreadSummary).not.toHaveBeenCalled();
  });

  it('drops edited titles when forgetRedactedThreadSummaries receives their replacingEventId', async () => {
    const sessionId = 'session-edit-redacted';
    const loadedRoomId = '!loaded-room:example.org';
    await ensureThreadSummaryStateLoaded(sessionId, loadedRoomId);

    storeThreadSummaryInState(sessionId, loadedRoomId, '$thread-edited', {
      summaryText: 'Edited withdrawn title',
      eventId: '$base-1',
      replacingEventId: '$edit-1',
      eventTs: 2000,
    });
    storeThreadSummaryInState(sessionId, loadedRoomId, '$thread-other', {
      summaryText: 'Other edited title',
      eventId: '$base-2',
      replacingEventId: '$edit-2',
      eventTs: 2000,
    });

    forgetRedactedThreadSummaries(sessionId, loadedRoomId, new Set(['$edit-1']));

    const loadedSnapshot = getThreadSummaryStateSnapshot(sessionId, loadedRoomId);
    expect(loadedSnapshot.has('$thread-edited')).toBe(false);
    expect(loadedSnapshot.get('$thread-other')?.summaryText).toBe('Other edited title');

    vi.mocked(saveCachedThreadSummary).mockClear();

    let resolveLoad!: (value: Map<string, ThreadSummaryInfo>) => void;
    vi.mocked(loadCachedThreadSummaries).mockReturnValueOnce(
      new Promise<Map<string, ThreadSummaryInfo>>((resolve) => {
        resolveLoad = resolve;
      })
    );

    const inflightRoomId = '!inflight-room:example.org';
    const pending = ensureThreadSummaryStateLoaded(sessionId, inflightRoomId);
    storeThreadSummaryInState(sessionId, inflightRoomId, '$thread-live-edited', {
      summaryText: 'Live edited withdrawn title',
      eventId: '$base-live',
      replacingEventId: '$edit-live',
      eventTs: 2000,
    });
    forgetRedactedThreadSummaries(
      sessionId,
      inflightRoomId,
      new Set(['$edit-cached', '$edit-live'])
    );

    resolveLoad(
      new Map([
        [
          '$thread-cached-edited',
          {
            summaryText: 'Cached edited withdrawn title',
            eventId: '$base-cached',
            replacingEventId: '$edit-cached',
            eventTs: 1500,
          },
        ],
        [
          '$thread-kept-edited',
          {
            summaryText: 'Retained edited title',
            eventId: '$base-kept',
            replacingEventId: '$edit-kept',
            eventTs: 1500,
          },
        ],
      ])
    );
    await pending;

    const inflightSnapshot = getThreadSummaryStateSnapshot(sessionId, inflightRoomId);
    expect(inflightSnapshot.has('$thread-cached-edited')).toBe(false);
    expect(inflightSnapshot.has('$thread-live-edited')).toBe(false);
    expect(inflightSnapshot.get('$thread-kept-edited')?.summaryText).toBe('Retained edited title');
    expect(saveCachedThreadSummary).not.toHaveBeenCalled();
  });
});
