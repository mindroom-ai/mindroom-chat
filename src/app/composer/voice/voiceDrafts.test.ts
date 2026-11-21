import { createStore } from 'jotai';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingVoiceSendContext, PendingVoiceSendDraft } from '../roomInputDrafts';
import type {
  JournaledVoiceRecording,
  VoiceJournalDestination,
  VoiceJournalRecord,
  VoiceTransitionOutcome,
} from './voiceRecordingJournal';

/** The disk as the journal keeps it: a recording goes only by a delete that commits. */
const disk = vi.hoisted(() => {
  const state: {
    deleted: string[];
    /** What every write comes to, until a test says otherwise. */
    outcome: VoiceTransitionOutcome;
    /** Set to hold the next write until it is called. */
    hold?: Promise<void>;
  } = { deleted: [], outcome: 'committed' };
  return state;
});
const journal = vi.hoisted(() => ({
  adoptVoiceOrphans: vi.fn(),
  transitionVoiceRecording: vi.fn(
    async (
      recordingId: string,
      change: (record: object) => object | undefined = (kept) => kept
    ) => {
      const { outcome, hold } = disk;
      disk.hold = undefined;
      await hold;
      if (outcome === 'committed' && !change({ recordingId })) disk.deleted.push(recordingId);
      return outcome;
    }
  ),
}));
vi.mock('./voiceRecordingJournal', () => journal);
const unsent = vi.hoisted(() => ({ unsentVoiceCopy: vi.fn() }));
vi.mock('../../matrix/client/unsentMessages', () => unsent);
/** Holds the next write to the disk; the returned function lets it go on. */
const holdNextWrite = () => {
  let release!: () => void;
  disk.hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  return release;
};

type Drafts = typeof import('./voiceDrafts');

const ALICE = '@alice:example.org';
const BOB = '@bob:example.org';
const HARBOUR = '!harbour:example.org';

/** An account as the page knows it: its rooms, and whether the server was heard yet. */
const account = (userId = ALICE) => {
  const state = { synced: true, membership: 'join', encrypted: false, loaded: true };
  const room = {
    roomId: HARBOUR,
    name: 'Harbour desk',
    getMyMembership: () => state.membership,
    hasEncryptionStateEvent: () => state.encrypted,
  } as unknown as Room;
  const listeners = new Map<string, () => void>();
  const mx = {
    getUserId: () => userId,
    getRoom: (roomId: string) => (state.loaded && roomId === HARBOUR ? room : null),
    isInitialSyncComplete: () => state.synced,
    on: (event: string, listener: () => void) => listeners.set(event, listener),
    removeListener: (event: string) => listeners.delete(event),
  } as unknown as MatrixClient;
  return { mx, room, state, sync: () => listeners.get('sync')?.() };
};

const destination: VoiceJournalDestination = {
  roomId: HARBOUR,
  threadId: '$thread',
  replyEventId: '$reply',
  replyThreadId: '$thread',
  threadingEnabled: true,
  threadView: true,
  encrypted: false,
};

const orphan = (
  recordingId: string,
  changes: Partial<VoiceJournalRecord> = {}
): JournaledVoiceRecording => ({
  record: { userId: ALICE, recordingId, startedAt: 1_000, mimeType: 'audio/webm', ...changes },
  file: new File([recordingId], `${recordingId}.webm`, { type: 'audio/webm' }),
  duration: 4_200,
});

const draft = (
  recordingId: string,
  ownerSessionId = ALICE,
  token?: string
): PendingVoiceSendDraft => ({
  recordingId,
  file: new File([recordingId], `${recordingId}.webm`, { type: 'audio/webm' }),
  duration: 900,
  context: { ownerSessionId },
  ...(token && { inFlight: { token } }),
});

/** A page, with its own modules. */
const openPage = async () => {
  vi.resetModules();
  const drafts: Drafts = await import('./voiceDrafts');
  const atoms = await import('../roomInputDrafts');
  const store = createStore();
  return {
    drafts,
    store,
    ...atoms,
    slot: () => store.get(atoms.pendingVoiceSendDraftAtom),
    queued: () => store.get(atoms.queuedVoiceDraftsAtom).map((entry) => entry.recordingId),
  };
};

beforeEach(() => {
  journal.adoptVoiceOrphans.mockReset().mockResolvedValue([]);
  journal.transitionVoiceRecording.mockClear();
  unsent.unsentVoiceCopy.mockReset();
  disk.deleted = [];
  disk.outcome = 'committed';
  disk.hold = undefined;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('recovered voice recordings', () => {
  it('shows orphans one at a time, oldest first, and erases none while the slot is taken', async () => {
    const { drafts, store, pendingVoiceSendDraftAtom, slot, queued } = await openPage();
    const { mx } = account();
    journal.adoptVoiceOrphans.mockResolvedValue([orphan('rec-older'), orphan('rec-newer')]);
    await drafts.recoverVoiceDrafts(mx, store);
    expect(journal.adoptVoiceOrphans).toHaveBeenCalledExactlyOnceWith(ALICE, expect.any(Function));
    expect(slot()).toBeUndefined();

    drafts.reconcileVoiceDrafts(mx, store);
    const shown = slot();
    // No destination and no error: "Recovered recording", with Send and Discard.
    expect(shown).toEqual({
      recordingId: 'rec-older',
      file: expect.any(File),
      duration: 4_200,
      txnId: undefined,
      context: { ownerSessionId: ALICE, attempted: undefined },
    });
    drafts.reconcileVoiceDrafts(mx, store);
    expect(slot()).toBe(shown);
    expect(queued()).toEqual(['rec-newer']);

    // The first is sent or discarded: the next takes the slot.
    store.set(pendingVoiceSendDraftAtom, undefined);
    drafts.reconcileVoiceDrafts(mx, store);
    expect(slot()?.recordingId).toBe('rec-newer');
    expect(queued()).toEqual([]);
    expect(disk.deleted).toEqual([]);
  });

  it('asks the unsent messages for a copy an older version kept of the same send', async () => {
    const { drafts, store } = await openPage();
    const { mx } = account();
    await drafts.recoverVoiceDrafts(mx, store);
    const copy = { txnId: 'txn-old', forget: () => undefined };
    unsent.unsentVoiceCopy.mockReturnValue(copy);
    const lookUp = journal.adoptVoiceOrphans.mock.calls[0]![1];
    expect(lookUp(HARBOUR, 4_096)).toBe(copy);
    expect(unsent.unsentVoiceCopy).toHaveBeenCalledExactlyOnceWith(mx, HARBOUR, 4_096);
  });

  it('looks again whenever the page comes back to the front, and brings the slot in line with every sync', async () => {
    const page = new EventTarget();
    vi.stubGlobal('addEventListener', page.addEventListener.bind(page));
    vi.stubGlobal('removeEventListener', page.removeEventListener.bind(page));
    const { drafts, store, slot, queued } = await openPage();
    const { mx, sync } = account();
    const stop = drafts.keepRecoveringVoiceDrafts(mx, store);
    await vi.waitFor(() => expect(journal.adoptVoiceOrphans).toHaveBeenCalledTimes(1));
    expect(queued()).toEqual([]);

    // Another tab was recording then, and is closed now.
    journal.adoptVoiceOrphans.mockResolvedValueOnce([orphan('rec-other-tab')]);
    page.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(queued()).toEqual(['rec-other-tab']));
    page.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(journal.adoptVoiceOrphans).toHaveBeenCalledTimes(3));
    expect(queued()).toEqual(['rec-other-tab']);
    sync();
    expect(slot()?.recordingId).toBe('rec-other-tab');

    stop();
    page.dispatchEvent(new Event('focus'));
    expect(journal.adoptVoiceOrphans).toHaveBeenCalledTimes(3);
    store.set((await import('../roomInputDrafts')).pendingVoiceSendDraftAtom, undefined);
    expect(sync()).toBeUndefined();
  });

  it('waits while a recorder is open, and offers a recording only to its account', async () => {
    const { drafts, store, openVoiceRecorderAtom, queuedVoiceDraftsAtom, slot, queued } =
      await openPage();
    const { mx } = account();
    store.set(queuedVoiceDraftsAtom, [draft('rec-bob', BOB), draft('rec-alice')]);
    store.set(openVoiceRecorderAtom, Symbol('recorder'));
    drafts.reconcileVoiceDrafts(mx, store);
    expect(slot()).toBeUndefined();
    store.set(openVoiceRecorderAtom, undefined);
    drafts.reconcileVoiceDrafts(mx, store);
    expect(slot()?.recordingId).toBe('rec-alice');
    expect(queued()).toEqual(['rec-bob']);
  });

  it('moves another account’s recording out of the slot once, however many composers ask', async () => {
    const { drafts, store, pendingVoiceSendDraftAtom, queuedVoiceDraftsAtom, slot, queued } =
      await openPage();
    // Alice's recording shows, Bob's waits, and Bob becomes the account.
    const hers = draft('rec-alice');
    const his = draft('rec-bob', BOB);
    store.set(pendingVoiceSendDraftAtom, hers);
    store.set(queuedVoiceDraftsAtom, [his]);
    const { mx } = account(BOB);
    // Two composers are mounted, and both saw Alice's recording in the slot.
    drafts.reconcileVoiceDrafts(mx, store);
    drafts.reconcileVoiceDrafts(mx, store);
    expect(slot()).toBe(his);
    expect(queued()).toEqual(['rec-alice']);
    // Back to Alice: hers again, and his waits.
    const alice = account(ALICE);
    drafts.reconcileVoiceDrafts(alice.mx, store);
    drafts.reconcileVoiceDrafts(alice.mx, store);
    expect(slot()).toBe(hers);
    expect(queued()).toEqual(['rec-bob']);
  });
});

describe('a recording whose send was attempted', () => {
  const recovered = async (changes: Partial<VoiceJournalRecord>, of = account()) => {
    const page = await openPage();
    journal.adoptVoiceOrphans.mockResolvedValue([orphan('rec-crashed', changes)]);
    await page.drafts.recoverVoiceDrafts(of.mx, page.store);
    const reconcile = () => page.drafts.reconcileVoiceDrafts(of.mx, page.store);
    reconcile();
    return { ...page, ...of, reconcile };
  };
  const placed = (room: Room): PendingVoiceSendContext => ({
    ownerSessionId: ALICE,
    roomId: HARBOUR,
    room,
    threadId: '$thread',
    // The IDs of what it replies to are all the journal kept, and all its send needs.
    replyDraft: {
      userId: '',
      eventId: '$reply',
      body: '',
      relation: { rel_type: 'm.thread', event_id: '$thread' },
    },
    threadingEnabled: true,
    signalBridgedRoom: false,
    encrypted: false,
    threadView: true,
  });

  it('waits at its destination with Retry, under its txnId', async () => {
    const { slot, room } = await recovered({ destination, txnId: 'txn-before-crash' });
    expect(slot()).toEqual({
      recordingId: 'rec-crashed',
      file: expect.any(File),
      duration: 4_200,
      txnId: 'txn-before-crash',
      errorMessage: 'Sending this voice message was interrupted.',
      context: placed(room),
    });
  });

  it('keeps its destination while its room is not loaded yet, and goes there once the server was heard', async () => {
    const before = account();
    before.state.synced = false;
    before.state.loaded = false;
    const { slot, queued, state, room, reconcile, store, queuedVoiceDraftsAtom } = await recovered(
      { destination, txnId: 'txn-before-crash' },
      before
    );
    // Not shown yet: nothing can say that its room is gone, so no copy is offered.
    expect([slot(), queued()]).toEqual([undefined, ['rec-crashed']]);
    expect(store.get(queuedVoiceDraftsAtom)[0]!.context).toEqual({
      ownerSessionId: ALICE,
      attempted: destination,
    });

    state.synced = true;
    state.loaded = true;
    reconcile();
    expect(slot()).toMatchObject({ txnId: 'txn-before-crash', context: placed(room) });
    expect(queued()).toEqual([]);
  });

  it('offers a copy only once the server was heard and its room is still not there', async () => {
    const before = account();
    before.state.synced = false;
    before.state.loaded = false;
    const { slot, state, reconcile } = await recovered({ destination, txnId: 'txn-1' }, before);
    expect(slot()).toBeUndefined();
    state.synced = true;
    reconcile();
    // "May already be sent to another room", with "Send a copy here".
    expect(slot()).toMatchObject({
      txnId: 'txn-1',
      context: { ownerSessionId: ALICE, attempted: destination },
    });
    expect(slot()!.errorMessage).toBeUndefined();
  });

  it('goes back to its room when the account joins it again, under the same txnId', async () => {
    const { slot, state, room, reconcile } = await recovered({ destination, txnId: 'txn-1' });
    const there = slot();
    reconcile();
    // Nothing changed: the same draft, so nothing renders again.
    expect(slot()).toBe(there);

    state.membership = 'leave';
    reconcile();
    const left = slot();
    expect(left).toMatchObject({
      txnId: 'txn-1',
      errorMessage: undefined,
      context: { ownerSessionId: ALICE, attempted: { ...destination, roomName: 'Harbour desk' } },
    });
    reconcile();
    expect(slot()).toBe(left);
    // Offline, nothing says otherwise: it stays as it is.
    state.synced = false;
    reconcile();
    expect(slot()).toBe(left);

    state.synced = true;
    state.membership = 'join';
    reconcile();
    expect(slot()).toMatchObject({
      txnId: 'txn-1',
      errorMessage: 'Sending this voice message was interrupted.',
      context: placed(room),
    });
  });

  it('is not retried under its txnId in a room that was encrypted since: it may be sent, and a copy is offered', async () => {
    const { slot, state, reconcile } = await recovered({ destination, txnId: 'txn-plain' });
    expect(slot()!.context.roomId).toBe(HARBOUR);
    state.encrypted = true;
    reconcile();
    expect(slot()!.context).toEqual({
      ownerSessionId: ALICE,
      attempted: { ...destination, roomName: 'Harbour desk' },
    });
  });

  it('leaves a recording that is being sent or deleted where it is', async () => {
    const { slot, state, reconcile, store, pendingVoiceSendDraftAtom } = await recovered({
      destination,
      txnId: 'txn-1',
    });
    const sending = { ...slot()!, inFlight: { token: 'try-1' } };
    store.set(pendingVoiceSendDraftAtom, sending);
    state.membership = 'leave';
    reconcile();
    expect(slot()).toBe(sending);
  });

  it('is only a recording when its send never began: one an older version kept, or one that failed before', async () => {
    // An older version's: a destination, and nothing that says how it went out.
    const { encrypted, ...legacy } = destination;
    const gone = account();
    gone.state.loaded = false;
    const old = await recovered({ destination: legacy }, gone);
    expect(old.slot()!.context).toEqual({ ownerSessionId: ALICE, attempted: undefined });

    // Its room is there: Retry there, as that version offered.
    const there = await recovered({ destination: legacy });
    expect(there.slot()).toMatchObject({
      errorMessage: 'Sending this voice message was interrupted.',
      context: { roomId: HARBOUR, encrypted: undefined },
    });
    // This page's, whose send stopped before its destination was written: its room is left.
    there.state.membership = 'leave';
    there.reconcile();
    expect(there.slot()!.context).toEqual({ ownerSessionId: ALICE, attempted: undefined });
  });
});

describe('a send that ends after its recording moved', () => {
  it('ends a retry whose recording waits in the queue by then, and leaves the slot alone', async () => {
    const { drafts, store, pendingVoiceSendDraftAtom, queuedVoiceDraftsAtom, slot, queued } =
      await openPage();
    // Bob's retry was on its way when Alice became the account: his draft left the slot.
    const other = draft('rec-alice');
    store.set(pendingVoiceSendDraftAtom, other);
    store.set(queuedVoiceDraftsAtom, [draft('rec-waiting', BOB), draft('rec-bob', BOB, 'try-1')]);

    const failed = { ...draft('rec-bob', BOB), errorMessage: 'offline' };
    drafts.settleVoiceDraft(store, 'rec-bob', 'try-1', failed);
    expect(slot()).toBe(other);
    expect(store.get(queuedVoiceDraftsAtom)[1]).toBe(failed);

    store.set(queuedVoiceDraftsAtom, [draft('rec-waiting', BOB), draft('rec-bob', BOB, 'try-2')]);
    drafts.settleVoiceDraft(store, 'rec-bob', 'try-2', undefined);
    expect(slot()).toBe(other);
    expect(queued()).toEqual(['rec-waiting']);
  });

  it('ends only the attempt it was given', async () => {
    const { drafts, store, pendingVoiceSendDraftAtom, slot, queued } = await openPage();
    const retried = draft('rec-1', ALICE, 'try-2');
    store.set(pendingVoiceSendDraftAtom, retried);
    drafts.settleVoiceDraft(store, 'rec-1', 'try-1', undefined);
    drafts.settleVoiceDraft(store, 'rec-1', 'try-1', { ...draft('rec-1'), errorMessage: 'late' });
    drafts.settleVoiceDraft(store, 'rec-other', 'try-2', undefined);
    expect(slot()).toBe(retried);
    expect(queued()).toEqual([]);
  });

  it('gives a failed first attempt the free slot, and has it wait when another recording took it', async () => {
    const { drafts, store, pendingVoiceSendDraftAtom, slot, queued } = await openPage();
    const failed = { ...draft('rec-1'), errorMessage: 'offline' };
    drafts.settleVoiceDraft(store, 'rec-1', undefined, failed);
    expect(slot()).toBe(failed);

    // Its recorder's composer went while it was sending, and a recovered recording took the slot.
    const recovered = draft('rec-recovered');
    store.set(pendingVoiceSendDraftAtom, recovered);
    const late = { ...draft('rec-2'), errorMessage: 'offline' };
    drafts.settleVoiceDraft(store, 'rec-2', undefined, late);
    expect(slot()).toBe(recovered);
    expect(queued()).toEqual(['rec-2']);
    // Sent, it has nothing to clear.
    drafts.settleVoiceDraft(store, 'rec-3', undefined, undefined);
    expect(slot()).toBe(recovered);
  });
});

describe('unsent and discarded voice recordings', () => {
  it('parks unsent audio first in line', async () => {
    const { drafts, store, queuedVoiceDraftsAtom, queued } = await openPage();
    store.set(queuedVoiceDraftsAtom, [draft('rec-recovered')]);
    drafts.parkVoiceDraft(store, draft('rec-stopped'));
    expect(queued()).toEqual(['rec-stopped', 'rec-recovered']);
    expect(disk.deleted).toEqual([]);
  });

  it.each([
    ['committed', false],
    ['failed', true],
    ['absent', true],
  ] as const)(
    'parks what a recorder left once the disk was asked for all of it: %s',
    async (outcome, unprotected) => {
      const { drafts, store, queuedVoiceDraftsAtom } = await openPage();
      disk.outcome = outcome;
      const release = holdNextWrite();
      const stopped = draft('rec-stopped');
      const kept = drafts.keepVoiceDraft(store, stopped);
      await Promise.resolve();
      expect(store.get(queuedVoiceDraftsAtom)).toEqual([]);
      release();
      await kept;
      // It says it is saved only if the disk holds it.
      expect(store.get(queuedVoiceDraftsAtom)).toEqual([{ ...stopped, unprotected }]);
    }
  );

  it('deletes a confirmed discard at once, and takes the slot’s recording until that is done', async () => {
    const { drafts, store, pendingVoiceSendDraftAtom, slot, queued } = await openPage();
    const recording = draft('rec-1');
    store.set(pendingVoiceSendDraftAtom, recording);
    const release = holdNextWrite();
    const discarding = drafts.discardVoiceDraft(store, recording);
    // Taken before anything was awaited: nothing sends it, and it shows as busy.
    const taken = slot()!;
    expect(taken).toEqual({ ...recording, inFlight: { token: expect.any(String), discard: true } });
    // Discard pressed again, on what the slot holds now: once is enough.
    await drafts.discardVoiceDraft(store, taken);
    expect(journal.transitionVoiceRecording).toHaveBeenCalledTimes(1);
    expect(disk.deleted).toEqual([]);

    release();
    await discarding;
    expect([slot(), queued(), disk.deleted]).toEqual([undefined, [], ['rec-1']]);
  });

  it('never deletes a recording that is being sent', async () => {
    const { drafts, store, pendingVoiceSendDraftAtom, slot } = await openPage();
    const sending = draft('rec-1', ALICE, 'try-1');
    store.set(pendingVoiceSendDraftAtom, sending);
    await drafts.discardVoiceDraft(store, sending);
    expect(journal.transitionVoiceRecording).not.toHaveBeenCalled();
    expect(slot()).toBe(sending);
  });

  it('deletes what a recorder stopped for a discard without showing it', async () => {
    const { drafts, store, slot, queued } = await openPage();
    await drafts.discardVoiceDraft(store, draft('rec-live'));
    expect([slot(), queued(), disk.deleted]).toEqual([undefined, [], ['rec-live']]);
  });

  it.each(['absent', 'committed'] as const)(
    'lets a recording go that the disk no longer holds, or never did: %s',
    async (outcome) => {
      const { drafts, store, pendingVoiceSendDraftAtom, slot } = await openPage();
      disk.outcome = outcome;
      const recording = draft('rec-1');
      store.set(pendingVoiceSendDraftAtom, recording);
      await drafts.discardVoiceDraft(store, recording);
      expect(slot()).toBeUndefined();
    }
  );

  it('keeps a recording the disk would not delete, and says so', async () => {
    const { drafts, store, pendingVoiceSendDraftAtom, queuedVoiceDraftsAtom, slot } =
      await openPage();
    disk.outcome = 'failed';
    const error = { errorMessage: "Couldn't delete the recording." };
    // The slot's recording stays in it, free again to discard or to send.
    const shown = draft('rec-shown');
    store.set(pendingVoiceSendDraftAtom, shown);
    await drafts.discardVoiceDraft(store, shown);
    expect(slot()).toEqual({ ...shown, ...error });
    // One discarded while it was recorded is not dropped: it waits for the slot.
    const live = draft('rec-live');
    await drafts.discardVoiceDraft(store, live);
    expect(store.get(queuedVoiceDraftsAtom)).toEqual([{ ...live, ...error }]);
    expect(disk.deleted).toEqual([]);

    // The next Discard reaches the disk.
    disk.outcome = 'committed';
    await drafts.discardVoiceDraft(store, slot()!);
    expect(slot()).toBeUndefined();
    expect(disk.deleted).toEqual(['rec-shown']);
  });
});
