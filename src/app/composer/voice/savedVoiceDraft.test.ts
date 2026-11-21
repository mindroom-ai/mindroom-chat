import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { createStore, Provider } from 'jotai';
import { KnownMembership, type MatrixClient, type Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  pendingVoiceSendDraftAtom,
  type PendingVoiceSendContext,
  type PendingVoiceSendDraft,
} from '../roomInputDrafts';
import { clearSavedVoiceDraft, useSavedVoiceDraft } from './savedVoiceDraft';
import { createVoiceSendDraftController } from './voiceSendDraftController';

const native = vi.hoisted(() => ({
  available: false,
  listLeftovers: vi.fn(),
  cancel: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  level: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => native.available,
    getPlatform: () => 'ios',
    isPluginAvailable: (name: string) => name === 'MindRoomVoiceRecorder',
    convertFileSrc: (path: string) => `capacitor://localhost/_capacitor_file_${path}`,
  },
  registerPlugin: () => native,
}));

const userId = '@alice:example.org';
let membership: KnownMembership = KnownMembership.Join;
const room = {
  roomId: '!room:example.org',
  name: 'Harbour desk',
  getMyMembership: () => membership,
} as Room;
const mx = {
  getUserId: () => userId,
  getRoom: (roomId: string) => (roomId === room.roomId ? room : null),
} as unknown as MatrixClient;

const failedDraft = (): PendingVoiceSendDraft => ({
  file: new File(['voice bytes'], 'voice.ogg', { type: 'audio/ogg' }),
  duration: 4_200,
  waveform: [1, 4, 2],
  errorMessage: 'M_UNKNOWN: injected',
  context: {
    ownerSessionId: userId,
    roomId: room.roomId,
    room,
    threadId: '$thread',
    replyDraft: undefined,
    threadingEnabled: true,
    signalBridgedRoom: false,
  },
});

function Harness() {
  useSavedVoiceDraft(mx);
  return null;
}

/** A page: its own store, as after a reload. */
const openPage = () => {
  const store = createStore();
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(React.createElement(Provider, { store }, React.createElement(Harness)));
  });
  return { store, renderer };
};

// Lets the IndexedDB requests of the effects finish.
const settle = async () => {
  for (let i = 0; i < 20; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
  }
};

let reloaded: typeof pendingVoiceSendDraftAtom | undefined;
const reloadedAtom = () => reloaded!;

/** A reload: fresh modules (nothing restored yet), a fresh store, and the hook mounted again. */
const reloadPage = async (getRecoveryContext?: () => PendingVoiceSendContext) => {
  vi.resetModules();
  const drafts = await import('../roomInputDrafts');
  const saved = await import('./savedVoiceDraft');
  reloaded = drafts.pendingVoiceSendDraftAtom;
  const store = createStore();
  function Reloaded() {
    saved.useSavedVoiceDraft(mx, getRecoveryContext);
    return null;
  }
  act(() => {
    create(React.createElement(Provider, { store }, React.createElement(Reloaded)));
  });
  await settle();
  return store;
};

afterEach(async () => {
  membership = KnownMembership.Join;
  await clearSavedVoiceDraft(userId);
  vi.unstubAllGlobals();
});

const stubLocks = () => {
  const held = new Set<string>();
  vi.stubGlobal('navigator', {
    locks: {
      request: async (name: string, _options: LockOptions, callback: LockGrantedCallback) => {
        if (held.has(name)) return callback(null);
        held.add(name);
        try {
          return await callback({ name, mode: 'exclusive' });
        } finally {
          held.delete(name);
        }
      },
    },
  });
  return held;
};

it('restores the failed-send copy instead of offering the same recording as recovered', async () => {
  const journal = await import('./voiceRecordingJournal');
  stubLocks();
  try {
    const recording = journal.beginVoiceRecording(userId, Date.now(), 'audio/ogg')!;
    await recording.append(0, new Blob(['journal audio']), 4_000);
    const first = openPage();
    await settle();
    act(() =>
      first.store.set(pendingVoiceSendDraftAtom, { ...failedDraft(), recordingId: recording.id })
    );
    await settle();
    act(() => first.renderer.unmount());
    journal.releaseVoiceRecording(recording.id);

    const store = await reloadPage(() => failedDraft().context);
    const draft = store.get(reloadedAtom());
    expect(draft?.recordingId).toBe(recording.id);
    expect(draft?.errorMessage).toBe('M_UNKNOWN: injected');
    expect(draft?.recovered).toBeFalsy();
  } finally {
    await journal.clearVoiceRecordings(userId);
  }
});

it.each(['send', 'discard'])(
  'offers a left room’s recording once after reload, then can %s it',
  async (action) => {
    const journal = await import('./voiceRecordingJournal');
    stubLocks();
    try {
      const recording = journal.beginVoiceRecording(userId, Date.now(), 'audio/ogg')!;
      await recording.append(0, new Blob(['journal audio']), 4_200);
      const first = openPage();
      await settle();
      act(() =>
        first.store.set(pendingVoiceSendDraftAtom, { ...failedDraft(), recordingId: recording.id })
      );
      await settle();
      act(() => first.renderer.unmount());
      journal.releaseVoiceRecording(recording.id);
      membership = KnownMembership.Leave; // The client still has the Room object.

      const newRoom = {
        roomId: '!another:example.org',
        getMyMembership: () => KnownMembership.Join,
      } as Room;
      const context = {
        ...failedDraft().context,
        room: newRoom,
        roomId: newRoom.roomId,
        threadId: undefined,
      };
      const offerContext = vi.fn(() => context);
      const store = await reloadPage(offerContext);
      const atom = reloadedAtom();
      const recovered = store.get(atom);
      expect(recovered).toMatchObject({ recordingId: recording.id, recovered: true, context });
      expect(offerContext).toHaveBeenCalledOnce();
      expect(await recovered?.file.text()).toBe('journal audio');

      const { createVoiceSendDraftController: createController } = await import(
        './voiceSendDraftController'
      );
      const controller = createController({
        read: () => store.get(atom),
        write: (draft) => store.set(atom, draft),
      });
      if (action === 'send') {
        const sendRecording = vi.fn();
        expect(
          await controller.retry({
            claim: () => true,
            context: () => context,
            sendRecording,
            onFailure: vi.fn(),
          })
        ).toBe(true);
        expect(sendRecording).toHaveBeenCalledExactlyOnceWith(
          recovered?.file,
          4_200,
          undefined,
          context
        );
      } else {
        await controller.discardPending();
      }
      expect(store.get(atom)).toBeUndefined();
      // Even if the original room is joined again, neither copy remains to restore.
      membership = KnownMembership.Join;
      const next = await reloadPage(() => context);
      expect(next.get(reloadedAtom())).toBeUndefined();
    } finally {
      await journal.clearVoiceRecordings(userId);
    }
  }
);

describe('native recording recovery on composer mount', () => {
  const leftover = {
    id: '01162E95-5496-4553-B239-E30AB09FFC47',
    path: '/tmp/voice-recorder/01162E95-5496-4553-B239-E30AB09FFC47.m4a',
    startedAt: 1_700_000_000_000,
    duration: 2_400,
    userId,
  };
  const getContext = () => failedDraft().context;
  const readAudio = (audio: string) => new Response(audio);
  const fetchAudio = vi.fn(() => Promise.resolve(readAudio('native voice')));
  let held: Set<string>;

  beforeEach(() => {
    native.available = true;
    native.stop.mockReset();
    let present = true;
    native.listLeftovers.mockReset().mockImplementation(async () => ({
      recordings: present ? [leftover] : [],
    }));
    native.cancel.mockReset().mockImplementation(async ({ id }: { id: string }) => {
      if (id === leftover.id) present = false;
    });
    fetchAudio.mockReset().mockImplementation(async () => readAudio('native voice'));
    vi.stubGlobal('fetch', fetchAudio);
    held = stubLocks();
  });

  afterEach(async () => {
    native.available = false;
    vi.restoreAllMocks();
    const journal = await import('./voiceRecordingJournal');
    await journal.clearVoiceRecordings(userId);
  });

  const observeCommitBeforeCancel = () => {
    let committed = false;
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey
    ) {
      if (this.name === 'chunks') {
        this.transaction.addEventListener('complete', () => {
          committed = true;
        });
      }
      return put.call(this, value, key);
    });
    const committedWhenForgotten = vi.fn();
    const forget = native.cancel.getMockImplementation()!;
    native.cancel.mockImplementation(async (options: { id: string }) => {
      committedWhenForgotten(committed && held.has(`mindroom-voice-recording:${options.id}`));
      await forget(options);
    });
    return committedWhenForgotten;
  };

  it('holds the UUID lock from file read through commit and cancel', async () => {
    const committedWhenForgotten = observeCommitBeforeCancel();
    fetchAudio.mockImplementation(async () => {
      expect(held.has(`mindroom-voice-recording:${leftover.id}`)).toBe(true);
      return readAudio('native voice');
    });
    const store = await reloadPage(getContext);
    const draft = store.get(reloadedAtom());
    expect(draft).toMatchObject({
      recordingId: leftover.id,
      recovered: true,
      duration: 2_400,
      context: getContext(),
    });
    expect(draft?.file.name).toBe('voice-message-1700000000000.m4a');
    expect(draft?.file.type).toBe('audio/mp4');
    expect(await draft?.file.text()).toBe('native voice');
    expect(native.cancel).toHaveBeenCalledExactlyOnceWith({ id: leftover.id });
    expect(committedWhenForgotten).toHaveBeenCalledExactlyOnceWith(true);
    expect(await native.listLeftovers()).toEqual({ recordings: [] });
  });

  it.each([true, false])(
    'keeps unmounted audio and offers it only after cancellation (cancel succeeds: %s)',
    async (deletes) => {
      const committedWhenForgotten = observeCommitBeforeCancel();
      if (!deletes) native.cancel.mockRejectedValueOnce(new Error('File is busy'));
      native.start.mockResolvedValue({ id: leftover.id });
      native.stop.mockResolvedValue({ path: leftover.path });
      native.level.mockResolvedValue({ level: 0 });
      const { createVoiceCaptureSession } = await import('./voiceCaptureSession');
      const { beginVoiceRecording } = await import('./voiceRecordingJournal');
      const offer = vi.fn(() => true);
      const capture = createVoiceCaptureSession(
        (at, mime, id) => beginVoiceRecording(userId, at, mime, id),
        offer
      );
      expect(await capture.start(userId)).toBe(true);
      capture.releaseOwner(true);
      await settle();
      if (deletes) {
        expect(offer).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ recordingId: leftover.id })
        );
        expect(committedWhenForgotten).toHaveBeenCalledExactlyOnceWith(true);
      } else {
        expect(offer).not.toHaveBeenCalled();
        const db = await openDB('mindroom-voice-journal', 1);
        try {
          expect(await db.count('chunks', [leftover.id, 0])).toBe(1);
        } finally {
          db.close();
        }
        const next = await reloadPage(getContext);
        expect(await next.get(reloadedAtom())?.file.text()).toBe('native voice');
        expect(committedWhenForgotten).toHaveBeenCalledExactlyOnceWith(true);
      }
    }
  );

  it('stops immediately and lets capture.finish deliver audio when the journal append fails', async () => {
    native.start.mockResolvedValue({ id: leftover.id });
    native.stop.mockResolvedValue({ path: leftover.path });
    native.level.mockResolvedValue({ level: 0 });
    const put = IDBObjectStore.prototype.put;
    const failAppend = vi.fn(() => {
      throw new DOMException('Full disk', 'QuotaExceededError');
    });
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey
    ) {
      if (this.name === 'chunks') return failAppend();
      return put.call(this, value, key);
    });
    const { createVoiceCaptureSession } = await import('./voiceCaptureSession');
    const { beginVoiceRecording } = await import('./voiceRecordingJournal');
    const capture = createVoiceCaptureSession((at, mime, id) =>
      beginVoiceRecording(userId, at, mime, id)
    );
    expect(await capture.start(userId)).toBe(true);
    const finished = capture.finish();
    const stoppedImmediately = native.stop.mock.calls.length === 1;
    const result = await finished;
    expect(failAppend).toHaveBeenCalledOnce();
    expect(result.status).toBe('captured');
    if (result.status !== 'captured') throw new Error('missing native recording');
    expect(await result.recording.file.text()).toBe('native voice');
    expect(stoppedImmediately).toBe(true);
    expect(native.cancel).toHaveBeenCalledExactlyOnceWith({ id: leftover.id });
  });

  it('keeps the native file if the journal write fails', async () => {
    const put = IDBObjectStore.prototype.put;
    const failWrite = vi
      .spyOn(IDBObjectStore.prototype, 'put')
      .mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
        if (this.name === 'chunks') throw new DOMException('Full disk', 'QuotaExceededError');
        return put.call(this, value, key);
      });
    const store = await reloadPage(getContext);
    expect(fetchAudio).toHaveBeenCalledOnce();
    expect(store.get(reloadedAtom())).toBeUndefined();
    expect(native.cancel).not.toHaveBeenCalled();

    failWrite.mockRestore();
    const next = await reloadPage(getContext);
    expect(await next.get(reloadedAtom())?.file.text()).toBe('native voice');
    expect(native.cancel).toHaveBeenCalledExactlyOnceWith({ id: leftover.id });
  });

  it('does not replace an already committed recording if the old page did not forget the file', async () => {
    native.cancel.mockRejectedValueOnce(new Error('Page gone'));
    const store = await reloadPage(getContext);
    expect(store.get(reloadedAtom())).toBeUndefined();

    fetchAudio.mockResolvedValueOnce(readAudio('replacement audio'));
    const next = await reloadPage(getContext);
    const recovered = next.get(reloadedAtom());
    expect(recovered?.recordingId).toBe(leftover.id);
    expect(await recovered?.file.text()).toBe('native voice');
    expect(native.cancel.mock.calls).toEqual([[{ id: leftover.id }], [{ id: leftover.id }]]);
  });

  it('does not read a file while its UUID lock is busy', async () => {
    held.add(`mindroom-voice-recording:${leftover.id}`);
    const store = await reloadPage(getContext);
    expect(store.get(reloadedAtom())).toBeUndefined();
    expect(fetchAudio).not.toHaveBeenCalled();
    expect(native.cancel).not.toHaveBeenCalled();
  });

  it('reads a leftover from one listing and requires cancel to succeed before offering it', async () => {
    native.listLeftovers
      .mockResolvedValueOnce({ recordings: [leftover] })
      .mockResolvedValue({ recordings: [] });
    native.cancel.mockRejectedValueOnce(new Error('File is busy'));
    const store = await reloadPage(getContext);
    expect(store.get(reloadedAtom())).toBeUndefined();
    expect(native.listLeftovers).toHaveBeenCalledOnce();
    expect(fetchAudio).toHaveBeenCalledOnce();
    expect(native.cancel).toHaveBeenCalledExactlyOnceWith({ id: leftover.id });
  });

  it('does not offer a saved failed-send draft while its native copy cannot be deleted', async () => {
    const page = openPage();
    await settle();
    act(() =>
      page.store.set(pendingVoiceSendDraftAtom, { ...failedDraft(), recordingId: leftover.id })
    );
    await settle();
    act(() => page.renderer.unmount());
    native.cancel.mockRejectedValueOnce(new Error('File is busy'));
    const store = await reloadPage(getContext);
    expect(store.get(reloadedAtom())).toBeUndefined();
    expect(native.cancel).toHaveBeenCalledExactlyOnceWith({ id: leftover.id });

    const next = await reloadPage(getContext);
    expect(await next.get(reloadedAtom())?.file.text()).toBe('voice bytes');
    const atom = reloadedAtom();
    const { createVoiceSendDraftController: createController } = await import(
      './voiceSendDraftController'
    );
    await createController({
      read: () => next.get(atom),
      write: (draft) => next.set(atom, draft),
    }).discardPending();
    const afterDiscard = await reloadPage(getContext);
    expect(afterDiscard.get(reloadedAtom())).toBeUndefined();
  });

  it('confirms unlisted durable audio can be deleted natively without another list', async () => {
    const journal = await import('./voiceRecordingJournal');
    const recording = journal.beginVoiceRecording(
      userId,
      leftover.startedAt,
      'audio/mp4',
      leftover.id
    )!;
    await recording.append(0, new Blob(['journal audio']), leftover.duration);
    recording.release();
    native.listLeftovers.mockResolvedValue({ recordings: [] });
    native.cancel.mockRejectedValueOnce(new Error('File is busy'));

    const first = await reloadPage(getContext);
    expect(first.get(reloadedAtom())).toBeUndefined();
    expect(native.listLeftovers).toHaveBeenCalledOnce();
    expect(native.cancel).toHaveBeenCalledExactlyOnceWith({ id: leftover.id });
    expect(fetchAudio).not.toHaveBeenCalled();

    const second = await reloadPage(getContext);
    expect(await second.get(reloadedAtom())?.file.text()).toBe('journal audio');
  });

  it('does not read another account’s native audio', async () => {
    native.listLeftovers.mockResolvedValue({
      recordings: [{ ...leftover, userId: '@other:example.org' }],
    });
    const store = await reloadPage(getContext);
    expect(store.get(reloadedAtom())).toBeUndefined();
    expect(fetchAudio).not.toHaveBeenCalled();
    expect(native.cancel).not.toHaveBeenCalled();
  });

  it('does not take native files without Web Locks', async () => {
    vi.stubGlobal('navigator', {});
    const store = await reloadPage(getContext);
    expect(store.get(reloadedAtom())).toBeUndefined();
    expect(native.listLeftovers).not.toHaveBeenCalled();
    expect(fetchAudio).not.toHaveBeenCalled();
    expect(native.cancel).not.toHaveBeenCalled();
  });
});

describe('useSavedVoiceDraft', () => {
  it('keeps a failed voice message across a reload, where it was meant to go', async () => {
    const first = openPage();
    await settle();
    act(() => first.store.set(pendingVoiceSendDraftAtom, failedDraft()));
    await settle();
    act(() => first.renderer.unmount());

    const store = await reloadPage();

    const restored = store.get(reloadedAtom());
    expect(restored?.duration).toBe(4_200);
    expect(restored?.waveform).toEqual([1, 4, 2]);
    expect(restored?.errorMessage).toBe('M_UNKNOWN: injected');
    expect(await restored?.file.text()).toBe('voice bytes');
    expect(restored?.context).toMatchObject({
      ownerSessionId: userId,
      roomId: room.roomId,
      threadId: '$thread',
      threadingEnabled: true,
    });
    expect(restored?.context.room).toBe(room);
  });

  it("keeps a recording from a thread's own view for a view of that thread", async () => {
    const first = openPage();
    await settle();
    const draft = failedDraft();
    act(() =>
      first.store.set(pendingVoiceSendDraftAtom, {
        ...draft,
        context: { ...draft.context, threadView: true },
      })
    );
    await settle();
    act(() => first.renderer.unmount());

    const store = await reloadPage();

    expect(store.get(reloadedAtom())?.context).toMatchObject({
      roomId: room.roomId,
      threadId: '$thread',
      threadView: true,
    });
  });

  it('matches the recording id before deleting a failed-send copy', async () => {
    const { store, renderer } = openPage();
    await settle();
    act(() => store.set(pendingVoiceSendDraftAtom, { ...failedDraft(), recordingId: 'new' }));
    await settle();
    act(() => renderer.unmount());
    await clearSavedVoiceDraft(userId, 'old');
    const restored = await reloadPage();
    expect(restored.get(reloadedAtom())?.recordingId).toBe('new');
  });

  it.each(['retry', 'discard'])(
    'forgets a failed-send copy when %s settles without a mounted composer',
    async (action) => {
      const page = openPage();
      const controller = createVoiceSendDraftController({
        read: () => page.store.get(pendingVoiceSendDraftAtom),
        write: (draft) => page.store.set(pendingVoiceSendDraftAtom, draft),
      });
      await settle();
      act(() => page.store.set(pendingVoiceSendDraftAtom, failedDraft()));
      await settle();
      let sent!: () => void;
      const inFlight = new Promise<void>((resolve) => {
        sent = resolve;
      });
      let result: Promise<boolean> | undefined;
      act(() => {
        if (action === 'retry')
          result = controller.retry({
            claim: () => true,
            sendRecording: () => inFlight,
            onFailure: vi.fn(),
          });
        page.renderer.unmount();
      });
      if (action === 'retry') {
        sent();
        expect(await result).toBe(true);
      } else {
        await controller.discardPending();
        await settle();
      }
      const store = await reloadPage();
      expect(store.get(reloadedAtom())).toBeUndefined();
    }
  );
});
