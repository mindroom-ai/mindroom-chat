import 'fake-indexeddb/auto';
import { EventEmitter } from 'node:events';
import { createStore, getDefaultStore } from 'jotai';
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
import {
  clearVoiceRecordings,
  transitionVoiceRecording,
  voiceCaptureJournal,
} from '../../composer/voice/voiceRecordingJournal';
import { createVoiceSendDraftController } from '../../composer/voice/voiceSendDraftController';
import { settleVoiceDraft } from '../../composer/voice/voiceDrafts';

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

/** A client of the reader's account that knows both rooms, syncing or not yet started. */
const createClient = (syncState: SyncState | null = null): MatrixClient =>
  Object.assign(new EventEmitter(), {
    getUserId: () => USER,
    getRoom: (roomId: string) => rooms.get(roomId) ?? null,
    getSyncState: () => syncState,
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
const holds = (value: unknown, text: string) => JSON.stringify(value).includes(text);

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
  await clearVoiceRecordings(USER);
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

  it.each([SECRET, PLAIN])(
    'parks a voice message that replies with the IDs of what it quotes, none of the text (%s)',
    async (roomId) => {
      // Before the rooms are known, as when a send ends after its client went: no room looks
      // encrypted then, so nothing here may depend on that.
      vi.stubGlobal('navigator', {
        locks: {
          request: (_name: string, _options: object, held: (lock: object) => unknown) => held({}),
        },
      });
      const store = createStore();
      // The recording is on disk from its first second; its failed send parks it there.
      const file = new File(['voice bytes'], 'voice.ogg', { type: 'audio/ogg' });
      const recordingId = `rec-${roomId}`;
      const capture = voiceCaptureJournal(() => USER);
      await capture.begin({ recordingId, startedAt: 1, mimeType: file.type });
      await capture.append(recordingId, 0, { data: file, elapsedMs: 1_000 });
      const controller = createVoiceSendDraftController(
        {
          read: () => store.get(pendingVoiceSendDraftAtom),
          write: (draft) => store.set(pendingVoiceSendDraftAtom, draft),
          settle: (...attempt) => settleVoiceDraft(store, ...attempt),
        },
        transitionVoiceRecording
      );
      await controller.sendInitial(
        { recordingId, file, duration: 1_000, waveform: undefined },
        {
          ownerSessionId: USER,
          roomId,
          room: rooms.get(roomId)!,
          threadId: undefined,
          replyDraft: quoted(roomId),
          threadingEnabled: true,
          signalBridgedRoom: false,
        },
        {
          sendRecording: async (_file, _duration, _waveform, context, attempt) => {
            await attempt.commit(context);
            throw new Error('offline');
          },
          onFailure: () => undefined,
        }
      );
      // In memory the parked draft keeps the text its reply bar shows.
      expect(store.get(pendingVoiceSendDraftAtom)?.context).toMatchObject({
        replyDraft: quoted(roomId),
      });
      const db = await openDB('mindroom-voice-journal', 1);
      const saved = await db.get('recordings', recordingId);
      db.close();
      expect(saved.destination).toEqual({
        roomId,
        threadId: undefined,
        replyEventId: `$answer-${roomId}`,
        replyThreadId: `$root-${roomId}`,
        threadingEnabled: true,
        threadView: undefined,
        // As what the event went out, which is no text of the room.
        encrypted: roomId === SECRET,
      });
      const { body, formattedBody, previewText } = quoted(roomId);
      [body, formattedBody, previewText].forEach((text) => {
        if (text) expect(JSON.stringify(saved)).not.toContain(text);
      });
      vi.unstubAllGlobals();
    }
  );

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

  it('deletes them at once when the client already knows its rooms', () => {
    values.set(replyKey(USER, SECRET), JSON.stringify(quoted(SECRET)));
    stopKeeping = keepEncryptedRoomTextOffDisk(createClient(SyncState.Syncing), [
      forgetEncryptedReplyText,
    ]);
    expect(stored(replyKey(USER, SECRET))).toMatchObject({ body: '' });
    expect(holds(stored(replyKey(USER, SECRET)), 'plan')).toBe(false);
  });
});
