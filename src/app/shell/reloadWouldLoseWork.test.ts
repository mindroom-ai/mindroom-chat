import { createStore } from 'jotai';
import { EventStatus, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { activeCallAtom, type ActiveCall } from '../calls/callStore';
import {
  detachedDictationSendsAtom,
  getRoomInputDraftKey,
  pendingVoiceSendDraftAtom,
  type DetachedDictationSend,
  type PendingVoiceSendDraft,
  roomIdToMsgDraftAtomFamily,
  roomIdToReplyDraftAtomFamily,
  roomIdToUploadItemsAtomFamily,
  type TUploadItem,
} from '../composer/roomInputDrafts';
import { liveCaptureAtom } from '../composer/capture/liveCapture';
import type { DictationSession } from '../composer/dictation/dictationSession';
import type { VoiceCaptureSession } from '../composer/voice/voiceCaptureSession';
import { reloadWouldLoseWork } from './reloadWouldLoseWork';

const event = (status: EventStatus | null) => ({ status }) as MatrixEvent;

/** A client with one room whose timeline (and one thread) hold events of these statuses. */
const client = ({
  room = [] as (EventStatus | null)[],
  thread = [] as (EventStatus | null)[],
  uploads = 0,
} = {}) =>
  ({
    getCurrentUploads: () => Array.from({ length: uploads }),
    getRooms: () => [
      {
        getLiveTimeline: () => ({ getEvents: () => room.map(event) }),
        getThreads: () => [{ liveTimeline: { getEvents: () => thread.map(event) } }],
      } as unknown as Room,
    ],
  }) as unknown as MatrixClient;

describe('reloadWouldLoseWork', () => {
  const draftKey = getRoomInputDraftKey('@reader:example.org', '!room:example.org');

  it('loses nothing with sent messages and a typed draft, which localStorage keeps', () => {
    const store = createStore();
    store.set(roomIdToMsgDraftAtomFamily(draftKey), [
      { type: 'paragraph', children: [{ text: 'Hi' }] },
    ]);
    expect(reloadWouldLoseWork(store, client({ room: [null, EventStatus.SENT] }))).toBe(false);
    expect(reloadWouldLoseWork(store, undefined)).toBe(false);
  });

  it('loses a call in progress', () => {
    const store = createStore();
    store.set(activeCallAtom, { kind: 'room' } as ActiveCall);
    expect(reloadWouldLoseWork(store, undefined)).toBe(true);
  });

  it('loses a file staged in any room and a reply target', () => {
    const staged = createStore();
    staged.set(roomIdToUploadItemsAtomFamily('!other:example.org'), {
      type: 'PUT',
      item: { file: new Blob(['x']) } as unknown as TUploadItem,
    });
    expect(reloadWouldLoseWork(staged, undefined)).toBe(true);

    const replying = createStore();
    replying.set(roomIdToReplyDraftAtomFamily(`${draftKey}:reply`), {
      userId: '@writer:example.org',
      eventId: '$event',
      body: 'Earlier message',
    });
    expect(reloadWouldLoseWork(replying, undefined)).toBe(true);
  });

  it('loses a recorded voice message that waits for a resend', () => {
    const store = createStore();
    store.set(pendingVoiceSendDraftAtom, {} as PendingVoiceSendDraft);
    expect(reloadWouldLoseWork(store, undefined)).toBe(true);
  });

  it('loses a live voice recording or live dictation, whichever page shows', () => {
    const voiceStore = createStore();
    voiceStore.set(liveCaptureAtom, { kind: 'voice', session: {} as VoiceCaptureSession });
    expect(reloadWouldLoseWork(voiceStore, undefined)).toBe(true);

    const dictationStore = createStore();
    dictationStore.set(liveCaptureAtom, {
      kind: 'dictation',
      session: {} as DictationSession,
    });
    expect(reloadWouldLoseWork(dictationStore, undefined)).toBe(true);
  });

  it('loses a detached Finish & Send dictation that is finishing or waiting to retry', () => {
    const store = createStore();
    store.set(
      detachedDictationSendsAtom,
      new Map([
        ['composer-1', { ownerKey: 'composer-1', status: 'sending' } as DetachedDictationSend],
      ])
    );
    expect(reloadWouldLoseWork(store, undefined)).toBe(true);
  });

  it('loses an upload in progress and a message not yet sent, in a room or a thread', () => {
    const store = createStore();
    expect(reloadWouldLoseWork(store, client({ uploads: 1 }))).toBe(true);
    expect(reloadWouldLoseWork(store, client({ room: [EventStatus.SENDING] }))).toBe(true);
    expect(reloadWouldLoseWork(store, client({ room: [EventStatus.NOT_SENT] }))).toBe(true);
    expect(reloadWouldLoseWork(store, client({ thread: [EventStatus.QUEUED] }))).toBe(true);
  });
});
