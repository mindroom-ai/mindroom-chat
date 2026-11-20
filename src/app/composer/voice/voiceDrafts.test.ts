import { createStore } from 'jotai';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingVoiceSendDraft } from '../roomInputDrafts';
import type { JournaledVoiceRecording, VoiceJournalRecord } from './voiceRecordingJournal';

const journal = vi.hoisted(() => ({
  adoptVoiceOrphans: vi.fn(),
  updateVoiceRecording: vi.fn(async () => undefined),
  deleteVoiceRecording: vi.fn(async () => undefined),
}));
vi.mock('./voiceRecordingJournal', () => journal);

type Drafts = typeof import('./voiceDrafts');

const ALICE = '@alice:example.org';
const BOB = '@bob:example.org';
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

const draft = (recordingId: string, ownerSessionId = ALICE): PendingVoiceSendDraft => ({
  recordingId,
  file: new File([recordingId], `${recordingId}.webm`, { type: 'audio/webm' }),
  duration: 900,
  context: { ownerSessionId },
});

/** A page, with its own modules: recovery runs once per account in each. */
const openPage = async () => {
  vi.resetModules();
  const drafts: Drafts = await import('./voiceDrafts');
  const atoms = await import('../roomInputDrafts');
  return { drafts, store: createStore(), ...atoms };
};

beforeEach(() => {
  journal.adoptVoiceOrphans.mockReset().mockResolvedValue([]);
  journal.updateVoiceRecording.mockClear();
  journal.deleteVoiceRecording.mockClear();
});

describe('recovered voice recordings', () => {
  it('shows orphans one at a time, oldest first, and erases none while the slot is taken', async () => {
    const { drafts, store, pendingVoiceSendDraftAtom, queuedVoiceDraftsAtom } = await openPage();
    journal.adoptVoiceOrphans.mockResolvedValue([orphan('rec-older'), orphan('rec-newer')]);
    await drafts.recoverVoiceDrafts(client(), store);
    expect(journal.adoptVoiceOrphans).toHaveBeenCalledExactlyOnceWith(ALICE);
    expect(store.get(pendingVoiceSendDraftAtom)).toBeUndefined();

    drafts.offerQueuedVoiceDraft(store, ALICE);
    const shown = store.get(pendingVoiceSendDraftAtom);
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
    expect(store.get(pendingVoiceSendDraftAtom)).toBe(shown);
    expect(store.get(queuedVoiceDraftsAtom).map((d) => d.recordingId)).toEqual(['rec-newer']);

    // The first is sent or discarded: the next takes the slot.
    store.set(pendingVoiceSendDraftAtom, undefined);
    drafts.offerQueuedVoiceDraft(store, ALICE);
    expect(store.get(pendingVoiceSendDraftAtom)?.recordingId).toBe('rec-newer');
    expect(store.get(queuedVoiceDraftsAtom)).toEqual([]);
    expect(journal.deleteVoiceRecording).not.toHaveBeenCalled();
  });

  it('recovers once per account and page', async () => {
    const { drafts, store } = await openPage();
    await drafts.recoverVoiceDrafts(client(), store);
    await drafts.recoverVoiceDrafts(client(), store);
    await drafts.recoverVoiceDrafts(client(BOB), store);
    expect(journal.adoptVoiceOrphans.mock.calls).toEqual([[ALICE], [BOB]]);
  });

  it('waits while a recorder is open, and offers a recording only to its account', async () => {
    const {
      drafts,
      store,
      openVoiceRecorderAtom,
      pendingVoiceSendDraftAtom,
      queuedVoiceDraftsAtom,
    } = await openPage();
    store.set(queuedVoiceDraftsAtom, [draft('rec-bob', BOB), draft('rec-alice')]);
    store.set(openVoiceRecorderAtom, Symbol('recorder'));
    drafts.offerQueuedVoiceDraft(store, ALICE);
    expect(store.get(pendingVoiceSendDraftAtom)).toBeUndefined();
    store.set(openVoiceRecorderAtom, undefined);
    drafts.offerQueuedVoiceDraft(store, ALICE);
    expect(store.get(pendingVoiceSendDraftAtom)?.recordingId).toBe('rec-alice');
    expect(store.get(queuedVoiceDraftsAtom).map((d) => d.recordingId)).toEqual(['rec-bob']);
  });

  it('parks a mid-send orphan at its destination with Retry, under its txnId', async () => {
    const { drafts, store, queuedVoiceDraftsAtom } = await openPage();
    const destination = {
      roomId: room.roomId,
      threadId: '$thread',
      replyDraft: { userId: BOB, eventId: '$reply', body: 'Earlier message' },
      threadingEnabled: true,
      signalBridgedRoom: false,
      threadView: true,
    };
    journal.adoptVoiceOrphans.mockResolvedValue([
      orphan('rec-crashed', { destination, txnId: 'txn-before-crash' }),
      orphan('rec-failed', {
        destination,
        txnId: 'txn-failed',
        errorMessage: 'M_UNKNOWN: injected',
      }),
    ]);
    await drafts.recoverVoiceDrafts(client(), store);
    const [crashed, failed] = store.get(queuedVoiceDraftsAtom);
    expect(crashed).toMatchObject({
      recordingId: 'rec-crashed',
      txnId: 'txn-before-crash',
      errorMessage: 'Sending this voice message was interrupted.',
      context: { ownerSessionId: ALICE, ...destination },
    });
    expect(crashed!.context).toHaveProperty('room', room);
    expect(failed).toMatchObject({ txnId: 'txn-failed', errorMessage: 'M_UNKNOWN: injected' });
  });

  it('shows an orphan in every composer when its room is gone or its thread root has no server ID', async () => {
    const { drafts, store, queuedVoiceDraftsAtom } = await openPage();
    const destination = { roomId: room.roomId, threadingEnabled: true, signalBridgedRoom: false };
    journal.adoptVoiceOrphans.mockResolvedValue([
      orphan('rec-left', { destination: { ...destination, roomId: '!left:example.org' } }),
      orphan('rec-echo', {
        destination: { ...destination, threadId: `~${room.roomId}:m1.2` },
        txnId: 'txn-echo',
        errorMessage: 'offline',
      }),
    ]);
    await drafts.recoverVoiceDrafts(client(), store);
    expect(store.get(queuedVoiceDraftsAtom)).toMatchObject([
      { recordingId: 'rec-left', context: { ownerSessionId: ALICE } },
      { recordingId: 'rec-echo', txnId: 'txn-echo', context: { ownerSessionId: ALICE } },
    ]);
    store.get(queuedVoiceDraftsAtom).forEach((recovered) => {
      expect(recovered.context.roomId).toBeUndefined();
      expect(recovered.errorMessage).toBeUndefined();
    });
  });
});

describe('unsent and discarded voice recordings', () => {
  it('parks unsent audio first in line', async () => {
    const { drafts, store, queuedVoiceDraftsAtom } = await openPage();
    store.set(queuedVoiceDraftsAtom, [draft('rec-recovered')]);
    drafts.parkVoiceDraft(store, draft('rec-stopped'));
    expect(store.get(queuedVoiceDraftsAtom).map((d) => d.recordingId)).toEqual([
      'rec-stopped',
      'rec-recovered',
    ]);
    expect(journal.deleteVoiceRecording).not.toHaveBeenCalled();
  });

  it('Discard then Undo restores the recording; an expired Undo deletes it', async () => {
    const {
      drafts,
      store,
      pendingVoiceSendDraftAtom,
      queuedVoiceDraftsAtom,
      discardedVoiceDraftAtom,
    } = await openPage();
    const discarded = draft('rec-1');
    drafts.discardVoiceDraft(store, discarded, 50_000);
    expect(store.get(discardedVoiceDraftAtom)).toEqual({ draft: discarded, until: 60_000 });
    expect(journal.updateVoiceRecording).toHaveBeenLastCalledWith('rec-1', {
      discardUntil: 60_000,
    });

    drafts.undoVoiceDiscard(store);
    expect(store.get(discardedVoiceDraftAtom)).toBeUndefined();
    expect(journal.updateVoiceRecording).toHaveBeenLastCalledWith('rec-1', {
      discardUntil: undefined,
    });
    drafts.offerQueuedVoiceDraft(store, ALICE);
    expect(store.get(pendingVoiceSendDraftAtom)).toBe(discarded);
    expect(journal.deleteVoiceRecording).not.toHaveBeenCalled();

    store.set(pendingVoiceSendDraftAtom, undefined);
    drafts.discardVoiceDraft(store, discarded, 70_000);
    drafts.confirmVoiceDiscard(store);
    expect(store.get(discardedVoiceDraftAtom)).toBeUndefined();
    expect(store.get(queuedVoiceDraftsAtom)).toEqual([]);
    expect(journal.deleteVoiceRecording).toHaveBeenCalledExactlyOnceWith('rec-1');
    // Nothing is left to undo or to delete twice.
    drafts.undoVoiceDiscard(store);
    drafts.confirmVoiceDiscard(store);
    expect(store.get(queuedVoiceDraftsAtom)).toEqual([]);
    expect(journal.deleteVoiceRecording).toHaveBeenCalledOnce();
  });

  it('lets a second discard stand for the first', async () => {
    const { drafts, store, discardedVoiceDraftAtom } = await openPage();
    drafts.discardVoiceDraft(store, draft('rec-1'), 50_000);
    drafts.discardVoiceDraft(store, draft('rec-2'), 51_000);
    expect(journal.deleteVoiceRecording).toHaveBeenCalledExactlyOnceWith('rec-1');
    expect(store.get(discardedVoiceDraftAtom)?.draft.recordingId).toBe('rec-2');
  });
});
