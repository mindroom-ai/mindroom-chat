import { createStore } from 'jotai';
import { MatrixError } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  pendingVoiceSendDraftAtom,
  queuedVoiceDraftsAtom,
  type PendingVoiceSendContext,
  type PendingVoiceSendDraft,
} from '../roomInputDrafts';
import { settleVoiceDraft } from './voiceDrafts';
import type { CapturedVoiceRecording } from './voiceCaptureSession';
import {
  createVoiceSendDraftController as createController,
  type SendRecordingCallback,
  type VoiceDraftStore,
} from './voiceSendDraftController';
import type {
  transitionVoiceRecording,
  VoiceJournalRecord,
  VoiceTransitionOutcome,
} from './voiceRecordingJournal';

type Transition = typeof transitionVoiceRecording;
/** The journal's one record, as the disk would hold it: changed only by a write that commits. */
const createJournal = () => {
  const fresh: VoiceJournalRecord = {
    userId: '@voice:example.org',
    recordingId: 'rec-voice',
    startedAt: 0,
    mimeType: 'audio/ogg',
  };
  let record: VoiceJournalRecord | undefined = fresh;
  const state = {
    fresh,
    /** What every write comes to, until a test says otherwise. */
    outcome: 'committed' as VoiceTransitionOutcome,
    record: () => record,
    apply: (change: Parameters<Transition>[1] = (kept) => kept): VoiceTransitionOutcome => {
      if (state.outcome === 'committed') record = record && change(record);
      return state.outcome;
    },
  };
  const transition = vi.fn<Transition>(async (_id, change) => state.apply(change));
  return Object.assign(state, { transition });
};
const createVoiceSendDraftController = (store: VoiceDraftStore, journal = createJournal()) =>
  createController(store, journal.transition);
/** Lets a journal write, or a send that waits for one, finish. */
const journalWritten = () => Promise.resolve();
/** A send the server acknowledged. */
const sent = () => vi.fn<SendRecordingCallback>(async () => '$voice');
/** A send as the composer does it: where it really goes is committed, then it is dispatched. */
const committedSend = (resolve = (context: PendingVoiceSendContext) => context) => {
  const dispatched = vi.fn<() => Promise<string | undefined>>(async () => '$voice');
  const sendRecording = vi.fn<SendRecordingCallback>(async (_f, _d, _w, context, attempt) => {
    await attempt.commit(resolve(context));
    return dispatched();
  });
  return { sendRecording, dispatched };
};

const createContext = (roomId = '!voice:example.org'): PendingVoiceSendContext => ({
  ownerSessionId: '@voice:example.org',
  roomId,
  room: { roomId } as PendingVoiceSendContext['room'],
  threadId: '$thread',
  replyDraft: undefined,
  threadingEnabled: true,
  signalBridgedRoom: false,
});

const createRecording = (label = 'voice'): CapturedVoiceRecording => ({
  recordingId: `rec-${label}`,
  file: new File([label], `${label}.ogg`, { type: 'audio/ogg' }),
  duration: 640,
  waveform: [3, 17, 42],
});

const createDraft = (label = 'voice'): PendingVoiceSendDraft => ({
  ...createRecording(label),
  context: createContext(),
  errorMessage: 'previous failure',
});

/** The slot and the queue as the app keeps them. */
const createDraftStore = (initial?: PendingVoiceSendDraft) => {
  const atoms = createStore();
  atoms.set(pendingVoiceSendDraftAtom, initial);
  return {
    read: () => atoms.get(pendingVoiceSendDraftAtom),
    write: (draft: PendingVoiceSendDraft | undefined) =>
      atoms.set(pendingVoiceSendDraftAtom, draft),
    settle: (...attempt: Parameters<VoiceDraftStore['settle']>) =>
      settleVoiceDraft(atoms, ...attempt),
    queued: () => atoms.get(queuedVoiceDraftsAtom),
    setQueued: (drafts: PendingVoiceSendDraft[]) => atoms.set(queuedVoiceDraftsAtom, drafts),
  };
};

const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe('voiceSendDraftController', () => {
  it('sends an initial recording with exact identity, and leaves the slot to the recording in it', async () => {
    const older = createDraft('older');
    const store = createDraftStore(older);
    const controller = createVoiceSendDraftController(store);
    const recording = createRecording();
    const context = createContext();
    const sendRecording = sent();
    const onFailure = vi.fn();

    expect(await controller.sendInitial(recording, context, { sendRecording, onFailure })).toBe(
      true
    );
    expect(sendRecording).toHaveBeenCalledWith(
      recording.file,
      recording.duration,
      recording.waveform,
      context,
      { txnId: expect.any(String), commit: expect.any(Function) }
    );
    expect(store.read()).toBe(older);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('parks the exact initial recording and context when delivery fails', async () => {
    const store = createDraftStore();
    const controller = createVoiceSendDraftController(store);
    const recording = createRecording();
    const context = createContext();
    const onFailure = vi.fn();

    expect(
      await controller.sendInitial(recording, context, {
        sendRecording: () => {
          throw new Error('voice upload failed');
        },
        onFailure,
      })
    ).toBe(false);
    expect(store.read()).toEqual({
      recordingId: recording.recordingId,
      file: recording.file,
      duration: recording.duration,
      waveform: recording.waveform,
      context,
      txnId: expect.any(String),
      errorMessage: 'voice upload failed',
    });
    expect(store.read()?.file).toBe(recording.file);
    expect(store.read()?.waveform).toBe(recording.waveform);
    expect(store.read()?.context).toBe(context);
    expect(onFailure).toHaveBeenCalledOnce();
  });

  it.each([
    [
      new MatrixError({ errcode: 'M_UNKNOWN', error: '' }),
      "Couldn't send — your connection dropped. Try again.",
    ],
    [new Error('plain transport failure'), 'plain transport failure'],
    [undefined, 'Failed to send voice message.'],
  ])('formats initial delivery error %#', async (error, expectedMessage) => {
    const store = createDraftStore();
    const controller = createVoiceSendDraftController(store);

    await controller.sendInitial(createRecording(), createContext(), {
      sendRecording: () => Promise.reject(error),
      onFailure: vi.fn(),
    });

    expect(store.read()?.errorMessage).toBe(expectedMessage);
  });

  it('stamps retry ownership synchronously and blocks a controller created after remount', async () => {
    const draft = createDraft();
    const store = createDraftStore(draft);
    const controller = createVoiceSendDraftController(store);
    const gate = deferred<string>();
    const claim = vi.fn(() => true);
    const sendRecording = vi.fn<SendRecordingCallback>(() => gate.promise);
    const onFailure = vi.fn();

    const retry = controller.retry({ claim, sendRecording, onFailure, context: createContext });
    const claimedDraft = store.read()!;
    expect(claimedDraft.inFlight).toBeDefined();
    expect(typeof claimedDraft.inFlight?.token).toBe('string');
    expect(claimedDraft.errorMessage).toBeUndefined();
    await journalWritten();
    expect(sendRecording).toHaveBeenCalledWith(
      draft.file,
      draft.duration,
      draft.waveform,
      draft.context,
      { txnId: claimedDraft.txnId, commit: expect.any(Function) }
    );

    const otherClaim = vi.fn(() => true);
    const otherSend = sent();
    const remounted = createVoiceSendDraftController(store);
    expect(
      await remounted.retry({
        claim: otherClaim,
        sendRecording: otherSend,
        onFailure: vi.fn(),
        context: createContext,
      })
    ).toBe(false);
    expect(otherClaim).not.toHaveBeenCalled();
    expect(otherSend).not.toHaveBeenCalled();

    gate.resolve('$voice');
    expect(await retry).toBe(true);
    expect(store.read()).toBeUndefined();
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('restores the live matching draft and error after retry failure', async () => {
    const draft = createDraft();
    const store = createDraftStore(draft);
    const controller = createVoiceSendDraftController(store);
    const onFailure = vi.fn();

    expect(
      await controller.retry({
        claim: () => true,
        sendRecording: () => Promise.reject(new Error('retry failed')),
        onFailure,
        context: createContext,
      })
    ).toBe(false);
    expect(store.read()).toEqual({
      ...draft,
      txnId: expect.any(String),
      errorMessage: 'retry failed',
      inFlight: undefined,
    });
    expect(onFailure).toHaveBeenCalledOnce();
  });

  it('surfaces retry claim refusal without invoking delivery', async () => {
    const draft = createDraft();
    const store = createDraftStore(draft);
    const controller = createVoiceSendDraftController(store);
    const sendRecording = sent();
    const onFailure = vi.fn();

    expect(
      await controller.retry({
        claim: () => false,
        sendRecording,
        onFailure,
        context: createContext,
      })
    ).toBe(false);
    expect(store.read()).toEqual({
      ...draft,
      errorMessage: 'Another voice message is still sending. Please wait.',
    });
    expect(sendRecording).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('prevents retry reentry from its synchronous claim callback', async () => {
    const store = createDraftStore(createDraft());
    const controller = createVoiceSendDraftController(store);
    const sendRecording = sent();
    const nestedSend = sent();
    const nestedClaim = vi.fn(() => true);
    let nestedRetry!: Promise<boolean>;
    const claim = vi.fn(() => {
      nestedRetry = controller.retry({
        claim: nestedClaim,
        sendRecording: nestedSend,
        onFailure: vi.fn(),
        context: createContext,
      });
      return true;
    });

    expect(
      await controller.retry({ claim, sendRecording, onFailure: vi.fn(), context: createContext })
    ).toBe(true);
    expect(await nestedRetry).toBe(false);
    expect(claim).toHaveBeenCalledOnce();
    expect(nestedClaim).not.toHaveBeenCalled();
    expect(sendRecording).toHaveBeenCalledOnce();
    expect(nestedSend).not.toHaveBeenCalled();
  });

  it('does not resurrect a draft discarded synchronously by an accepted claim', async () => {
    const store = createDraftStore(createDraft());
    const controller = createVoiceSendDraftController(store);
    const sendRecording = sent();
    const onFailure = vi.fn();

    expect(
      await controller.retry({
        claim: () => {
          store.write(undefined);
          return true;
        },
        sendRecording,
        onFailure,
        context: createContext,
      })
    ).toBe(false);
    expect(store.read()).toBeUndefined();
    expect(sendRecording).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledOnce();
  });

  it('does not send after a synchronous store observer replaces its stamped draft', async () => {
    const original = createDraft();
    const replacement = createDraft('replacement');
    const slot = createDraftStore(original);
    let replaceOnStamp = true;
    const store: VoiceDraftStore = {
      ...slot,
      write: (draft) => {
        slot.write(draft);
        if (replaceOnStamp && draft?.inFlight) {
          replaceOnStamp = false;
          slot.write(replacement);
        }
      },
    };
    const controller = createVoiceSendDraftController(store);
    const sendRecording = sent();
    const onFailure = vi.fn();

    expect(
      await controller.retry({
        claim: () => true,
        sendRecording,
        onFailure,
        context: createContext,
      })
    ).toBe(false);
    expect(store.read()).toBe(replacement);
    expect(sendRecording).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledOnce();
  });

  it('preserves a replacement draft when a stale retry succeeds', async () => {
    const store = createDraftStore(createDraft());
    const controller = createVoiceSendDraftController(store);
    const replacement = createDraft('replacement');

    expect(
      await controller.retry({
        claim: () => true,
        sendRecording: async () => {
          store.write(replacement);
          return '$voice';
        },
        onFailure: vi.fn(),
        context: createContext,
      })
    ).toBe(true);
    expect(store.read()).toBe(replacement);
  });

  it('preserves a replacement draft without failure notification when a stale retry rejects', async () => {
    const store = createDraftStore(createDraft());
    const controller = createVoiceSendDraftController(store);
    const replacement = createDraft('replacement');
    const onFailure = vi.fn();

    expect(
      await controller.retry({
        claim: () => true,
        sendRecording: async () => {
          store.write(replacement);
          throw new Error('stale failure');
        },
        onFailure,
        context: createContext,
      })
    ).toBe(false);
    expect(store.read()).toBe(replacement);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('keeps explicit discard authoritative while deferred retry rejects', async () => {
    const store = createDraftStore(createDraft());
    const controller = createVoiceSendDraftController(store);
    const gate = deferred<string>();
    const onFailure = vi.fn();
    const retry = controller.retry({
      claim: () => true,
      sendRecording: () => gate.promise,
      onFailure,
      context: createContext,
    });

    store.write(undefined);
    gate.reject(new Error('failed'));

    expect(await retry).toBe(false);
    expect(store.read()).toBeUndefined();
    expect(onFailure).not.toHaveBeenCalled();
  });
});

describe('voiceSendDraftController and the journal', () => {
  const destination = {
    roomId: '!voice:example.org',
    threadId: '$thread',
    replyEventId: undefined,
    replyThreadId: undefined,
    threadingEnabled: true,
    threadView: undefined,
  };

  it('writes where it really goes, in IDs, and its txnId before anything is sent', async () => {
    const journal = createJournal();
    const written = deferred();
    journal.transition.mockImplementationOnce(async (_id, change) => {
      await written.promise;
      return journal.apply(change);
    });
    const controller = createVoiceSendDraftController(createDraftStore(), journal);
    // The composer resolves the thread's root to the ID the server gave it, and the reply.
    const { sendRecording, dispatched } = committedSend((context) => ({
      ...context,
      threadId: '$root-on-server',
      replyDraft: {
        userId: '@bob:example.org',
        eventId: '$reply',
        body: 'the quoted secret',
        formattedBody: '<b>the quoted secret</b>',
        previewText: 'the quoted secret',
        relation: { rel_type: 'm.thread', event_id: '$reply-thread' },
      },
    }));

    const delivery = controller.sendInitial(createRecording(), createContext(), {
      sendRecording,
      onFailure: vi.fn(),
    });
    // What the disk holds when the event leaves.
    let atDispatch: ReturnType<typeof journal.record>;
    dispatched.mockImplementationOnce(async () => {
      atDispatch = journal.record();
      return '$voice';
    });
    await journalWritten();
    expect(journal.transition).toHaveBeenCalledOnce();
    expect(dispatched).not.toHaveBeenCalled();
    written.resolve();
    expect(await delivery).toBe(true);
    expect(atDispatch).toMatchObject({
      destination: {
        ...destination,
        threadId: '$root-on-server',
        replyEventId: '$reply',
        replyThreadId: '$reply-thread',
      },
      txnId: sendRecording.mock.calls[0]![4].txnId,
    });
    expect(atDispatch?.txnId).toMatch(/^mindroom-voice-/);
    expect(JSON.stringify(atDispatch)).not.toContain('secret');
    // Acknowledged, it leaves the disk.
    expect(journal.record()).toBeUndefined();
  });

  it('sends nothing of a recording the disk holds while it cannot write where it goes, on any attempt', async () => {
    const journal = createJournal();
    journal.outcome = 'failed';
    const store = createDraftStore();
    const controller = createVoiceSendDraftController(store, journal);
    const { sendRecording, dispatched } = committedSend();
    const onFailure = vi.fn();
    const recording = createRecording();
    const retry = () =>
      controller.retry({ sendRecording, onFailure, claim: () => true, context: createContext });

    expect(
      await controller.sendInitial(recording, createContext(), { sendRecording, onFailure })
    ).toBe(false);
    // It is kept as it was, with the error.
    expect(store.read()).toMatchObject({
      file: recording.file,
      errorMessage: 'Could not save this change to your recording. Try again.',
    });
    // A second and a third try change nothing: an event without its ID on disk could be sent twice.
    expect(await retry()).toBe(false);
    expect(await retry()).toBe(false);
    expect(dispatched).not.toHaveBeenCalled();
    expect(journal.record()).toEqual(journal.fresh);
    expect(onFailure).toHaveBeenCalledTimes(3);

    // Once the disk takes it, it goes, under the ID it had from the start.
    journal.outcome = 'committed';
    const { txnId } = store.read()!;
    expect(await retry()).toBe(true);
    expect(dispatched).toHaveBeenCalledOnce();
    expect(new Set(sendRecording.mock.calls.map((call) => call[4].txnId))).toEqual(
      new Set([txnId])
    );
  });

  it('sends a recording the disk never held from memory, and says it is not protected', async () => {
    const journal = createJournal();
    journal.outcome = 'absent';
    const store = createDraftStore();
    const controller = createVoiceSendDraftController(store, journal);
    const { sendRecording, dispatched } = committedSend();
    dispatched.mockRejectedValueOnce(new Error('offline'));
    const attempt = { sendRecording, onFailure: vi.fn() };
    expect(await controller.sendInitial(createRecording(), createContext(), attempt)).toBe(false);
    expect(store.read()).toMatchObject({ errorMessage: 'offline', unprotected: true });
    expect(await controller.retry({ ...attempt, claim: () => true, context: createContext })).toBe(
      true
    );
    expect(dispatched).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['a send that resolved without an event ID', async () => undefined],
    [
      'a send that failed',
      async () => {
        throw new Error('upload failed');
      },
    ],
  ])('keeps the record after %s', async (_case, sendRecording) => {
    const journal = createJournal();
    const store = createDraftStore();
    const controller = createVoiceSendDraftController(store, journal);

    expect(
      await controller.sendInitial(createRecording(), createContext(), {
        sendRecording,
        onFailure: vi.fn(),
      })
    ).toBe(false);
    expect(journal.record()).toBeDefined();
    expect(store.read()?.errorMessage).toEqual(expect.any(String));

    // Sending but not acknowledged yet, it is still there.
    const acknowledged = deferred<string>();
    const retry = controller.retry({
      sendRecording: () => acknowledged.promise,
      onFailure: vi.fn(),
      claim: () => true,
      context: createContext,
    });
    await journalWritten();
    await journalWritten();
    expect(journal.record()).toBeDefined();
    acknowledged.resolve('$voice');
    expect(await retry).toBe(true);
    expect(journal.record()).toBeUndefined();
  });

  it('keeps a recording that was sent, with its transaction ID, until it left the disk', async () => {
    const journal = createJournal();
    const store = createDraftStore();
    const controller = createVoiceSendDraftController(store, journal);
    const { sendRecording, dispatched } = committedSend();
    // The server took it; deleting it from the disk fails.
    dispatched.mockImplementationOnce(async () => {
      journal.outcome = 'failed';
      return '$voice';
    });
    const attempt = { sendRecording, onFailure: vi.fn() };
    expect(await controller.sendInitial(createRecording(), createContext(), attempt)).toBe(false);
    const { txnId } = store.read()!;
    expect(store.read()?.errorMessage).toBe(
      'Could not save this change to your recording. Try again.'
    );
    // A page that loads now finds it with the ID the server knows, not as one never sent.
    expect(journal.record()).toMatchObject({ destination, txnId });
  });

  it('retries a failed send under the same txnId', async () => {
    const journal = createJournal();
    const store = createDraftStore();
    const controller = createVoiceSendDraftController(store, journal);
    const { sendRecording, dispatched } = committedSend();
    dispatched.mockRejectedValueOnce(new Error('upload failed'));
    const attempt = { sendRecording, onFailure: vi.fn() };

    expect(await controller.sendInitial(createRecording(), createContext(), attempt)).toBe(false);
    const { txnId } = store.read()!;
    expect(txnId).toEqual(expect.any(String));
    expect(journal.record()).toMatchObject({ destination, txnId });
    expect(await controller.retry({ ...attempt, claim: () => true, context: createContext })).toBe(
      true
    );
    expect(sendRecording.mock.calls.map((call) => call[4].txnId)).toEqual([txnId, txnId]);
  });

  it('retries a crash mid-send where it was going, with the same txnId', async () => {
    const journal = createJournal();
    // As recovery parks it: where it was going, and the transaction ID written before the crash.
    const store = createDraftStore({ ...createDraft(), txnId: 'txn-before-crash' });
    const controller = createVoiceSendDraftController(store, journal);
    const sendRecording = sent();

    expect(
      await controller.retry({
        claim: () => true,
        sendRecording,
        onFailure: vi.fn(),
        context: () => createContext('!elsewhere:example.org'),
      })
    ).toBe(true);
    expect(sendRecording).toHaveBeenCalledExactlyOnceWith(
      expect.any(File),
      640,
      [3, 17, 42],
      expect.objectContaining({ roomId: '!voice:example.org' }),
      { txnId: 'txn-before-crash', commit: expect.any(Function) }
    );
    expect(journal.record()).toBeUndefined();
  });

  it('sends a recovered recording where Send is pressed, and parks it there when that fails', async () => {
    const journal = createJournal();
    const store = createDraftStore({
      ...createRecording(),
      context: { ownerSessionId: '@voice:example.org' },
    });
    const controller = createVoiceSendDraftController(store, journal);
    const pressed = createContext('!pressed:example.org');
    const { sendRecording, dispatched } = committedSend();
    dispatched.mockRejectedValueOnce(new Error('offline'));

    expect(
      await controller.retry({
        claim: () => true,
        sendRecording,
        onFailure: vi.fn(),
        context: () => pressed,
      })
    ).toBe(false);
    expect(sendRecording.mock.calls[0]![3]).toBe(pressed);
    expect(journal.record()).toMatchObject({
      destination: { ...destination, roomId: '!pressed:example.org' },
      txnId: expect.any(String),
    });
    expect(store.read()).toMatchObject({ context: pressed, errorMessage: 'offline' });
  });

  it('sends what may already be sent in a room that is gone as a copy, under a new txnId', async () => {
    const journal = createJournal();
    const store = createDraftStore({
      ...createRecording(),
      context: { ownerSessionId: '@voice:example.org' },
      txnId: 'txn-attempted',
      attemptedRoomName: 'Harbour office',
    });
    const controller = createVoiceSendDraftController(store, journal);
    const pressed = createContext('!pressed:example.org');
    const { sendRecording, dispatched } = committedSend();
    dispatched.mockRejectedValueOnce(new Error('offline'));
    const attempt = {
      claim: () => true,
      sendRecording,
      onFailure: vi.fn(),
      context: () => pressed,
    };

    expect(await controller.retry(attempt)).toBe(false);
    // The ID the first room knows is not the second room's: the copy is its own event.
    const copyTxnId = sendRecording.mock.calls[0]![4].txnId;
    expect(copyTxnId).toMatch(/^mindroom-voice-/);
    expect(copyTxnId).not.toBe('txn-attempted');
    expect(journal.record()).toMatchObject({
      destination: { ...destination, roomId: '!pressed:example.org' },
      txnId: copyTxnId,
    });
    // From here on it is that room's, to retry there under the copy's ID.
    expect(store.read()).toMatchObject({ context: pressed, txnId: copyTxnId });
    expect(store.read()?.attemptedRoomName).toBeUndefined();
    expect(await controller.retry(attempt)).toBe(true);
    expect(sendRecording.mock.calls[1]![4].txnId).toBe(copyTxnId);
  });
});

describe('a send that ends after the person moved on', () => {
  const recovered: PendingVoiceSendDraft = {
    ...createRecording('recovered'),
    context: { ownerSessionId: '@voice:example.org' },
  };

  it.each([
    ['sent', '$voice', []],
    ['failed', undefined, ['rec-voice']],
  ] as const)(
    'a first attempt that is %s leaves the recording that took the slot after navigation',
    async (_outcome, eventId, waiting) => {
      const store = createDraftStore();
      const controller = createVoiceSendDraftController(store);
      const gate = deferred<string | undefined>();
      const delivery = controller.sendInitial(createRecording(), createContext(), {
        sendRecording: () => gate.promise,
        onFailure: vi.fn(),
      });
      // The recorder's composer goes, and a recording that waited is shown.
      store.write(recovered);
      gate.resolve(eventId);
      expect(await delivery).toBe(eventId !== undefined);
      expect(store.read()).toBe(recovered);
      expect(store.queued().map((draft) => draft.recordingId)).toEqual(waiting);
    }
  );

  it.each([
    ['sent', '$voice'],
    ['failed', undefined],
  ] as const)(
    'a retry that is %s ends in the queue its draft moved to on an account switch',
    async (_outcome, eventId) => {
      const store = createDraftStore(createDraft());
      const controller = createVoiceSendDraftController(store);
      const gate = deferred<string | undefined>();
      const onFailure = vi.fn();
      const retry = controller.retry({
        claim: () => true,
        sendRecording: () => gate.promise,
        onFailure,
        context: createContext,
      });
      // Another account takes the page: this one's draft waits, and that one's is shown.
      store.setQueued([store.read()!]);
      store.write(recovered);
      gate.resolve(eventId);
      expect(await retry).toBe(eventId !== undefined);
      expect(store.read()).toBe(recovered);
      // Sent, it is gone; failed, it waits with its error and can be retried, not "sending" forever.
      expect(store.queued()).toMatchObject(
        eventId ? [] : [{ recordingId: 'rec-voice', errorMessage: 'Failed to send voice message.' }]
      );
      expect(store.queued()[0]?.inFlight).toBeUndefined();
      expect(onFailure).toHaveBeenCalledTimes(eventId ? 0 : 1);
    }
  );
});
