import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { createStore, Provider } from 'jotai';
import { KnownMembership, type MatrixClient, type Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  pendingVoiceSendDraftAtom,
  type PendingVoiceSendContext,
  type PendingVoiceSendDraft,
} from '../roomInputDrafts';
import { clearSavedVoiceDraft, useSavedVoiceDraft } from './savedVoiceDraft';
import { createVoiceSendDraftController } from './voiceSendDraftController';

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
const reloadPage = async (getRecoveryContext?: () => PendingVoiceSendContext, restore = true) => {
  vi.resetModules();
  const drafts = await import('../roomInputDrafts');
  const saved = await import('./savedVoiceDraft');
  reloaded = drafts.pendingVoiceSendDraftAtom;
  const store = createStore();
  function Reloaded() {
    saved.useSavedVoiceDraft(mx, getRecoveryContext, restore);
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
      request: async <T>(name: string, _options: LockOptions, callback: LockGrantedCallback<T>) => {
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

      const { createVoiceSendDraftController: createController } =
        await import('./voiceSendDraftController');
      const controller = createController({
        read: () => store.get(atom),
        write: (draft) => store.set(atom, draft),
      });
      if (action === 'send') {
        const sendRecording = vi.fn();
        expect(
          await controller.retry({
            sameAccount: () => true,
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

  it('brings nothing back where no recording can show, and leaves it for a reload', async () => {
    const first = openPage();
    await settle();
    act(() =>
      first.store.set(pendingVoiceSendDraftAtom, { ...failedDraft(), recordingId: 'kept' })
    );
    await settle();
    act(() => first.renderer.unmount());
    const held = stubLocks();

    // A page whose composer takes text only: it reads nothing, and holds no recording.
    const textOnly = await reloadPage(undefined, false);
    expect(textOnly.get(reloadedAtom())).toBeUndefined();
    expect(held.size).toBe(0);

    const store = await reloadPage();
    expect(store.get(reloadedAtom())?.recordingId).toBe('kept');
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
            sameAccount: () => true,
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

  it('round-trips midTurnMode across reload and ignores invalid stored values', async () => {
    const page = openPage();
    await settle();
    const draft = failedDraft();
    draft.context.midTurnMode = 'queue';
    act(() => page.store.set(pendingVoiceSendDraftAtom, draft));
    await settle();
    act(() => page.renderer.unmount());

    const restoredStore = await reloadPage();
    expect(restoredStore.get(reloadedAtom())?.context.midTurnMode).toBe('queue');

    const db = await openDB('mindroom-voice-drafts', 1);
    const record = await db.get('drafts', userId);
    await db.put('drafts', { ...record, midTurnMode: 'bogus' });
    db.close();

    const sanitizedStore = await reloadPage();
    expect(sanitizedStore.get(reloadedAtom())?.context.midTurnMode).toBeUndefined();
  });
});
