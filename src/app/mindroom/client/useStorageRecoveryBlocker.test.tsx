import React from 'react';
import { Provider as JotaiProvider, createStore } from 'jotai';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';
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
  hasUnsavedTransientWork,
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
    const settle = trackComposerTextSend({
      userId: '@me:test',
      roomId: '!room:test',
      threadId: undefined,
      draft: [paragraph('hi')] as never,
      startedAt: now,
    });

    expect(hasWork(createStore(), now + STUCK_SEND_MS - 1)).toBe(true);
    expect(hasWork(createStore(), now + STUCK_SEND_MS)).toBe(false);
    settle();
    expect(hasWork(createStore(), now)).toBe(false);
  });
});

describe('saveUnsentComposerText', () => {
  it('returns unanswered sends to the composers that sent them, once', () => {
    const now = 1_000_000;
    const store = createStore();
    const roomKey = getRoomInputDraftKey('@me:test', '!room:test');
    const threadKey = getRoomInputDraftKey('@me:test', '!room:test', '$root');
    store.set(roomIdToMsgDraftAtomFamily(roomKey), [paragraph('already typing')] as never);
    // A room-composer reply to a threaded message still belongs to the room composer.
    trackComposerTextSend({
      userId: '@me:test',
      roomId: '!room:test',
      threadId: undefined,
      draft: [paragraph('reply from the room'), paragraph('second line')] as never,
      startedAt: now - STUCK_SEND_MS,
    });
    trackComposerTextSend({
      userId: '@me:test',
      roomId: '!room:test',
      threadId: '$root',
      draft: [paragraph('in flight')] as never,
      startedAt: now,
    });
    const settled = trackComposerTextSend({
      userId: '@me:test',
      roomId: '!room:test',
      threadId: '$root',
      draft: [paragraph('delivered')] as never,
      startedAt: now - STUCK_SEND_MS,
    });
    settled();

    saveUnsentComposerText({ store, includeInFlight: false, now });
    saveUnsentComposerText({ store, includeInFlight: false, now });

    expect(draftText(store, roomKey)).toEqual([
      'already typing',
      'reply from the room',
      'second line',
    ]);
    expect(draftText(store, threadKey)).toEqual([]);

    saveUnsentComposerText({ store, includeInFlight: true, now });
    expect(draftText(store, threadKey)).toEqual(['in flight']);
    roomIdToMsgDraftAtomFamily.remove(roomKey);
    roomIdToMsgDraftAtomFamily.remove(threadKey);
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
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <JotaiProvider store={store}>
          <Harness />
        </JotaiProvider>
      );
    });
    trackComposerTextSend({
      userId: '@me:test',
      roomId: '!room:test',
      threadId: undefined,
      draft: [paragraph('just sent')] as never,
      startedAt: Date.now(),
    });

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
