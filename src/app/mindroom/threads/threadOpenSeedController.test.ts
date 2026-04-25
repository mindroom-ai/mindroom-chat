import { describe, expect, it, vi } from 'vitest';
import { RelationType } from 'matrix-js-sdk';
import {
  makeEvent,
  makeRoom,
} from '../../features/room/RoomTimeline.test.shared';
import { createThreadOpenSeedSession } from './threadOpenSeedController';
import { saveThreadOpenSeedSnapshot } from './threadOpenSeedCache';

const makeRefs = (threadId = '$root') => ({
  prewarmedThreadSeedIdsRef: { current: new Set<string>() },
  prewarmingThreadSeedIdsRef: { current: new Set<string>() },
  queuedThreadSeedIdsRef: { current: new Set<string>() },
  prewarmingThreadSeedPromisesRef: { current: new Map<string, Promise<void>>() },
  threadId,
});

describe('createThreadOpenSeedSession', () => {
  it('applies visible room thread events immediately for targeted opens', () => {
    const root = makeEvent('$root', { isThreadRoot: true, ts: 1 });
    const reply = makeEvent('$reply', { threadRootId: '$root', ts: 2 });
    const edit = makeEvent('$edit', {
      associatedId: '$reply',
      relation: { rel_type: RelationType.Replace, event_id: '$reply' },
      threadRootId: '$root',
      ts: 3,
    });
    const room = makeRoom({ liveEvents: [root, reply, edit] });
    const supplemental = vi.fn();
    const refs = makeRefs();

    const session = createThreadOpenSeedSession({
      debugTraceId: 'test',
      ensureThreadSeedPrewarm: vi.fn(),
      ...refs,
      room: room as never,
      roomTimelineSet: room.getUnfilteredTimelineSet() as never,
      setSupplementalThreadEvents: supplemental,
      shouldScrollToLatestOnOpen: false,
    });

    expect(session.applyInitialRoomThreadSeed()).toBe(true);
    expect(supplemental).toHaveBeenCalledWith('$root', [root, reply]);
    expect(session.initialRoomThreadSeedEvents.map((event) => event.getId())).toEqual([
      '$root',
      '$reply',
      '$edit',
    ]);
  });

  it('merges cached memory, thread model seed, and room seed for untargeted opens', () => {
    const cached = makeEvent('$cached', { threadRootId: '$root', ts: 0 });
    const root = makeEvent('$root', { isThreadRoot: true, ts: 1 });
    const reply = makeEvent('$reply', { threadRootId: '$root', ts: 2 });
    const room = makeRoom({ liveEvents: [root, reply] });
    saveThreadOpenSeedSnapshot(room as never, '$root', [cached] as never);
    const supplemental = vi.fn();
    const refs = makeRefs();

    const session = createThreadOpenSeedSession({
      debugTraceId: 'test',
      ensureThreadSeedPrewarm: vi.fn(),
      ...refs,
      room: room as never,
      roomTimelineSet: room.getUnfilteredTimelineSet() as never,
      setSupplementalThreadEvents: supplemental,
      shouldScrollToLatestOnOpen: true,
    });

    session.startUntargetedSeedPrewarmWait(() => true);

    expect(supplemental).toHaveBeenCalledWith(
      '$root',
      expect.arrayContaining([cached, root, reply])
    );
    expect(session.initialThreadMemorySeedEvents).toEqual([cached]);
  });
});
