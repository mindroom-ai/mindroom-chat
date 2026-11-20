import { createStore } from 'jotai';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingVoiceSendDraft } from '../roomInputDrafts';
import type { JournaledVoiceRecording, VoiceJournalRecord } from './voiceRecordingJournal';

const journal = vi.hoisted(() => ({
  adoptVoiceOrphans: vi.fn(),
  updateVoiceRecording: vi.fn(async () => true),
  deleteVoiceRecording: vi.fn(async () => undefined),
}));
vi.mock('./voiceRecordingJournal', () => journal);

type Drafts = typeof import('./voiceDrafts');

const ALICE = '@alice:example.org';
const BOB = '@bob:example.org';
const NOW = 50_000;
const room = { roomId: '!harbour:example.org', name: 'Harbour desk' } as Room;
const client = (userId = ALICE) =>
  ({
    getUserId: () => userId,
    getRoom: (roomId: string) => (roomId === room.roomId ? room : null),
  } as unknown as MatrixClient);

const orphan = (
  recordingId: string,
  changes: Partial<VoiceJournalRecord> = {}
): JournaledVoiceRecording => ({
  record: { userId: ALICE, recordingId, startedAt: 1_000, mimeType: 'audio/webm', ...changes },
  file: new File([recordingId], `${recordingId}.webm`, { type: 'audio/webm' }),
  duration: 4_200,
  waveform: [1, 4, 2],
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
  ...(token && { inFlight: { token, startedAt: NOW } }),
});

/** A page, with its own modules. */
const openPage = async () => {
  vi.resetModules();
  const drafts: Drafts = await import('./voiceDrafts');
  const atoms = await import('../roomInputDrafts');
  const store = createStore();
  const ids = (list: { recordingId: string }[]) => list.map((entry) => entry.recordingId);
  return {
    drafts,
    store,
    ...atoms,
    slot: () => store.get(atoms.pendingVoiceSendDraftAtom),
    queued: () => ids(store.get(atoms.queuedVoiceDraftsAtom)),
    discarded: () => ids(store.get(atoms.discardedVoiceDraftsAtom).map((entry) => entry.draft)),
  };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  journal.adoptVoiceOrphans.mockReset().mockResolvedValue([]);
  journal.updateVoiceRecording.mockReset().mockResolvedValue(true);
  journal.deleteVoiceRecording.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('recovered voice recordings', () => {
  it('shows orphans one at a time, oldest first, and erases none while the slot is taken', async () => {
    const { drafts, store, pendingVoiceSendDraftAtom, slot, queued } = await openPage();
    journal.adoptVoiceOrphans.mockResolvedValue([orphan('rec-older'), orphan('rec-newer')]);
    await drafts.recoverVoiceDrafts(client(), store);
    expect(journal.adoptVoiceOrphans).toHaveBeenCalledExactlyOnceWith(ALICE);
    expect(slot()).toBeUndefined();

    drafts.offerQueuedVoiceDraft(store, ALICE);
    const shown = slot();
    // No destination and no error: "Recovered recording", with Send and Discard.
    expect(shown).toEqual({
      recordingId: 'rec-older',
      file: expect.any(File),
      duration: 4_200,
      waveform: [1, 4, 2],
      txnId: undefined,
      context: { ownerSessionId: ALICE },
    });
    drafts.offerQueuedVoiceDraft(store, ALICE);
    expect(slot()).toBe(shown);
    expect(queued()).toEqual(['rec-newer']);

    // The first is sent or discarded: the next takes the slot.
    store.set(pendingVoiceSendDraftAtom, undefined);
    drafts.offerQueuedVoiceDraft(store, ALICE);
    expect(slot()?.recordingId).toBe('rec-newer');
    expect(queued()).toEqual([]);
    expect(journal.deleteVoiceRecording).not.toHaveBeenCalled();
  });

  it('looks again whenever the page comes back to the front, for what lost its tab since', async () => {
    const page = new EventTarget();
    vi.stubGlobal('addEventListener', page.addEventListener.bind(page));
    vi.stubGlobal('removeEventListener', page.removeEventListener.bind(page));
    const { drafts, store, queued } = await openPage();
    const stop = drafts.keepRecoveringVoiceDrafts(client(), store);
    await vi.waitFor(() => expect(journal.adoptVoiceOrphans).toHaveBeenCalledTimes(1));
    expect(queued()).toEqual([]);

    // Another tab was recording then, and is closed now.
    journal.adoptVoiceOrphans.mockResolvedValueOnce([orphan('rec-other-tab')]);
    page.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(queued()).toEqual(['rec-other-tab']));
    page.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(journal.adoptVoiceOrphans).toHaveBeenCalledTimes(3));
    expect(queued()).toEqual(['rec-other-tab']);

    stop();
    page.dispatchEvent(new Event('focus'));
    expect(journal.adoptVoiceOrphans).toHaveBeenCalledTimes(3);
  });

  it('waits while a recorder is open, and offers a recording only to its account', async () => {
    const { drafts, store, openVoiceRecorderAtom, queuedVoiceDraftsAtom, slot, queued } =
      await openPage();
    store.set(queuedVoiceDraftsAtom, [draft('rec-bob', BOB), draft('rec-alice')]);
    store.set(openVoiceRecorderAtom, Symbol('recorder'));
    drafts.offerQueuedVoiceDraft(store, ALICE);
    expect(slot()).toBeUndefined();
    store.set(openVoiceRecorderAtom, undefined);
    drafts.offerQueuedVoiceDraft(store, ALICE);
    expect(slot()?.recordingId).toBe('rec-alice');
    expect(queued()).toEqual(['rec-bob']);
  });

  it('parks a mid-send orphan at its destination with Retry, under its txnId', async () => {
    const { drafts, store, queuedVoiceDraftsAtom } = await openPage();
    const destination = {
      roomId: room.roomId,
      threadId: '$thread',
      replyEventId: '$reply',
      replyThreadId: '$thread',
      threadingEnabled: true,
      threadView: true,
    };
    journal.adoptVoiceOrphans.mockResolvedValue([
      orphan('rec-crashed', { destination, txnId: 'txn-before-crash' }),
    ]);
    await drafts.recoverVoiceDrafts(client(), store);
    expect(store.get(queuedVoiceDraftsAtom)).toEqual([
      {
        recordingId: 'rec-crashed',
        file: expect.any(File),
        duration: 4_200,
        waveform: [1, 4, 2],
        txnId: 'txn-before-crash',
        errorMessage: 'Sending this voice message was interrupted.',
        context: {
          ownerSessionId: ALICE,
          roomId: room.roomId,
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
          threadView: true,
        },
      },
    ]);
  });

  it('shows an orphan in every composer when its room is gone', async () => {
    const { drafts, store, queuedVoiceDraftsAtom } = await openPage();
    journal.adoptVoiceOrphans.mockResolvedValue([
      orphan('rec-left', {
        destination: { roomId: '!left:example.org', threadingEnabled: true },
        txnId: 'txn-left',
      }),
    ]);
    await drafts.recoverVoiceDrafts(client(), store);
    const [recovered] = store.get(queuedVoiceDraftsAtom);
    expect(recovered).toMatchObject({ recordingId: 'rec-left', txnId: 'txn-left' });
    expect(recovered!.context).toEqual({ ownerSessionId: ALICE });
    expect(recovered!.errorMessage).toBeUndefined();
  });

  it('offers Undo again for a discard that still has time, and lets it stand when that is up', async () => {
    const { drafts, store, slot, queued, discarded } = await openPage();
    journal.adoptVoiceOrphans.mockResolvedValue([
      orphan('rec-discarded', { discardUntil: NOW + 4_000 }),
    ]);
    await drafts.recoverVoiceDrafts(client(), store);
    drafts.offerQueuedVoiceDraft(store, ALICE);
    // Not back as a recording to send: back as a discard to undo.
    expect([slot(), queued(), discarded()]).toEqual([undefined, [], ['rec-discarded']]);

    await vi.advanceTimersByTimeAsync(3_999);
    expect(discarded()).toEqual(['rec-discarded']);
    expect(journal.deleteVoiceRecording).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(discarded()).toEqual([]);
    expect(journal.deleteVoiceRecording).toHaveBeenCalledExactlyOnceWith(
      'rec-discarded',
      NOW + 4_000
    );
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
    expect(journal.deleteVoiceRecording).not.toHaveBeenCalled();
  });

  it('brings a discard back only once the disk no longer says it is discarded', async () => {
    const { drafts, store, slot, queued, discarded } = await openPage();
    const recording = draft('rec-1');
    drafts.discardVoiceDraft(store, recording);
    expect(discarded()).toEqual(['rec-1']);
    expect(journal.updateVoiceRecording).toHaveBeenLastCalledWith('rec-1', {
      discardUntil: NOW + 10_000,
    });

    let commit!: (kept: boolean) => void;
    journal.updateVoiceRecording.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        commit = resolve;
      })
    );
    const undone = drafts.undoVoiceDiscard(store, 'rec-1');
    // Undo is taken, and cannot be pressed twice; the recording is not back yet.
    expect(discarded()).toEqual([]);
    expect(queued()).toEqual([]);
    expect(journal.updateVoiceRecording).toHaveBeenLastCalledWith('rec-1', {
      discardUntil: undefined,
    });
    commit(true);
    await undone;
    drafts.offerQueuedVoiceDraft(store, ALICE);
    expect(slot()).toBe(recording);

    // Its ten seconds end: the disk, which no longer says discarded, decides what is deleted.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(slot()).toBe(recording);
    expect(journal.deleteVoiceRecording).toHaveBeenCalledExactlyOnceWith('rec-1', NOW + 10_000);
  });

  it('brings a discard back from memory, and says so, when the disk could not be told', async () => {
    const { drafts, store, queuedVoiceDraftsAtom } = await openPage();
    const recording = draft('rec-1');
    drafts.discardVoiceDraft(store, recording);
    journal.updateVoiceRecording.mockResolvedValueOnce(false);
    await drafts.undoVoiceDiscard(store, 'rec-1');
    expect(store.get(queuedVoiceDraftsAtom)).toEqual([{ ...recording, unprotected: true }]);
    // Nothing is left to undo.
    await drafts.undoVoiceDiscard(store, 'rec-1');
    expect(store.get(queuedVoiceDraftsAtom)).toHaveLength(1);
  });

  it('gives each discard its own ten seconds', async () => {
    const { drafts, store, discarded } = await openPage();
    drafts.discardVoiceDraft(store, draft('rec-1'));
    await vi.advanceTimersByTimeAsync(1_000);
    drafts.discardVoiceDraft(store, draft('rec-2'));
    // The second does not end the first one's Undo early.
    expect(discarded()).toEqual(['rec-1', 'rec-2']);
    expect(journal.deleteVoiceRecording).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(9_000);
    expect(discarded()).toEqual(['rec-2']);
    expect(journal.deleteVoiceRecording.mock.calls).toEqual([['rec-1', NOW + 10_000]]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(discarded()).toEqual([]);
    expect(journal.deleteVoiceRecording.mock.calls[1]).toEqual(['rec-2', NOW + 11_000]);
  });

  it('keeps a recording that was undone and discarded again until its second time is up', async () => {
    const { drafts, store, discarded } = await openPage();
    const recording = draft('rec-1');
    drafts.discardVoiceDraft(store, recording);
    await drafts.undoVoiceDiscard(store, 'rec-1');
    await vi.advanceTimersByTimeAsync(5_000);
    drafts.discardVoiceDraft(store, recording);

    // The first discard's time: Undo is still offered.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(discarded()).toEqual(['rec-1']);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(discarded()).toEqual([]);
    expect(journal.deleteVoiceRecording).toHaveBeenLastCalledWith('rec-1', NOW + 15_000);
  });
});
