import { MatrixError } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import type {
  PendingVoiceSendContext,
  PendingVoiceSendDraft,
} from '../roomInputDrafts';
import type { CapturedVoiceRecording } from './voiceCaptureSession';
import {
  createVoiceSendDraftController as createController,
  type VoiceDraftJournal,
  type VoiceDraftStore,
} from './voiceSendDraftController';

const createJournal = () => ({
  update: vi.fn<VoiceDraftJournal['update']>(async () => undefined),
  remove: vi.fn<VoiceDraftJournal['remove']>(async () => undefined),
});
const createVoiceSendDraftController = (store: VoiceDraftStore, journal = createJournal()) =>
  createController(store, journal);
/** Lets the journal write that precedes a send finish. */
const journalWritten = () => Promise.resolve();

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

const createDraftStore = (initial?: PendingVoiceSendDraft) => {
  let current = initial;
  const store: VoiceDraftStore = {
    read: () => current,
    write: (draft) => {
      current = draft;
    },
  };
  return store;
};

const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe('voiceSendDraftController', () => {
  it('sends an initial recording with exact identity and clears durable state on success', async () => {
    const store = createDraftStore(createDraft('older'));
    const controller = createVoiceSendDraftController(store);
    const recording = createRecording();
    const context = createContext();
    const sendRecording = vi.fn();
    const onFailure = vi.fn();

    expect(await controller.sendInitial(recording, context, { sendRecording, onFailure })).toBe(
      true
    );
    expect(sendRecording).toHaveBeenCalledWith(
      recording.file,
      recording.duration,
      recording.waveform,
      context,
      expect.any(String)
    );
    expect(store.read()).toBeUndefined();
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
    const gate = deferred();
    const claim = vi.fn(() => true);
    const sendRecording = vi.fn(() => gate.promise);
    const onFailure = vi.fn();

    const retry = controller.retry({ claim, sendRecording, onFailure, context: createContext });
    const claimedDraft = store.read()!;
    expect(claimedDraft.inFlight).toBeDefined();
    expect(typeof claimedDraft.inFlight?.token).toBe('string');
    expect(typeof claimedDraft.inFlight?.startedAt).toBe('number');
    expect(claimedDraft.errorMessage).toBeUndefined();
    await journalWritten();
    expect(sendRecording).toHaveBeenCalledWith(
      draft.file,
      draft.duration,
      draft.waveform,
      draft.context,
      claimedDraft.txnId
    );

    const otherClaim = vi.fn(() => true);
    const otherSend = vi.fn();
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

    gate.resolve();
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
    const sendRecording = vi.fn();
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
    const sendRecording = vi.fn();
    const nestedSend = vi.fn();
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
    const sendRecording = vi.fn();
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
    let current: PendingVoiceSendDraft | undefined = original;
    let replaceOnStamp = true;
    const store: VoiceDraftStore = {
      read: () => current,
      write: (draft) => {
        current = draft;
        if (replaceOnStamp && draft?.inFlight) {
          replaceOnStamp = false;
          current = replacement;
        }
      },
    };
    const controller = createVoiceSendDraftController(store);
    const sendRecording = vi.fn();
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
        sendRecording: () => {
          store.write(replacement);
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
        sendRecording: () => {
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
    const gate = deferred();
    const onFailure = vi.fn();
    const retry = controller.retry({
      claim: () => true,
      sendRecording: () => gate.promise,
      onFailure,
      context: createContext,
    });

    controller.discardPending();
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
    replyDraft: undefined,
    threadingEnabled: true,
    signalBridgedRoom: false,
    threadView: undefined,
  };

  it('writes the destination and txnId before the send starts', async () => {
    const journal = createJournal();
    const written = deferred();
    journal.update.mockReturnValueOnce(written.promise);
    const controller = createVoiceSendDraftController(createDraftStore(), journal);
    const sendRecording = vi.fn();
    const recording = createRecording();

    const sent = controller.sendInitial(recording, createContext(), {
      sendRecording,
      onFailure: vi.fn(),
    });
    await journalWritten();
    expect(journal.update).toHaveBeenCalledExactlyOnceWith('rec-voice', {
      destination,
      txnId: expect.stringMatching(/^mindroom-voice-/),
      errorMessage: undefined,
    });
    expect(sendRecording).not.toHaveBeenCalled();
    written.resolve();
    expect(await sent).toBe(true);
    expect(sendRecording.mock.calls[0]![4]).toBe(journal.update.mock.calls[0]![1].txnId);
  });

  it('deletes the record only after the event is acknowledged', async () => {
    const journal = createJournal();
    const controller = createVoiceSendDraftController(createDraftStore(), journal);
    const acknowledged = deferred();

    const sent = controller.sendInitial(createRecording(), createContext(), {
      sendRecording: () => acknowledged.promise,
      onFailure: vi.fn(),
    });
    await journalWritten();
    await journalWritten();
    expect(journal.remove).not.toHaveBeenCalled();
    acknowledged.resolve();
    expect(await sent).toBe(true);
    expect(journal.remove).toHaveBeenCalledExactlyOnceWith('rec-voice');
  });

  it('keeps the record and the error of a failed send, and retries with the same txnId', async () => {
    const journal = createJournal();
    const store = createDraftStore();
    const controller = createVoiceSendDraftController(store, journal);
    const sendRecording = vi
      .fn()
      .mockRejectedValueOnce(new Error('upload failed'))
      .mockResolvedValueOnce(undefined);
    const attempt = { sendRecording, onFailure: vi.fn() };

    expect(await controller.sendInitial(createRecording(), createContext(), attempt)).toBe(false);
    expect(journal.remove).not.toHaveBeenCalled();
    expect(journal.update).toHaveBeenLastCalledWith('rec-voice', { errorMessage: 'upload failed' });
    const { txnId } = store.read()!;
    expect(txnId).toEqual(expect.any(String));

    expect(await controller.retry({ ...attempt, claim: () => true, context: createContext })).toBe(
      true
    );
    expect(sendRecording.mock.calls.map((call) => call[4])).toEqual([txnId, txnId]);
    expect(journal.update).toHaveBeenLastCalledWith('rec-voice', {
      destination,
      txnId,
      errorMessage: undefined,
    });
    expect(journal.remove).toHaveBeenCalledExactlyOnceWith('rec-voice');
  });

  it('retries a crash mid-send with the same txnId', async () => {
    const journal = createJournal();
    // As recovery parks it: where it was going, and the transaction ID written before the crash.
    const store = createDraftStore({ ...createDraft(), txnId: 'txn-before-crash' });
    const controller = createVoiceSendDraftController(store, journal);
    const sendRecording = vi.fn();

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
      'txn-before-crash'
    );
    expect(journal.remove).toHaveBeenCalledExactlyOnceWith('rec-voice');
  });

  it('sends a recovered recording where Send is pressed, and parks it there when that fails', async () => {
    const journal = createJournal();
    const store = createDraftStore({
      ...createRecording(),
      context: { ownerSessionId: '@voice:example.org' },
    });
    const controller = createVoiceSendDraftController(store, journal);
    const pressed = createContext('!pressed:example.org');
    const sendRecording = vi.fn().mockRejectedValueOnce(new Error('offline'));

    expect(
      await controller.retry({
        claim: () => true,
        sendRecording,
        onFailure: vi.fn(),
        context: () => pressed,
      })
    ).toBe(false);
    expect(sendRecording.mock.calls[0]![3]).toBe(pressed);
    expect(journal.update).toHaveBeenCalledWith('rec-voice', {
      destination: { ...destination, roomId: '!pressed:example.org' },
      txnId: expect.any(String),
      errorMessage: undefined,
    });
    expect(store.read()).toMatchObject({ context: pressed, errorMessage: 'offline' });
    expect(journal.remove).not.toHaveBeenCalled();
  });
});
