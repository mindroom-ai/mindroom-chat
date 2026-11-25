/**
 * Composer state per room and thread: the unsent message (kept in localStorage per account, the
 * text of its large pastes in IndexedDB), the message being replied to (kept there too), staged
 * attachments (only their names are kept), and a voice message whose send failed.
 */
import { atom, type createStore, type WritableAtom } from 'jotai';
import { atomFamily } from 'jotai-family';
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
import { getActiveSession, subscribeToSessionStore } from '../matrix/session/sessions';
import { clearKeptPastes } from './keptPastes';
import { abortAllMediaCompressions } from './mediaCompressionJobs';
import {
  captureDiscardsInFlightAtom,
  endLiveCapturesOfAccount,
  liveCaptureAtom,
} from './capture/liveCapture';
import { composerStateKey } from '../navigation/conversationView';
import type { MidTurnMode } from '../preferences/midTurnModes';
import type { DictationSession } from './dictation/dictationSession';

// TUploadItem is declared with the upload state; this module keeps exporting it.
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

/** Where a voice message goes: the composer its Send was pressed in, read at that moment. */
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
   * Sent from a thread's own view (room/ThreadView.tsx), not from the room's page: after a failed
   * send it comes back in a view of that thread, or on the room's page while it shows that thread.
   */
  threadView?: boolean;
  /** The mid-turn mode picked when this send started, kept for a retry. */
  midTurnMode?: MidTurnMode;
};

export type PendingVoiceSendInFlight = {
  token: string;
  startedAt: number;
};

/** A recovered recording or a voice message kept for retry. */
export type PendingVoiceSendDraft = {
  recordingId?: string;
  recovered?: boolean;
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

/** The key of Home's ask field draft: one per account, whichever room it is to go to. */
export const getHomeAskDraftKey = (userId: string): string => JSON.stringify([userId]);

/** Where Home's ask draft goes: the agent and the room, null for a direct chat yet to start. */
export type HomeAskDestination = {
  agentId: string;
  roomId: string | null;
  /** The room was chosen as the agent's direct chat: the question goes only while it is one. */
  isDirect?: boolean;
};

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

const asDraft = (stored: unknown): Descendant[] =>
  Array.isArray(stored) && stored.every(isElement) ? (stored as Descendant[]) : [];

const isHomeAskDestination = (value: unknown): value is HomeAskDestination =>
  isRecord(value) &&
  typeof value.agentId === 'string' &&
  (value.roomId === null || typeof value.roomId === 'string') &&
  (value.isDirect === undefined || typeof value.isDirect === 'boolean');

/** Home's ask draft: its text and where it goes. */
type HomeAskEntry = { draft: Descendant[]; destination: HomeAskDestination | undefined };

const readHomeAskEntry = (storageKey: string): HomeAskEntry => {
  const stored = readStoredJson(storageKey);
  if (!isRecord(stored)) return { draft: [], destination: undefined };
  return {
    draft: asDraft(stored.draft),
    destination: isHomeAskDestination(stored.destination) ? stored.destination : undefined,
  };
};

const sameDestination = (a?: HomeAskDestination, b?: HomeAskDestination): boolean =>
  a?.agentId === b?.agentId && a?.roomId === b?.roomId && !!a?.isDirect === !!b?.isDirect;

// Clearing an account's drafts revokes the atoms it created: a component still holding one
// can keep editing in memory but no longer writes to storage.
const draftGenerations = new Map<string, number>();
const getDraftGeneration = (userId: string | undefined) =>
  userId === undefined ? 0 : (draftGenerations.get(userId) ?? 0);

/**
 * An account's Home ask draft: its text and where it goes, read from storage in one snapshot and
 * stored in one entry, written at once. A write from another tab so never leaves this tab's text
 * with that tab's room, neither as a tab first reads the draft nor after.
 */
const homeAskEntryAtomFamily = atomFamily((userId: string) => {
  const storageKey = `${DRAFT_STORAGE_PREFIX}${getHomeAskDraftKey(userId)}`;
  const generation = getDraftGeneration(userId);
  const valueAtom = atom<HomeAskEntry | undefined>(undefined);
  const entryAtom: WritableAtom<HomeAskEntry, [Partial<HomeAskEntry>], void> = atom(
    (get) => get(valueAtom) ?? readHomeAskEntry(storageKey),
    (get, set, change) => {
      const entry = { ...get(entryAtom), ...change };
      set(valueAtom, entry);
      if (getDraftGeneration(userId) !== generation) return;
      const storage = getSafeLocalStorage();
      if (entry.draft.length > 0) setStorageItemSafe(storage, storageKey, JSON.stringify(entry));
      // An emptied draft leaves no entry. Where an empty draft goes is kept in memory alone.
      else if (change.draft) removeStorageItemSafe(storage, storageKey);
    }
  );
  return entryAtom;
});

// Latest in-memory draft written in this store per key, kept separate from
// `roomIdToMsgDraftAtomFamily` so read-only observers (such as sidebar draft marks) never prime an
// unopened room's draft atom cache with an empty storage read before the composer opens.
const writtenMsgDraftAtomFamily = atomFamily((_draftKey: string) =>
  atom<Descendant[] | undefined>(undefined)
);

const createMsgDraftAtom = (draftKey: string): WritableAtom<Descendant[], [Descendant[]], void> => {
  const storageKey = `${DRAFT_STORAGE_PREFIX}${draftKey}`;
  const userId = getDraftUserId(draftKey);
  if (userId !== undefined && draftKey === getHomeAskDraftKey(userId)) {
    const entryAtom = homeAskEntryAtomFamily(userId);
    return atom(
      (get) => get(entryAtom).draft,
      (_get, set, draft) => set(entryAtom, { draft })
    );
  }
  const generation = getDraftGeneration(userId);
  const valueAtom = atom<Descendant[] | undefined>(undefined);
  const writtenAtom = writtenMsgDraftAtomFamily(draftKey);

  return atom<Descendant[], [Descendant[]], void>(
    (get) => get(valueAtom) ?? asDraft(readStoredJson(storageKey)),
    (_get, set, draft) => {
      set(valueAtom, draft);
      set(writtenAtom, draft);
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

/**
 * In-memory draft updates written in the current store (`undefined` until this store writes the
 * key), so sidebar observers can react to live edits without touching `roomIdToMsgDraftAtomFamily`.
 */
export const roomIdToWrittenMsgDraftAtomFamily = writtenMsgDraftAtomFamily;

/** Storage key for the persisted composer draft under `draftKey`. */
export const getMsgDraftStorageKey = (draftKey: string): string =>
  `${DRAFT_STORAGE_PREFIX}${draftKey}`;

/** Reads the persisted draft under `draftKey` directly from storage without creating its atom. */
export const readStoredMsgDraft = (draftKey: string): Descendant[] =>
  asDraft(readStoredJson(getMsgDraftStorageKey(draftKey)));

/** Whether a draft is kept under `draftKey`, read without creating its atom. */
export const hasKeptDraft = (draftKey: string): boolean =>
  getStorageItemSafe(getSafeLocalStorage(), `${DRAFT_STORAGE_PREFIX}${draftKey}`) !== null;

/**
 * The agent and room an account's Home ask draft goes to, also after Home has gone: the one stored
 * with the text a reload finds, then the one Home shows. A change is stored with the text in the
 * draft's entry; set to what it is, it writes nothing, so a page that only shows a stored draft
 * never replaces a newer one of another tab.
 */
export const homeAskDestinationAtomFamily = atomFamily((userId: string) => {
  const entryAtom = homeAskEntryAtomFamily(userId);
  return atom(
    (get) => get(entryAtom).destination,
    (get, set, destination: HomeAskDestination | undefined) => {
      if (!sameDestination(get(entryAtom).destination, destination)) {
        set(entryAtom, { destination });
      }
    }
  );
});

/**
 * Home's question on its way, per account: being sent, or sent as the message `eventId` that the
 * server has yet to confirm (or that is yet to be deleted), with the agent and room it went to.
 * It outlives Home's page, which can close and open again meanwhile.
 */
export type HomeAskPending = {
  roomId: string;
  agentId: string;
  isDirect: boolean;
} & ({ state: 'sending' } | { state: 'echo'; eventId: string });
export const homeAskPendingAtomFamily = atomFamily((_userId: string) =>
  atom<HomeAskPending | undefined>(undefined)
);

/** Puts text back into the stored draft `draftKey`, after any text typed there since. */
export const restoreTextToDraft = (
  store: JotaiStore,
  draftKey: string,
  fragment: Descendant[]
): void => {
  if (fragment.length === 0) return;
  const draftAtom = roomIdToMsgDraftAtomFamily(draftKey);
  store.set(draftAtom, [...store.get(draftAtom), ...fragment]);
};

/** Moves a thread's draft to another composer's in the room, after the text that one holds. */
export const moveMessageDraft = (
  store: JotaiStore,
  userId: string,
  roomId: string,
  fromThreadId: string | undefined,
  toThreadId?: string
): void => {
  const from = roomIdToMsgDraftAtomFamily(getRoomInputDraftKey(userId, roomId, fromThreadId));
  const to = roomIdToMsgDraftAtomFamily(getRoomInputDraftKey(userId, roomId, toThreadId));
  const draft = store.get(from);
  if (draft.length > 0) store.set(to, [...store.get(to), ...draft]);
  store.set(from, []);
};

// What else a reload keeps, per account and room: the message being replied to, and the names of
// the staged files (which cannot be kept themselves).
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
  writtenMsgDraftAtomFamily.setShouldRemove(
    (_createdAt, draftKey) => getDraftUserId(draftKey) === userId
  );
  writtenMsgDraftAtomFamily.setShouldRemove(null);
  homeAskEntryAtomFamily.remove(userId);
  homeAskDestinationAtomFamily.remove(userId);
  homeAskPendingAtomFamily.remove(userId);

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
export const roomUploadAtomFamily = atomFamily((file: TUploadContent): TUploadAtom =>
  createUploadAtom(file)
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

/** A dictation session detached from its composer to finish and send in the background. */
export type DetachedDictationSend = {
  readonly ownerKey: string;
  readonly roomId: string;
  readonly roomName: string;
  readonly status: 'sending' | 'failed';
  readonly session: DictationSession;
  readonly retryAndSend: () => void;
  readonly insertPartial: () => void;
  readonly discard: () => Promise<void>;
  readonly abort: () => void;
};

/** Non-blocking shell notice when a detached dictation send fails or detects no speech off-thread. */
export type DetachedDictationError = {
  readonly ownerKey: string;
  readonly roomName: string;
  readonly kind: 'failed' | 'noSpeech';
};

/** In-flight and failed background Finish & Send dictations, keyed by stable composer send key. */
export const detachedDictationSendsAtom = atom<ReadonlyMap<string, DetachedDictationSend>>(
  new Map()
);

/** Shell-level alert for a detached dictation send that failed while the user was elsewhere. */
export const detachedDictationErrorAtom = atom<DetachedDictationError | undefined>(undefined);

/** The composer a recorded voice message belongs to: its room's page or a view of its thread. */
export const voiceComposerKey = ({
  roomId,
  threadId,
  threadView,
}: Pick<PendingVoiceSendContext, 'roomId' | 'threadId' | 'threadView'>): string =>
  threadView ? JSON.stringify([roomId, threadId]) : roomId;

/** The composers of thread views that are mounted, by `voiceComposerKey`, each one entry. */
export const threadViewVoiceComposersAtom = atom<readonly { key: string; view: string }[]>([]);

/**
 * A destination's composers against an offered draft: empty, holding the offer, or busy with its
 * work, in each composer mounted for it (folded too): a thread's views, or the room's page.
 */
export const composerOfferAtom = (
  key: [string, string, string?],
  offer: Descendant[],
  confirm: (room: Room, threadId?: string) => string | undefined // a parked echo root, confirmed
) =>
  atom((get): 'empty' | 'offered' | 'busy' => {
    const [, roomId, threadId] = key;
    const owner = voiceComposerKey({ roomId, threadId, threadView: threadId !== undefined });
    const views = threadId
      ? get(threadViewVoiceComposersAtom).flatMap((c) => (c.key === owner ? [c.view] : []))
      : [undefined];
    const voice = get(pendingVoiceSendDraftAtom)?.context;
    const parked = voice && { ...voice, threadId: confirm(voice.room, voice.threadId) };
    const busy =
      (!!parked && voiceComposerKey(parked) === owner) ||
      views.some(
        (v) =>
          get(composerUploadItemsAtom(roomId, v)).length || get(composerReplyDraftAtom(roomId, v))
      );
    const draft = get(roomIdToMsgDraftAtomFamily(getRoomInputDraftKey(...key)));
    if (busy || draft.length === 0) return busy ? 'busy' : 'empty';
    return JSON.stringify(draft) === JSON.stringify(offer) ? 'offered' : 'busy';
  });

// What a reload would lose.

/**
 * Whether a composer holds something that only lives in memory, so a page reload would drop it:
 * a staged file, the message being replied to, or a voice message, recorded or being recorded.
 * Typed text is not one: every change is written to localStorage, and the reloaded composer
 * restores it.
 */
export const composersHoldUnsavedWork = (store: JotaiStore): boolean =>
  store.get(liveCaptureAtom) !== undefined ||
  store.get(pendingVoiceSendDraftAtom) !== undefined ||
  store.get(captureDiscardsInFlightAtom) > 0 ||
  store.get(voiceAutoSendPendingAtom) ||
  store.get(detachedDictationSendsAtom).size > 0 ||
  [...roomIdToUploadItemsAtomFamily.getParams()].some(
    (roomId) => store.get(roomIdToUploadItemsAtomFamily(roomId)).length > 0
  ) ||
  [...roomIdToReplyDraftAtomFamily.getParams()].some(
    (key) => store.get(roomIdToReplyDraftAtomFamily(key)) !== undefined
  );

// Leaving an account.

const dropEveryEntry = (family: { setShouldRemove: (test: (() => boolean) | null) => void }) => {
  family.setShouldRemove(() => true);
  family.setShouldRemove(null);
};

/**
 * Forgets what an account left in its composers when its session ends: reply targets, staged
 * files, a voice send in progress and Home's question on its way. A room's are keyed by room
 * alone, so the next account to open a room both accounts are in would otherwise show them and
 * send them as its own. Unsent messages stay, since they are kept per account. A recorded voice
 * message waiting for a retry stays too: it names its account and no other one sends it. A voice
 * message still being recorded ends, and so does one whose Send is still on its way: the
 * microphone is released at once, and neither writes anything under the next account.
 */
export const forgetComposerStateOfSession = (store: JotaiStore): void => {
  abortAllMediaCompressions();
  dropEveryEntry(roomIdToReplyDraftAtomFamily);
  dropEveryEntry(roomIdToUploadItemsAtomFamily);
  dropEveryEntry(homeAskPendingAtomFamily);
  store.set(voiceAutoSendPendingAtom, false);
  endLiveCapturesOfAccount(store);
  store.get(detachedDictationSendsAtom).forEach((entry) => entry.abort());
  store.set(detachedDictationSendsAtom, new Map());
  store.set(detachedDictationErrorAtom, undefined);
};

// Only logout or another session ends the account's voice work, not a route unmount. Sessions
// are told apart by their id: two can share a Matrix user id on different homeservers.
export const watchComposerAccount = (store: JotaiStore): (() => void) => {
  let sessionId = getActiveSession()?.sessionId;
  return subscribeToSessionStore(() => {
    const next = getActiveSession()?.sessionId;
    if (next === sessionId) return;
    const previous = sessionId;
    sessionId = next;
    if (previous !== undefined) forgetComposerStateOfSession(store);
  });
};
