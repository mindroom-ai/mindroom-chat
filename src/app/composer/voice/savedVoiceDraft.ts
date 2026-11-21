import { useEffect } from 'react';
import { atom, useAtomValue, useStore } from 'jotai';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { MatrixClient } from 'matrix-js-sdk';
import { isJoined } from '../../matrix/state/roomList';
import { isNativeVoiceRecorderAvailable } from '../../native/nativeVoiceRecorder';
import {
  pendingVoiceSendDraftAtom,
  replyDraftAtRest,
  type IReplyDraft,
  type PendingVoiceSendContext,
  type PendingVoiceSendDraft,
} from '../roomInputDrafts';
import {
  holdVoiceRecording,
  importNativeVoiceRecordings,
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

// One restore per account and store. Missing means not started, and null means settled. The
// microphone waits for it (useRoomInputVoice.tsx), so no recording runs while it fills the slot.
export const voiceDraftRestoresAtom = atom<ReadonlyMap<string, Promise<void> | null>>(new Map());

/**
 * Brings back what the account left on disk, once: its failed send where it was meant for, else
 * a journaled recording (a crash, a recorder that stopped) as a recovered one, which is sent
 * wherever Send is pressed; `getRecoveryContext` only names the account for it.
 */
export const useSavedVoiceDraft = (
  mx: MatrixClient,
  getRecoveryContext?: () => PendingVoiceSendContext
): void => {
  const store = useStore();
  const draft = useAtomValue(pendingVoiceSendDraftAtom);
  const userId = mx.getUserId() ?? undefined;

  useEffect(() => {
    if (!userId || store.get(voiceDraftRestoresAtom).has(userId)) return;
    const pending = withDraftDb((db) => db.get('drafts', userId))
      .then(async (saved) => {
        const slotTaken = () => !!store.get(pendingVoiceSendDraftAtom);
        if (slotTaken()) return;
        const canOffer = isNativeVoiceRecorderAvailable()
          ? await importNativeVoiceRecordings(userId)
          : undefined;
        if (slotTaken()) return;
        const savedRoom = saved && mx.getRoom(saved.roomId);
        const room = savedRoom && isJoined(savedRoom) ? savedRoom : undefined;
        const id = saved?.recordingId;
        if (
          saved &&
          room &&
          (!id || !globalThis.navigator?.locks || (await holdVoiceRecording(id)))
        ) {
          if ((id && canOffer && !(await canOffer(id))) || slotTaken()) {
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
          await recoverVoiceRecording(userId, room ? id : undefined, async (recording) => {
            if ((canOffer && !(await canOffer(recording.recordingId))) || slotTaken()) return false;
            store.set(pendingVoiceSendDraftAtom, {
              ...recording,
              recovered: true,
              context: getRecoveryContext(),
            });
            return true;
          });
        }
      })
      .finally(() => {
        store.set(voiceDraftRestoresAtom, (restores) => new Map(restores).set(userId, null));
      });
    store.set(voiceDraftRestoresAtom, (restores) => new Map(restores).set(userId, pending));
  }, [getRecoveryContext, mx, store, userId]);

  useEffect(() => {
    const owner = draft?.context.ownerSessionId;
    if (!draft || draft.recovered || draft.inFlight || userId !== owner) return;
    void saveVoiceDraft(draft, () => store.get(pendingVoiceSendDraftAtom) === draft);
  }, [draft, store, userId]);
};
