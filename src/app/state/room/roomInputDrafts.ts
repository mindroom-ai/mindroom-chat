/**
 * Composer state per room and thread: the unsent message (kept in localStorage per account),
 * the message being replied to, staged attachments, and a voice message whose send failed.
 */
import { atom, type WritableAtom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import type { Descendant } from 'slate';
import type { IEventRelation, MatrixError, Room } from 'matrix-js-sdk';
import type { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import type { MindroomPasteMarker } from '../../mindroom/messages/pasteAttachmentMarker';
import type { TUploadContent } from '../../utils/matrix';
import { isRecord } from '../../utils/isRecord';
import {
  getSafeLocalStorage,
  getStorageItemSafe,
  getStorageKeysSafe,
  removeStorageItemSafe,
  setStorageItemSafe,
} from '../../utils/safeLocalStorage';
import { createUploadAtom, type TUploadAtom } from '../upload';

export type TUploadMetadata = {
  markedAsSpoiler: boolean;
  /** Set when the file holds text the composer turned into an attachment. */
  mindroomPasteAttachment?: Pick<MindroomPasteMarker, 'id' | 'chars' | 'fileName'>;
  /** Set when the file is a recorded voice message. */
  voiceMessage?: {
    /** Length in milliseconds. */
    duration: number;
    waveform?: number[];
  };
};

/** A file staged in the composer: what is uploaded (`file`), what the user chose, and how. */







  /** Preparing the file (for example encrypting it) failed; it cannot be uploaded. */
  prepError?: MatrixError;
};

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

// Unsent messages.

const DRAFT_STORAGE_PREFIX = 'roomInputDraft:';

/** The key of a composer draft: one per account, room, and thread. */
export const getRoomInputDraftKey = (userId: string, roomId: string, threadId?: string): string =>
  JSON.stringify(threadId === undefined ? [userId, roomId] : [userId, roomId, threadId]);

const getDraftUserId = (draftKey: string): string | undefined => {
  try {
    const parsed: unknown = JSON.parse(draftKey);
    return Array.isArray(parsed) && typeof parsed[0] === 'string' ? parsed[0] : undefined;
  } catch {
    return undefined;
  }
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

/** Forgets every unsent message of an account, in storage and in memory. */
export const clearRoomInputDrafts = (userId: string): void => {
  draftGenerations.set(userId, getDraftGeneration(userId) + 1);
  roomIdToMsgDraftAtomFamily.setShouldRemove(
    (_createdAt, draftKey) => getDraftUserId(draftKey) === userId
  );
  roomIdToMsgDraftAtomFamily.setShouldRemove(null);

  const storage = getSafeLocalStorage();
  getStorageKeysSafe(storage).forEach((storageKey) => {
    if (!storageKey.startsWith(DRAFT_STORAGE_PREFIX)) return;
    if (getDraftUserId(storageKey.slice(DRAFT_STORAGE_PREFIX.length)) !== userId) return;
    removeStorageItemSafe(storage, storageKey);
  });
};

// Replies.

/** The message the composer replies to, keyed like the message draft or by room ID. */
export const roomIdToReplyDraftAtomFamily = atomFamily((_key: string) =>
  atom<IReplyDraft | undefined>(undefined)
);

// Attachments.

export type TUploadListAction =
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

/** The upload state of a staged file. */
export const roomUploadAtomFamily = atomFamily(
  (file: TUploadContent): TUploadAtom => createUploadAtom(file)
);

// Voice messages.

export const pendingVoiceSendDraftAtom = atom<PendingVoiceSendDraft | undefined>(undefined);

/** True while a recorded voice message waits to be sent with the composer's attachments. */
export const voiceAutoSendPendingAtom = atom(false);
