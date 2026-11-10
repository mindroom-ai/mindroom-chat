import 'fake-indexeddb/auto';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { createStore, Provider } from 'jotai';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pendingVoiceSendDraftAtom, type PendingVoiceSendDraft } from '../roomInputDrafts';
import { clearSavedVoiceDraft, useSavedVoiceDraft } from './savedVoiceDraft';

const userId = '@alice:example.org';
const room = { roomId: '!room:example.org', name: 'Harbour desk' } as Room;
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
const reloadPage = async () => {
  vi.resetModules();
  const drafts = await import('../roomInputDrafts');
  const saved = await import('./savedVoiceDraft');
  reloaded = drafts.pendingVoiceSendDraftAtom;
  const store = createStore();
  function Reloaded() {
    saved.useSavedVoiceDraft(mx);
    return null;
  }
  act(() => {
    create(React.createElement(Provider, { store }, React.createElement(Reloaded)));
  });
  await settle();
  return store;
};

afterEach(async () => {
  await clearSavedVoiceDraft(userId);
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

  it('forgets the recording once it is sent or discarded', async () => {
    const page = openPage();
    await settle();
    act(() => page.store.set(pendingVoiceSendDraftAtom, failedDraft()));
    await settle();
    act(() => page.store.set(pendingVoiceSendDraftAtom, undefined));
    await settle();
    act(() => page.renderer.unmount());

    const store = await reloadPage();
    expect(store.get(reloadedAtom())).toBeUndefined();
  });
});
