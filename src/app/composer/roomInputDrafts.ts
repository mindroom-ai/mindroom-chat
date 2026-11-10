/**
 * Composer state per room and thread: the unsent message (kept in localStorage per account, the
 * text of its large pastes in IndexedDB), the message being replied to (kept there too), staged
 * attachments (only their names are kept), and a voice message whose send failed.
 */
import { atom, type createStore, type WritableAtom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import type { Descendant } from 'slate';
import type { IEventRelation, Room } from 'matrix-js-sdk';
import type { TUploadContent } from '../matrix/matrix';
import { isRecord } from '../lib/isRecord';
import {
  getSafeLocalStorage,
  getStorageItemSafe,
  getStorageKeysSafe,
  removeStorageItemSafe,
  setStorageItemSafe,
} from '../lib/safeLocalStorage';
import { createUploadAtom, type TUploadAtom, type TUploadItem } from '../matrix/state/upload';
import { isEncryptedRoomOf } from '../matrix/client/encryptedRoomTextOffDisk';
import { clearKeptPastes } from './keptPastes';
import { composerStateKey } from '../navigation/conversationView';

// TUploadItem is declared with the upload state; this seam keeps exporting it (seams.tsv).
export type { TUploadItem } from '../matrix/state/upload';

export type IReplyDraft = {
  userId: string;
  eventId: string;
  body: string;
  formattedBody?: string;
  relation?: IEventRelation;
  /** Text shown in the reply bar instead of `body`. */
  previewText?: string;
};

/** Where a voice message goes, captured when recording ends. */
export type PendingVoiceSendContext = {
  /** The account that recorded it; another account never sends it. */
  ownerSessionId: string;
  roomId: string;
  room: Room;
  threadId: string | undefined;
  replyDraft: IReplyDraft | undefined;
  threadingEnabled: boolean;
  signalBridgedRoom: boolean;
  /**
   * Recorded in a thread's own view (room/ThreadView.tsx), not on the room's page: after a failed
   * send it comes back in a view of that thread, never on the page.
   */
  threadView?: boolean;
};

export type PendingVoiceSendInFlight = {
  token: string;
  startedAt: number;
};

/** A recorded voice message kept for retry after its send failed. */
export type PendingVoiceSendDraft = {
  file: File;
  duration: number;
  waveform?: number[];
  context: PendingVoiceSendContext;
  errorMessage?: string;
  inFlight?: PendingVoiceSendInFlight;
};

type JotaiStore = ReturnType<typeof createStore>;

// Unsent messages.

const DRAFT_STORAGE_PREFIX = 'roomInputDraft:';

/** The key of a composer draft: one per account, room, and thread. */
export const getRoomInputDraftKey = (userId: string, roomId: string, threadId?: string): string =>
  JSON.stringify(threadId === undefined ? [userId, roomId] : [userId, roomId, threadId]);

/** The account, room and thread a draft key names. */
const parseDraftKey = (draftKey: string): unknown[] => {
  try {
    const parsed: unknown = JSON.parse(draftKey);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const getDraftUserId = (draftKey: string): string | undefined => {
  const [userId] = parseDraftKey(draftKey);
  return typeof userId === 'string' ? userId : undefined;
};

const isTextNode = (node: Record<string, unknown>): boolean =>
  typeof node.text === 'string' && !('children' in node);

const isDescendant = (node: unknown): boolean => {
  if (!isRecord(node)) return false;
  if (isTextNode(node)) return true;
  return (
    Array.isArray(node.children) && node.children.length > 0 && node.children.every(isDescendant)
  );
};

const isElement = (node: unknown): boolean =>
  isRecord(node) && !isTextNode(node) && isDescendant(node);

const readDraft = (storageKey: string): Descendant[] => {
  const raw = getStorageItemSafe(getSafeLocalStorage(), storageKey);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every(isElement) ? (parsed as Descendant[]) : [];
  } catch {
    return [];
  }
};

// Clearing an account's drafts revokes the atoms it created: a component still holding one
// can keep editing in memory but no longer writes to storage.
const draftGenerations = new Map<string, number>();
const getDraftGeneration = (userId: string | undefined) =>
  userId === undefined ? 0 : draftGenerations.get(userId) ?? 0;

const createMsgDraftAtom = (draftKey: string): WritableAtom<Descendant[], [Descendant[]], void> => {
  const storageKey = `${DRAFT_STORAGE_PREFIX}${draftKey}`;
  const userId = getDraftUserId(draftKey);
  const generation = getDraftGeneration(userId);
  const valueAtom = atom<Descendant[] | undefined>(undefined);

  return atom<Descendant[], [Descendant[]], void>(
    (get) => get(valueAtom) ?? readDraft(storageKey),
    (_get, set, draft) => {
      set(valueAtom, draft);
      if (getDraftGeneration(userId) !== generation) return;
      const storage = getSafeLocalStorage();
      if (draft.length === 0) {
        removeStorageItemSafe(storage, storageKey);
        return;
      }
      setStorageItemSafe(storage, storageKey, JSON.stringify(draft));
    }
  );
};

/** The unsent message of a composer, keyed by `getRoomInputDraftKey`. */
export const roomIdToMsgDraftAtomFamily = atomFamily(createMsgDraftAtom);

/** Moves a draft to another composer's, after the text that one holds: the thread it was in went. */
export const moveMessageDraft = (store: JotaiStore, fromKey: string, toKey: string): void => {
  const from = roomIdToMsgDraftAtomFamily(fromKey);
  const to = roomIdToMsgDraftAtomFamily(toKey);
  const draft = store.get(from);
  if (draft.length > 0) store.set(to, [...store.get(to), ...draft]);
  store.set(from, []);
};

// What else a reload keeps, per account and room: the message being replied to, and the names of
// the staged files, which cannot be kept themselves.
const REPLY_STORAGE_PREFIX = 'roomInputReply:';
const STAGED_FILES_STORAGE_PREFIX = 'roomInputStagedFiles:';
const STORAGE_PREFIXES = [DRAFT_STORAGE_PREFIX, REPLY_STORAGE_PREFIX, STAGED_FILES_STORAGE_PREFIX];

/**
 * Forgets every unsent message of an account, in storage and in memory, with the reply targets,
 * staged file names and paste texts it kept.
 */
export const clearRoomInputDrafts = (userId: string): void => {
  draftGenerations.set(userId, getDraftGeneration(userId) + 1);
  clearKeptPastes(userId).catch(() => undefined);
  roomIdToMsgDraftAtomFamily.setShouldRemove(
    (_createdAt, draftKey) => getDraftUserId(draftKey) === userId
  );
  roomIdToMsgDraftAtomFamily.setShouldRemove(null);

  const storage = getSafeLocalStorage();
  getStorageKeysSafe(storage).forEach((storageKey) => {
    const prefix = STORAGE_PREFIXES.find((candidate) => storageKey.startsWith(candidate));
    if (prefix === undefined) return;
    if (getDraftUserId(storageKey.slice(prefix.length)) !== userId) return;
    removeStorageItemSafe(storage, storageKey);
  });
};

const roomStorageKey = (prefix: string, userId: string, roomId: string): string =>
  `${prefix}${getRoomInputDraftKey(userId, roomId)}`;

const readStoredJson = (storageKey: string): unknown => {
  const raw = getStorageItemSafe(getSafeLocalStorage(), storageKey);
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
};

/** Stores `value` as JSON, or removes the entry for undefined. */
const writeStoredJson = (storageKey: string, value: unknown): void => {
  const storage = getSafeLocalStorage();
  if (value === undefined) removeStorageItemSafe(storage, storageKey);
  else setStorageItemSafe(storage, storageKey, JSON.stringify(value));
};

// Replies.

/** The message the composer replies to, keyed like the message draft or by room ID. */
export const roomIdToReplyDraftAtomFamily = atomFamily((_key: string) =>
  atom<IReplyDraft | undefined>(undefined)
);

/** The reply of the composer in `roomId` of the conversation view `view`, none for the room page. */
export const composerReplyDraftAtom = (roomId: string, view: string | undefined) =>
  roomIdToReplyDraftAtomFamily(composerStateKey(roomId, view));

const isOptionalString = (value: unknown): boolean =>
  value === undefined || typeof value === 'string';

const isReplyDraft = (value: unknown): value is IReplyDraft =>
  isRecord(value) &&
  typeof value.userId === 'string' &&
  typeof value.eventId === 'string' &&
  typeof value.body === 'string' &&
  isOptionalString(value.formattedBody) &&
  isOptionalString(value.previewText) &&
  (value.relation === undefined || isRecord(value.relation));

/**
 * A reply target as it goes to disk. In an encrypted room it names the message only, without the
 * text read out of it (P2-e2ee-F011); the reply bar reads that again from the message.
 */
export const replyDraftAtRest = (
  userId: string,
  roomId: string,
  draft: IReplyDraft | undefined
): IReplyDraft | undefined =>
  draft && isEncryptedRoomOf(userId, roomId)
    ? { userId: draft.userId, eventId: draft.eventId, body: '', relation: draft.relation }
    : draft;

/** Keeps the reply target of an account's composer in a room for the next page, or forgets it. */
export const keepReplyDraft = (
  userId: string,
  roomId: string,
  draft: IReplyDraft | undefined
): void =>
  writeStoredJson(
    roomStorageKey(REPLY_STORAGE_PREFIX, userId, roomId),
    replyDraftAtRest(userId, roomId, draft)
  );

/** Deletes the text an older version kept with the reply targets of the account's encrypted rooms. */
export const forgetEncryptedReplyText = (userId: string): void => {
  getStorageKeysSafe(getSafeLocalStorage()).forEach((storageKey) => {
    if (!storageKey.startsWith(REPLY_STORAGE_PREFIX)) return;
    const [owner, roomId] = parseDraftKey(storageKey.slice(REPLY_STORAGE_PREFIX.length));
    if (owner !== userId || typeof roomId !== 'string') return;
    const kept = readStoredJson(storageKey);
    if (!isReplyDraft(kept) || !isEncryptedRoomOf(userId, roomId)) return;
    if (!kept.body && kept.formattedBody === undefined && kept.previewText === undefined) return;
    writeStoredJson(storageKey, replyDraftAtRest(userId, roomId, kept));
  });
};

/**
 * Gives a room's composer back the reply target it had before a reload, unless it has one: the
 * reply bar comes back with the text.
 */
export const restoreKeptReplyDraft = (store: JotaiStore, userId: string, roomId: string): void => {
  const replyAtom = roomIdToReplyDraftAtomFamily(roomId);
  if (store.get(replyAtom) !== undefined) return;
  const kept = readStoredJson(roomStorageKey(REPLY_STORAGE_PREFIX, userId, roomId));
  if (isReplyDraft(kept)) store.set(replyAtom, kept);
};

// Attachments.

type TUploadListAction =
  | { type: 'PUT'; item: TUploadItem | TUploadItem[] }
  | { type: 'DELETE'; item: TUploadItem | TUploadItem[] }
  | { type: 'REPLACE'; item: TUploadItem; replacement: TUploadItem }
  | { type: 'RESET' };

const toItems = (item: TUploadItem | TUploadItem[]): TUploadItem[] =>
  Array.isArray(item) ? item : [item];

const createUploadListAtom = () => {
  const itemsAtom = atom<TUploadItem[]>([]);
  return atom<TUploadItem[], [TUploadListAction], void>(
    (get) => get(itemsAtom),
    (get, set, action) => {
      const current = get(itemsAtom);
      if (action.type === 'RESET') {
        if (current.length > 0) set(itemsAtom, []);
        return;
      }
      if (action.type === 'REPLACE') {
        set(
          itemsAtom,
          current.map((item) => (item === action.item ? action.replacement : item))
        );
        return;
      }
      const items = toItems(action.item);
      if (action.type === 'PUT') {
        const added = items.filter((item) => !current.includes(item));
        if (added.length > 0) set(itemsAtom, [...current, ...added]);
        return;
      }
      // An item goes when it, or another item for the same file, is removed.
      const removedFiles = new Set(items.map((item) => item.file));
      const next = current.filter((item) => !removedFiles.has(item.file));
      if (next.length !== current.length) set(itemsAtom, next);
    }
  );
};

/** Files staged in a room's composer, in the order they were added. */
export const roomIdToUploadItemsAtomFamily = atomFamily((_roomId: string) =>
  createUploadListAtom()
);

/** The files staged in the composer in `roomId` of the conversation view `view`. */
export const composerUploadItemsAtom = (roomId: string, view: string | undefined) =>
  roomIdToUploadItemsAtomFamily(composerStateKey(roomId, view));
export type StagedList = ReturnType<typeof composerUploadItemsAtom>;

/** The upload state of a staged file. */
export const roomUploadAtomFamily = atomFamily(
  (file: TUploadContent): TUploadAtom => createUploadAtom(file)
);

/**
 * Keeps the names of the files staged in a room, so the composer after a reload can say which
 * ones it lost; none staged forgets them.
 */
export const keepStagedFileNames = (userId: string, roomId: string, items: TUploadItem[]): void =>
  writeStoredJson(
    roomStorageKey(STAGED_FILES_STORAGE_PREFIX, userId, roomId),
    items.length > 0 ? items.map((item) => item.originalFile.name) : undefined
  );

/** The names of the files a room's composer had staged when they were last kept. */
export const readKeptFileNames = (userId: string, roomId: string): string[] => {
  const kept = readStoredJson(roomStorageKey(STAGED_FILES_STORAGE_PREFIX, userId, roomId));
  return Array.isArray(kept) ? kept.filter((name): name is string => typeof name === 'string') : [];
};

// Voice messages.

export const pendingVoiceSendDraftAtom = atom<PendingVoiceSendDraft | undefined>(undefined);

/** True while a recorded voice message waits to be sent with the composer's attachments. */
export const voiceAutoSendPendingAtom = atom(false);

/** The composer a recorded voice message belongs to: its room's page or a view of its thread. */
export const voiceComposerKey = ({
  roomId,
  threadId,
  threadView,
}: Pick<PendingVoiceSendContext, 'roomId' | 'threadId' | 'threadView'>): string =>
  threadView ? JSON.stringify([roomId, threadId]) : roomId;

/** The composer whose voice recorder is open, one at a time: opening another closes it. */
export const openVoiceRecorderAtom = atom<symbol | undefined>(undefined);

/** The room whose page composer shows its voice recorder: recording, or a recording to send. */
export const voiceRecorderRoomAtom = atom<string | undefined>(undefined);

// What a reload would lose.

/** The keys a family holds atoms for, listed without creating or removing any. */
const familyKeys = <Key>(family: {
  setShouldRemove: (test: ((createdAt: number, key: Key) => boolean) | null) => void;
}): Key[] => {
  const keys: Key[] = [];
  family.setShouldRemove((_createdAt, key) => {
    keys.push(key);
    return false;
  });
  family.setShouldRemove(null);
  return keys;
};

/**
 * Whether a composer holds something that only lives in memory, so a page reload would drop it:
 * a staged file, the message being replied to, or a recorded voice message. Typed text is not one:
 * every change is written to localStorage, and the reloaded composer restores it.
 */
export const composersHoldUnsavedWork = (store: JotaiStore): boolean =>
  store.get(pendingVoiceSendDraftAtom) !== undefined ||
  store.get(voiceAutoSendPendingAtom) ||
  familyKeys(roomIdToUploadItemsAtomFamily).some(
    (roomId) => store.get(roomIdToUploadItemsAtomFamily(roomId)).length > 0
  ) ||
  familyKeys(roomIdToReplyDraftAtomFamily).some(
    (key) => store.get(roomIdToReplyDraftAtomFamily(key)) !== undefined
  );

// Leaving an account.

const dropEveryEntry = (family: { setShouldRemove: (test: (() => boolean) | null) => void }) => {
  family.setShouldRemove(() => true);
  family.setShouldRemove(null);
};

/**
 * Forgets what an account left in its composers when its session ends: reply targets, staged
 * files and a voice send in progress. These are keyed by room alone, so the next account to open
 * a room both accounts are in would otherwise show them and send them as its own. Unsent
 * messages stay, since they are kept per account. A recorded voice message waiting for a retry
 * stays too: it names its account and no other one sends it. No recorder stays open.
 */
export const forgetComposerStateOfSession = (store: JotaiStore): void => {
  dropEveryEntry(roomIdToReplyDraftAtomFamily);
  dropEveryEntry(roomIdToUploadItemsAtomFamily);
  store.set(voiceAutoSendPendingAtom, false);
  store.set(openVoiceRecorderAtom, undefined);
  store.set(voiceRecorderRoomAtom, undefined);
};
