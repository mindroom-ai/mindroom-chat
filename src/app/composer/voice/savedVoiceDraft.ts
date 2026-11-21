import { useEffect } from 'react';
import { useAtomValue, useStore } from 'jotai';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { MatrixClient } from 'matrix-js-sdk';
import { isJoined } from '../../matrix/state/roomList';
import {
  openVoiceRecorderAtom,
  pendingVoiceSendDraftAtom,
  replyDraftAtRest,
  type IReplyDraft,
  type PendingVoiceSendContext,
  type PendingVoiceSendDraft,
} from '../roomInputDrafts';
import {
  holdVoiceRecording,
  recoverVoiceRecording,
  releaseVoiceRecording,
} from './voiceRecordingJournal';

/**
 * A voice message whose send failed stays parked with Retry and Discard until it is sent or
 * discarded ("Your recording is still saved"). This keeps that recording in IndexedDB per account
 * too, so a reload or an app update does not lose it: the next composer puts it back, in the room
 * and thread it was meant for. Sign-out forgets it, as it does the drafts.
 */
type SavedVoiceDraft = {
  userId: string;
  recordingId?: string;
  // The recording's bytes, not the File: WebKit refuses to store a Blob in IndexedDB in a
  // private window.
  audio: ArrayBuffer;
  fileName: string;
  fileType: string;
  duration: number;
  waveform?: number[];
  errorMessage?: string;
  roomId: string;
  threadId?: string;
  replyDraft?: IReplyDraft;
  threadingEnabled: boolean;
  signalBridgedRoom: boolean;
  threadView?: boolean;
};

interface VoiceDraftDb extends DBSchema {
  drafts: { key: string; value: SavedVoiceDraft };
}

const openDraftDb = (): Promise<IDBPDatabase<VoiceDraftDb>> =>
  openDB<VoiceDraftDb>('mindroom-voice-drafts', 1, {
    upgrade(db) {
      db.createObjectStore('drafts', { keyPath: 'userId' });
    },
  });

// Storage that fails (private mode, full disk) leaves the recording in memory, as before.
const withDraftDb = async <T>(
  use: (db: IDBPDatabase<VoiceDraftDb>) => Promise<T>
): Promise<T | undefined> => {
  try {
    const db = await openDraftDb();
    try {
      return await use(db);
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
};

/** Forgets the account's parked voice message. */
export const clearSavedVoiceDraft = async (userId: string, match?: string): Promise<void> => {
  await withDraftDb((db) => {
    const tx = db.transaction('drafts', 'readwrite');
    const remove = tx.store.get(userId).then((saved) => {
      if (!match || match === (saved?.recordingId ?? saved?.fileName))
        return tx.store.delete(userId);
      return undefined;
    });
    return Promise.all([remove, tx.done]);
  });
};

const saveVoiceDraft = async (
  draft: PendingVoiceSendDraft,
  isCurrent: () => boolean
): Promise<void> => {
  const { context, file } = draft;
  const userId = context.ownerSessionId;
  const audio = await file.arrayBuffer().catch(() => undefined);
  if (!audio) return;
  await withDraftDb(async (db) => {
    if (!isCurrent()) return;
    await db.put('drafts', {
      userId,
      recordingId: draft.recordingId,
      audio,
      fileName: file.name,
      fileType: file.type,
      duration: draft.duration,
      waveform: draft.waveform,
      errorMessage: draft.errorMessage,
      roomId: context.roomId,
      threadId: context.threadId,
      replyDraft: replyDraftAtRest(userId, context.roomId, context.replyDraft),
      threadingEnabled: context.threadingEnabled,
      signalBridgedRoom: context.signalBridgedRoom,
      threadView: context.threadView,
    });
  });
};

export const readSavedVoiceDraft = (userId: string) =>
  withDraftDb((db) => db.get('drafts', userId));
export const hasSavedVoiceDraft = async (userId: string) =>
  !!(await withDraftDb((db) => db.getKey('drafts', userId)));

export const restoreSavedVoiceDraft = async (
  mx: MatrixClient,
  store: ReturnType<typeof useStore>,
  userId: string,
  getRecoveryContext?: () => PendingVoiceSendContext
): Promise<void> => {
  const saved = await readSavedVoiceDraft(userId);
  const slotTaken = () =>
    !!(store.get(pendingVoiceSendDraftAtom) || store.get(openVoiceRecorderAtom));
  if (slotTaken()) return;
  const savedRoom = saved && mx.getRoom(saved.roomId);
  const room = savedRoom && isJoined(savedRoom) ? savedRoom : undefined;
  const id = saved?.recordingId;
  if (saved && room && (!id || !globalThis.navigator?.locks || (await holdVoiceRecording(id)))) {
    if (slotTaken()) {
      if (id) releaseVoiceRecording(id);
      return;
    }
    store.set(pendingVoiceSendDraftAtom, {
      recordingId: id,
      file: new File([saved.audio], saved.fileName, { type: saved.fileType }),
      duration: saved.duration,
      waveform: saved.waveform,
      errorMessage: saved.errorMessage,
      context: {
        ownerSessionId: userId,
        roomId: saved.roomId,
        room,
        threadId: saved.threadId,
        replyDraft: saved.replyDraft,
        threadingEnabled: saved.threadingEnabled,
        signalBridgedRoom: saved.signalBridgedRoom,
        ...(saved.threadView && { threadView: true }),
      },
    });
  } else if (getRecoveryContext) {
    await recoverVoiceRecording(userId, room ? id : undefined, (recording) => {
      if (slotTaken()) return false;
      store.set(pendingVoiceSendDraftAtom, {
        ...recording,
        recovered: true,
        context: getRecoveryContext(),
      });
      return true;
    });
  }
};

// Restore once per account and page, unless Send it asks to show a stored account's draft.
const restored = new Set<string>();
export const allowVoiceDraftRestore = (userId: string): void => {
  restored.delete(userId);
};

export const useSavedVoiceDraft = (
  mx: MatrixClient,
  getRecoveryContext?: () => PendingVoiceSendContext
): void => {
  const store = useStore();
  const draft = useAtomValue(pendingVoiceSendDraftAtom);
  const userId = mx.getUserId() ?? undefined;

  useEffect(() => {
    if (!userId || restored.has(userId)) return;
    restored.add(userId);
    void restoreSavedVoiceDraft(mx, store, userId, getRecoveryContext);
  }, [getRecoveryContext, mx, store, userId]);

  useEffect(() => {
    const owner = draft?.context.ownerSessionId;
    if (!draft || draft.recovered || draft.inFlight || userId !== owner) return;
    void saveVoiceDraft(draft, () => store.get(pendingVoiceSendDraftAtom) === draft);
  }, [draft, store, userId]);
};
