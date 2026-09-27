import { EventEmitter } from 'events';
import React from 'react';
import { Provider as JotaiProvider, createStore } from 'jotai';
import { EventStatus, MatrixEvent, RoomEvent, type MatrixClient } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';
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
  resetStorageConnectionRecoveryForTesting,
} from './storageConnectionRecovery';
import {
  hasUnsavedTransientWork,
  saveUnsentTextToDrafts,
  STUCK_SEND_MS,
  useStorageRecoveryBlocker,
} from './useStorageRecoveryBlocker';

type Store = ReturnType<typeof createStore>;

const hasWork = (store: Store, localEchoes: MatrixEvent[] = [], now = Date.now()) =>
  hasUnsavedTransientWork({ store, localEchoes, now });

const createLocalEcho = ({
  body,
  ts,
  msgtype = 'm.text',
  threadId,
  replaces,
}: {
  body: string;
  ts: number;
  msgtype?: string;
  threadId?: string;
  replaces?: string;
}) =>
  new MatrixEvent({
    type: 'm.room.message',
    room_id: '!room:test',
    origin_server_ts: ts,
    content: {
      msgtype,
      body,
      ...(threadId
        ? { 'm.relates_to': { rel_type: 'm.thread', event_id: threadId } }
        : replaces
        ? { 'm.relates_to': { rel_type: 'm.replace', event_id: replaces } }
        : {}),
    },
  });

const createFile = (name: string) => new Blob([name], { type: 'text/plain' }) as File;

afterEach(() => {
  resetStorageConnectionRecoveryForTesting();
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
    const items = roomIdToUploadItemsAtomFamily('!room:test');
    store.set(items, { type: 'PUT', item: { file: createFile('a') } as TUploadItem });

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
    store.set(callEmbedAtom, {} as never);

    expect(hasWork(store)).toBe(true);
  });

  it('blocks on sends still in flight and on unsent media, not on salvageable text', () => {
    const now = 1_000_000;
    const text = createLocalEcho({ body: 'hi', ts: now - 1_000 });
    text.setStatus(EventStatus.SENDING);
    expect(hasWork(createStore(), [text], now)).toBe(true);
    expect(hasWork(createStore(), [text], now + STUCK_SEND_MS)).toBe(false);

    text.setStatus(EventStatus.NOT_SENT);
    expect(hasWork(createStore(), [text], now)).toBe(false);

    const image = createLocalEcho({ msgtype: 'm.image', body: 'photo.png', ts: now - 1_000 });
    image.setStatus(EventStatus.NOT_SENT);
    expect(hasWork(createStore(), [image], now)).toBe(true);

    const reaction = new MatrixEvent({
      type: 'm.reaction',
      origin_server_ts: now - 60_000,
      content: { 'm.relates_to': { rel_type: 'm.annotation', event_id: '$x', key: '👍' } },
    });
    reaction.setStatus(EventStatus.NOT_SENT);
    expect(hasWork(createStore(), [reaction], now)).toBe(false);

    text.setStatus(null);
    expect(hasWork(createStore(), [text], now)).toBe(false);
  });
});

describe('saveUnsentTextToDrafts', () => {
  it('appends stuck and failed text sends to their composer drafts', () => {
    const now = 1_000_000;
    const store = createStore();
    const roomKey = getRoomInputDraftKey('@me:test', '!room:test');
    const threadKey = getRoomInputDraftKey('@me:test', '!room:test', '$root');
    store.set(roomIdToMsgDraftAtomFamily(roomKey), [
      { type: 'paragraph', children: [{ text: 'already typing' }] },
    ] as never);
    const stuck = createLocalEcho({
      body: 'stuck reply',
      ts: now - STUCK_SEND_MS,
      threadId: '$root',
    });
    stuck.setStatus(EventStatus.ENCRYPTING);
    const failed = createLocalEcho({ body: 'failed line one\nline two', ts: now });
    failed.setStatus(EventStatus.NOT_SENT);
    const inFlight = createLocalEcho({ body: 'still sending', ts: now });
    inFlight.setStatus(EventStatus.SENDING);
    const edit = createLocalEcho({ body: '* edited', ts: now - STUCK_SEND_MS, replaces: '$old' });
    edit.setStatus(EventStatus.SENDING);

    saveUnsentTextToDrafts({
      store,
      userId: '@me:test',
      localEchoes: [stuck, failed, inFlight, edit],
      now,
    });

    const paragraphs = (key: string) =>
      (store.get(roomIdToMsgDraftAtomFamily(key)) as { children: { text: string }[] }[]).map(
        (node) => node.children.map((child) => child.text).join('')
      );
    expect(paragraphs(roomKey)).toEqual(['already typing', 'failed line one', 'line two']);
    expect(paragraphs(threadKey)).toEqual(['stuck reply']);
    roomIdToMsgDraftAtomFamily.remove(roomKey);
    roomIdToMsgDraftAtomFamily.remove(threadKey);
  });
});

describe('useStorageRecoveryBlocker', () => {
  it('tracks local echoes from the client and registers until unmounted', async () => {
    const mx = new EventEmitter();
    const store = createStore();
    function Harness() {
      useStorageRecoveryBlocker();
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <MatrixClientProvider value={mx as unknown as MatrixClient}>
          <JotaiProvider store={store}>
            <Harness />
          </JotaiProvider>
        </MatrixClientProvider>
      );
    });
    const event = createLocalEcho({ body: 'hi', ts: Date.now() });

    expect(hasStorageRecoveryBlocker()).toBe(false);
    event.setStatus(EventStatus.SENDING);
    mx.emit(RoomEvent.LocalEchoUpdated, event);
    expect(hasStorageRecoveryBlocker()).toBe(true);
    event.setStatus(null);
    mx.emit(RoomEvent.LocalEchoUpdated, event);
    expect(hasStorageRecoveryBlocker()).toBe(false);

    store.set(callEmbedAtom, { dispose: () => undefined } as never);
    expect(hasStorageRecoveryBlocker()).toBe(true);
    store.set(callEmbedAtom, undefined);

    await act(async () => renderer.unmount());
    event.setStatus(EventStatus.SENDING);
    mx.emit(RoomEvent.LocalEchoUpdated, event);
    expect(hasStorageRecoveryBlocker()).toBe(false);
  });
});
