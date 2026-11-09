import type { MatrixClient, Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CrossRoomThreadIndexEntry } from './crossRoomThreadIndex';
import type { ThreadSignals } from './threadSignals';
import { createThreadSignalsReader } from './threadSignalsReader';

const mocks = vi.hoisted(() => ({ read: vi.fn(), syncedEdit: vi.fn() }));
vi.mock('./threadSignals', () => ({ readThreadSignals: mocks.read }));
vi.mock('../../matrix/client/syncedEdits', () => ({ getSyncedEdit: mocks.syncedEdit }));

const NOW = Date.UTC(2026, 10, 9, 12);
const quiet: ThreadSignals = {
  mentionedMe: false,
  newCount: 0,
  newSenderIds: [],
  automation: false,
};

const entry = (generation = 1, isInvolved = true) =>
  ({
    key: 'k',
    roomId: '!r:x',
    threadRootId: '$root',
    generation,
    isInvolved,
  } as CrossRoomThreadIndexEntry);

const makeRoom = () => {
  const receipt = { eventId: '$a' };
  const thread = {
    events: [{ getId: () => '$a' }],
    getReadReceiptForUserId: () => receipt,
  };
  const reactions: unknown[] = [];
  const room = {
    getThread: () => thread,
    getReadReceiptForUserId: () => null,
    getUnfilteredTimelineSet: () => ({
      relations: {
        getChildEventsForEvent: () => ({ getRelations: () => reactions }),
      },
    }),
  } as unknown as Room;
  return { room, thread, reactions, receipt };
};

afterEach(() => {
  mocks.read.mockReset();
  mocks.syncedEdit.mockReset();
});

describe('createThreadSignalsReader', () => {
  it('reads a thread once while nothing about it changes', () => {
    mocks.read.mockReturnValue(quiet);
    const { room } = makeRoom();
    const reader = createThreadSignalsReader();
    reader.read(room, entry(), '@me:x', NOW);
    reader.read(room, entry(), '@me:x', NOW + 60_000);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    reader.read(room, entry(2), '@me:x', NOW);
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });

  it('reads again when the thread gains an event the index entry does not show', () => {
    mocks.read.mockReturnValue(quiet);
    const { room, thread } = makeRoom();
    const reader = createThreadSignalsReader();
    reader.read(room, entry(), '@me:x', NOW);
    thread.events.push({ getId: () => '$reaction' });
    reader.read(room, entry(), '@me:x', NOW);
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });

  it('reads again when the user reads further in the thread, also on another device', () => {
    mocks.read.mockReturnValue(quiet);
    const { room, receipt } = makeRoom();
    const reader = createThreadSignalsReader();
    reader.read(room, entry(), '@me:x', NOW);
    reader.read(room, entry(), '@me:x', NOW);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    receipt.eventId = '$b';
    reader.read(room, entry(), '@me:x', NOW);
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });

  it('reads again once a waiting approval has expired', () => {
    const approval = {
      eventId: '$ask',
      wireStatus: 'pending',
      approval: { status: 'pending', expiresAt: new Date(NOW + 30_000).toISOString() },
    };
    mocks.read.mockReturnValue({ ...quiet, pendingApproval: approval });
    const { room } = makeRoom();
    const reader = createThreadSignalsReader();
    reader.read(room, entry(), '@me:x', NOW);
    reader.read(room, entry(), '@me:x', NOW + 10_000);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    reader.read(room, entry(), '@me:x', NOW + 60_000);
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });

  it('reads again when the card of a waiting approval is edited outside the loaded thread', () => {
    const approval = {
      eventId: '$ask',
      wireStatus: 'pending',
      approval: { status: 'pending', expiresAt: new Date(NOW + 600_000).toISOString() },
    };
    mocks.read.mockReturnValue({ ...quiet, pendingApproval: approval });
    const { room } = makeRoom();
    const reader = createThreadSignalsReader();
    reader.read(room, entry(), '@me:x', NOW);
    reader.read(room, entry(), '@me:x', NOW);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    mocks.syncedEdit.mockImplementation((id: string) =>
      id === '$ask' ? { getId: () => '$ask-resolved' } : undefined
    );
    reader.read(room, entry(), '@me:x', NOW);
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });

  it('reads again when a reaction lands on the question it waits on', () => {
    mocks.read.mockReturnValue({
      ...quiet,
      pendingQuestion: { eventId: '$q', senderId: '@mindroom_a:x', text: 'q', options: [] },
    });
    const { room, reactions } = makeRoom();
    const reader = createThreadSignalsReader();
    reader.read(room, entry(), '@me:x', NOW);
    reactions.push({});
    reader.read(room, entry(), '@me:x', NOW);
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });

  it('asks the user only the questions of threads they take part in', () => {
    const question = { eventId: '$q', senderId: '@mindroom_a:x', text: 'q', options: [] };
    mocks.read.mockReturnValue({ ...quiet, pendingQuestion: question });
    const { room } = makeRoom();
    // Someone else's thread in a shared room: the agent asks them, not the user.
    expect(
      createThreadSignalsReader().read(room, entry(1, false), '@me:x', NOW).pendingQuestion
    ).toBeUndefined();
    expect(createThreadSignalsReader().read(room, entry(), '@me:x', NOW).pendingQuestion).toBe(
      question
    );
  });

  it('forgets threads the index no longer lists', () => {
    mocks.read.mockReturnValue(quiet);
    const { room } = makeRoom();
    const reader = createThreadSignalsReader();
    reader.read(room, entry(), '@me:x', NOW);
    reader.prune(new Set());
    reader.read(room, entry(), '@me:x', NOW);
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });

  it('keeps one reader per client', async () => {
    const { getThreadSignalsReader } = await import('./threadSignalsReader');
    const mx = {} as MatrixClient;
    expect(getThreadSignalsReader(mx)).toBe(getThreadSignalsReader(mx));
    expect(getThreadSignalsReader({} as MatrixClient)).not.toBe(getThreadSignalsReader(mx));
  });
});
