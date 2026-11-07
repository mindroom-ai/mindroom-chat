import 'fake-indexeddb/auto';
import { EventEmitter } from 'node:events';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { createStore, getDefaultStore, Provider } from 'jotai';
import { openDB } from 'idb';
import { ClientEvent, SyncState, type MatrixClient, type Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keepEncryptedRoomTextOffDisk } from './encryptedRoomTextOffDisk';
import {
  clearRecentThreadsStore,
  forgetEncryptedRecentThreadText,
  makeRecentThreadsAtom,
} from '../../event-store/threads/recentThreads';
import {
  forgetEncryptedReplyText,
  keepReplyDraft,
  pendingVoiceSendDraftAtom,
  restoreKeptReplyDraft,
  roomIdToReplyDraftAtomFamily,
  type IReplyDraft,
} from '../../composer/roomInputDrafts';
import { clearSavedVoiceDraft, useSavedVoiceDraft } from '../../composer/voice/savedVoiceDraft';

// P2-e2ee-F011: the offline cache keeps encrypted rooms as ciphertext, but the account's other
// stores kept text read out of their decrypted events in the clear: the preview of a recently
// opened thread and the quoted message of a reply draft. These tests read the stores directly.

const USER = '@reader:example.org';
const OTHER_USER = '@colleague:example.org';
const SECRET = '!secret:example.org';
const PLAIN = '!plain:example.org';

const rooms = new Map(
  [SECRET, PLAIN].map((roomId) => [
    roomId,
    { roomId, hasEncryptionStateEvent: () => roomId === SECRET } as unknown as Room,
  ])
);

/** A client of the reader's account that knows both rooms. */
const createClient = (): MatrixClient =>
  Object.assign(new EventEmitter(), {
    getUserId: () => USER,
    getRoom: (roomId: string) => rooms.get(roomId) ?? null,
  }) as unknown as MatrixClient;

const replyKey = (userId: string, roomId: string) =>
  `roomInputReply:${JSON.stringify([userId, roomId])}`;
const ownDraftKey = `roomInputDraft:${JSON.stringify([USER, SECRET, '$thread'])}`;

const quoted = (roomId: string): IReplyDraft => ({
  userId: '@helper:example.org',
  eventId: `$answer-${roomId}`,
  body: `The **plan** for ${roomId}`,
  formattedBody: `The <b>plan</b> for ${roomId}`,
  relation: { rel_type: 'm.thread', event_id: `$root-${roomId}` },
});

let values: Map<string, string>;
let stopKeeping: (() => void) | undefined;

const stored = (key: string): unknown => JSON.parse(values.get(key) ?? 'null');

beforeEach(() => {
  values = new Map();
  vi.stubGlobal('localStorage', {
    get length() {
      return values.size;
    },
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});

afterEach(async () => {
  stopKeeping?.();
  stopKeeping = undefined;
  clearRecentThreadsStore(USER);
  roomIdToReplyDraftAtomFamily.remove(SECRET);
  await clearSavedVoiceDraft(USER);
  vi.unstubAllGlobals();
});

describe('text read out of encrypted rooms stays off disk', () => {
  it('stores a recently opened thread of an encrypted room without its text', () => {
    stopKeeping = keepEncryptedRoomTextOffDisk(createClient(), []);
    const recentThreads = makeRecentThreadsAtom(USER);
    const store = getDefaultStore();
    store.set(recentThreads, {
      type: 'BUMP',
      roomId: SECRET,
      threadId: '$secret-root',
      openedAt: 200,
      summaryText: 'Draft the merger letter',
    });
    store.set(recentThreads, {
      type: 'BUMP',
      roomId: PLAIN,
      threadId: '$plain-root',
      openedAt: 100,
      summaryText: 'Lunch order',
    });

    expect(stored(`recentThreads:${USER}`)).toEqual({
      v: 1,
      entries: [
        { roomId: SECRET, threadId: '$secret-root', openedAt: 200 },
        { roomId: PLAIN, threadId: '$plain-root', openedAt: 100, summaryText: 'Lunch order' },
      ],
    });
    // The open page still shows it.
    expect(store.get(recentThreads)[0]?.summaryText).toBe('Draft the merger letter');
  });

  it('keeps a reply target of an encrypted room without the text it quotes', () => {
    stopKeeping = keepEncryptedRoomTextOffDisk(createClient(), []);
    keepReplyDraft(USER, SECRET, quoted(SECRET));
    keepReplyDraft(USER, PLAIN, quoted(PLAIN));

    expect(stored(replyKey(USER, SECRET))).toEqual({
      userId: '@helper:example.org',
      eventId: `$answer-${SECRET}`,
      body: '',
      relation: { rel_type: 'm.thread', event_id: `$root-${SECRET}` },
    });
    expect(stored(replyKey(USER, PLAIN))).toEqual(quoted(PLAIN));

    // After a reload the composer replies to the same message.
    const store = createStore();
    restoreKeptReplyDraft(store, USER, SECRET);
    expect(store.get(roomIdToReplyDraftAtomFamily(SECRET))).toMatchObject({
      eventId: `$answer-${SECRET}`,
      relation: { rel_type: 'm.thread', event_id: `$root-${SECRET}` },
    });
  });

  it('parks a voice message replying in an encrypted room without the text it quotes', async () => {
    const mx = createClient();
    stopKeeping = keepEncryptedRoomTextOffDisk(mx, []);
    const store = createStore();
    function Harness() {
      useSavedVoiceDraft(mx);
      return null;
    }
    act(() => {
      create(React.createElement(Provider, { store }, React.createElement(Harness)));
    });
    await act(async () => {
      store.set(pendingVoiceSendDraftAtom, {
        file: new File(['voice bytes'], 'voice.ogg', { type: 'audio/ogg' }),
        duration: 1_000,
        context: {
          ownerSessionId: USER,
          roomId: SECRET,
          room: rooms.get(SECRET)!,
          threadId: undefined,
          replyDraft: quoted(SECRET),
          threadingEnabled: true,
          signalBridgedRoom: false,
        },
      });
    });
    const readSaved = async () => {
      const db = await openDB('mindroom-voice-drafts', 1);
      try {
        return (await db.get('drafts', USER)) as { replyDraft?: IReplyDraft } | undefined;
      } finally {
        db.close();
      }
    };
    await vi.waitFor(async () => expect(await readSaved()).toBeDefined());
    expect((await readSaved())?.replyDraft).toEqual({
      userId: '@helper:example.org',
      eventId: `$answer-${SECRET}`,
      body: '',
      relation: { rel_type: 'm.thread', event_id: `$root-${SECRET}` },
    });
  });

  it("deletes what an older version stored once the rooms are known, and keeps the person's own draft", () => {
    const ownDraft = JSON.stringify([{ type: 'paragraph', children: [{ text: 'My own words' }] }]);
    const recentKey = `recentThreads:${USER}`;
    const oldRecent = {
      v: 1,
      entries: [
        { roomId: SECRET, threadId: '$secret-root', openedAt: 200, summaryText: 'Merger letter' },
        { roomId: PLAIN, threadId: '$plain-root', openedAt: 100, summaryText: 'Lunch order' },
      ],
    };
    values.set(recentKey, JSON.stringify(oldRecent));
    values.set(replyKey(USER, SECRET), JSON.stringify(quoted(SECRET)));
    values.set(replyKey(USER, PLAIN), JSON.stringify(quoted(PLAIN)));
    values.set(replyKey(OTHER_USER, SECRET), JSON.stringify(quoted(SECRET)));
    values.set(ownDraftKey, ownDraft);

    const mx = createClient();
    stopKeeping = keepEncryptedRoomTextOffDisk(mx, [
      forgetEncryptedRecentThreadText,
      forgetEncryptedReplyText,
    ]);
    // Nothing changes before the client knows its rooms.
    expect(stored(recentKey)).toEqual(oldRecent);
    mx.emit(ClientEvent.Sync, SyncState.Prepared, null);

    expect(stored(recentKey)).toEqual({
      v: 1,
      entries: [
        { roomId: SECRET, threadId: '$secret-root', openedAt: 200 },
        { roomId: PLAIN, threadId: '$plain-root', openedAt: 100, summaryText: 'Lunch order' },
      ],
    });
    expect(stored(replyKey(USER, SECRET))).toEqual({
      userId: '@helper:example.org',
      eventId: `$answer-${SECRET}`,
      body: '',
      relation: { rel_type: 'm.thread', event_id: `$root-${SECRET}` },
    });
    expect(stored(replyKey(USER, PLAIN))).toEqual(quoted(PLAIN));
    // Another account's stores are its own client's to clean.
    expect(stored(replyKey(OTHER_USER, SECRET))).toEqual(quoted(SECRET));
    expect(values.get(ownDraftKey)).toBe(ownDraft);
  });
});
