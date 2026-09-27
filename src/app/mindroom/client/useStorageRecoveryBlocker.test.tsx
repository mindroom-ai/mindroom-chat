import React from 'react';
import { Provider as JotaiProvider, createStore } from 'jotai';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { EventStatus, type MatrixClient } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../hooks/useMatrixClient';
import { callEmbedAtom } from '../../state/callEmbed';
import {
  getRoomInputDraftKey,
  pendingVoiceSendDraftAtom,
  roomIdToMsgDraftAtomFamily,
  roomIdToUploadItemsAtomFamily,
  roomUploadAtomFamily,
  voiceAutoSendPendingAtom,
  type TUploadItem,
} from '../../state/room/roomInputDrafts';
import { UploadStatus } from '../../state/upload';
import {
  publishVoiceCaptureState,
  releaseVoiceCaptureState,
} from '../voice/voiceCaptureDiagnostics';
import {
  hasStorageRecoveryBlocker,
  reloadAfterStorageLoss,
  resetStorageConnectionRecoveryForTesting,
  startStorageConnectionSentinel,
} from './storageConnectionRecovery';
import {
  type ComposerTextSend,
  hasUnsavedTransientWork,
  leavePendingThreadRoute,
  persistComposerDrafts,
  resetComposerTextSendsForTesting,
  saveUnsentComposerText,
  STUCK_SEND_MS,
  trackComposerTextSend,
  useStorageRecoveryBlocker,
} from './useStorageRecoveryBlocker';

type Store = ReturnType<typeof createStore>;

const hasWork = (store: Store, now = Date.now()) => hasUnsavedTransientWork({ store, now });

const createFile = (name: string) => new Blob([name], { type: 'text/plain' }) as File;

const paragraph = (text: string) => ({ type: 'paragraph', children: [{ text }] });

const track = (send: Partial<ComposerTextSend> & { text: string; startedAt: number }) =>
  trackComposerTextSend({
    userId: '@me:test',
    roomId: '!room:test',
    threadId: undefined,
    draft: [paragraph(send.text)] as never,
    getStatus: () => EventStatus.ENCRYPTING,
    canWriteDraft: () => true,
    ...send,
  });

const draftText = (store: Store, key: string) =>
  (store.get(roomIdToMsgDraftAtomFamily(key)) as { children: { text: string }[] }[]).map((node) =>
    node.children.map((child) => child.text).join('')
  );

afterEach(() => {
  resetStorageConnectionRecoveryForTesting();
  resetComposerTextSendsForTesting();
  roomIdToUploadItemsAtomFamily.getParams().forEach((key) => {
    roomIdToUploadItemsAtomFamily.remove(key);
  });
  roomUploadAtomFamily.getParams().forEach((file) => {
    roomUploadAtomFamily.remove(file);
  });
});

describe('unsaved in-memory work that blocks a storage recovery reload', () => {
  it('allows a reload when nothing is pending', () => {
    expect(hasWork(createStore())).toBe(false);
  });

  it('blocks while voice is being captured', () => {
    const source = Symbol('recorder');
    publishVoiceCaptureState(source, 'recording');
    try {
      expect(hasWork(createStore())).toBe(true);
    } finally {
      releaseVoiceCaptureState(source);
    }
    expect(hasWork(createStore())).toBe(false);
  });

  it('blocks while a voice message waits to be sent', () => {
    const autoSend = createStore();
    autoSend.set(voiceAutoSendPendingAtom, true);
    expect(hasWork(autoSend)).toBe(true);

    const draft = createStore();
    draft.set(pendingVoiceSendDraftAtom, {} as never);
    expect(hasWork(draft)).toBe(true);
  });

  it('blocks while composer attachments exist only in memory', () => {
    const store = createStore();
    store.set(roomIdToUploadItemsAtomFamily('!room:test'), {
      type: 'PUT',
      item: { file: createFile('a') } as TUploadItem,
    });

    expect(hasWork(store)).toBe(true);
    // Attachments left in a room of a removed or other account cannot be sent from here.
    expect(
      hasUnsavedTransientWork({ store, isKnownRoom: (roomId) => roomId !== '!room:test' })
    ).toBe(false);
  });

  it('blocks while an upload is in progress', () => {
    const store = createStore();
    const file = createFile('b');
    store.get(roomUploadAtomFamily(file));
    expect(hasWork(store)).toBe(false);

    store.set(roomUploadAtomFamily(file), {
      file,
      status: UploadStatus.Loading,
      promise: new Promise<never>(() => {}),
      progress: { loaded: 1, total: 2 },
    });
    expect(hasWork(store)).toBe(true);
  });

  it('blocks during a call', () => {
    const store = createStore();
    store.set(callEmbedAtom, { dispose: () => undefined } as never);

    expect(hasWork(store)).toBe(true);
  });

  it('waits for a composer send in flight, then treats it as stuck', () => {
    const now = 1_000_000;
    const settle = track({ text: 'hi', startedAt: now });

    expect(hasWork(createStore(), now + STUCK_SEND_MS - 1)).toBe(true);
    expect(hasWork(createStore(), now + STUCK_SEND_MS)).toBe(false);
    settle();
    expect(hasWork(createStore(), now)).toBe(false);
  });
});

describe('saveUnsentComposerText', () => {
  it('returns unanswered sends to the composers that sent them, first and once', () => {
    const now = 1_000_000;
    const store = createStore();
    const roomKey = getRoomInputDraftKey('@me:test', '!room:test');
    const threadKey = getRoomInputDraftKey('@me:test', '!room:test', '$root');
    store.set(roomIdToMsgDraftAtomFamily(roomKey), [paragraph('typed since')] as never);
    // A room-composer reply to a threaded message still belongs to the room composer.
    track({ text: 'reply from the room', startedAt: now - STUCK_SEND_MS });
    track({ text: 'in flight', threadId: '$root', startedAt: now });
    track({
      text: 'failed',
      threadId: '$root',
      startedAt: now - STUCK_SEND_MS,
      getStatus: () => EventStatus.NOT_SENT,
    });

    saveUnsentComposerText({ store, includeInFlight: false, now });
    saveUnsentComposerText({ store, includeInFlight: false, now });

    expect(draftText(store, roomKey)).toEqual(['reply from the room', 'typed since']);
    expect(draftText(store, threadKey)).toEqual(['failed']);

    saveUnsentComposerText({ store, includeInFlight: true, now });
    expect(draftText(store, threadKey)).toEqual(['in flight', 'failed']);
    roomIdToMsgDraftAtomFamily.remove(roomKey);
    roomIdToMsgDraftAtomFamily.remove(threadKey);
  });

  it('leaves out sends that may have reached the server or whose account was removed', () => {
    const now = 1_000_000;
    const store = createStore();
    const roomKey = getRoomInputDraftKey('@me:test', '!room:test');
    track({ text: 'on the wire', startedAt: 0, getStatus: () => EventStatus.SENDING });
    track({ text: 'accepted', startedAt: 0, getStatus: () => EventStatus.SENT });
    track({ text: 'removed account', startedAt: 0, canWriteDraft: () => false });
    track({ text: 'echo gone', startedAt: 0, getStatus: () => undefined });

    saveUnsentComposerText({ store, includeInFlight: true, now });

    expect(draftText(store, roomKey)).toEqual(['echo gone']);
    expect(hasWork(store, now)).toBe(false);
    roomIdToMsgDraftAtomFamily.remove(roomKey);
  });
});

describe('recovery reload preparation', () => {
  it('writes non-empty in-memory drafts again and leaves empty ones alone', () => {
    const store = createStore();
    const typedKey = getRoomInputDraftKey('@me:test', '!typed:test');
    const emptyKey = getRoomInputDraftKey('@me:test', '!empty:test');
    store.set(roomIdToMsgDraftAtomFamily(typedKey), [paragraph('last seconds')] as never);
    store.get(roomIdToMsgDraftAtomFamily(emptyKey));
    const set = vi.spyOn(store, 'set');

    persistComposerDrafts(store);

    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(roomIdToMsgDraftAtomFamily(typedKey), [
      paragraph('last seconds'),
    ]);
    roomIdToMsgDraftAtomFamily.remove(typedKey);
    roomIdToMsgDraftAtomFamily.remove(emptyKey);
  });

  it('opens the room instead of a pending local-echo thread route', () => {
    const history = { state: { key: 'k' }, replaceState: vi.fn() };
    leavePendingThreadRoute(
      { href: 'https://chat.test/home/!room?threadId=~!room:txn-1&x=1' },
      history
    );
    expect(history.replaceState).toHaveBeenCalledWith(
      { key: 'k' },
      '',
      'https://chat.test/home/!room?x=1'
    );

    history.replaceState.mockClear();
    leavePendingThreadRoute({ href: 'https://chat.test/home/!room?threadId=%24root' }, history);
    expect(history.replaceState).not.toHaveBeenCalled();
  });
});

describe('useStorageRecoveryBlocker', () => {
  it('blocks automatic reloads and saves every unanswered send on a manual reload', async () => {
    const store = createStore();
    const database = new EventTarget();
    startStorageConnectionSentinel({
      indexedDB: {
        open: () => {
          const request = { result: database, onsuccess: null as null | (() => void) };
          queueMicrotask(() => request.onsuccess?.());
          return request;
        },
      } as unknown as IDBFactory,
      markerStorage: {
        getItem: () => null,
        setItem: () => undefined,
      } as unknown as Storage,
      reload: () => undefined,
    });
    function Harness() {
      useStorageRecoveryBlocker();
      return null;
    }
    const mx = { getRoom: () => null } as unknown as MatrixClient;
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <MatrixClientProvider value={mx}>
          <JotaiProvider store={store}>
            <Harness />
          </JotaiProvider>
        </MatrixClientProvider>
      );
    });
    track({ text: 'just sent', startedAt: Date.now() });

    expect(hasStorageRecoveryBlocker()).toBe(true);
    database.dispatchEvent(new Event('close'));
    expect(reloadAfterStorageLoss({ automatic: false })).toBe(true);
    const key = getRoomInputDraftKey('@me:test', '!room:test');
    expect(draftText(store, key)).toEqual(['just sent']);
    expect(hasStorageRecoveryBlocker()).toBe(false);

    await act(async () => renderer.unmount());
    roomIdToMsgDraftAtomFamily.remove(key);
  });
});
