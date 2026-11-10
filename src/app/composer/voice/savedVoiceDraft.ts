import { useEffect } from 'react';
import { useAtomValue, useStore } from 'jotai';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { MatrixClient } from 'matrix-js-sdk';
import {
  pendingVoiceSendDraftAtom,
  replyDraftAtRest,
  type IReplyDraft,
  type PendingVoiceSendDraft,
} from '../roomInputDrafts';

/**
 * A voice message whose send failed stays parked with Retry and Discard until it is sent or
 * discarded ("Your recording is still saved"). This keeps that recording in IndexedDB per account
 * too, so a reload or an app update does not lose it: the next composer puts it back, in the room
 * and thread it was meant for. Sign-out forgets it, as it does the drafts.
 */
type SavedVoiceDraft = {
  userId: string;
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
export const clearSavedVoiceDraft = async (userId: string): Promise<void> => {
  await withDraftDb((db) => db.delete('drafts', userId));
};

const saveVoiceDraft = async (userId: string, draft: PendingVoiceSendDraft): Promise<void> => {
  const { context, file } = draft;
  const audio = await file.arrayBuffer().catch(() => undefined);
  if (!audio) return;
  await withDraftDb((db) =>
    db.put('drafts', {
      userId,
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
    })
  );
};

// One restore per account and page; saving waits for it, so an empty composer does not erase the
// recording before it is back.
const restores = new Map<string, Promise<void>>();

export const useSavedVoiceDraft = (mx: MatrixClient): void => {
  const store = useStore();
  const draft = useAtomValue(pendingVoiceSendDraftAtom);
  const userId = mx.getUserId() ?? undefined;

  useEffect(() => {
    if (!userId || restores.has(userId)) return;
    restores.set(
      userId,
      withDraftDb((db) => db.get('drafts', userId)).then((saved) => {
        if (!saved || store.get(pendingVoiceSendDraftAtom)) return;
        const room = mx.getRoom(saved.roomId);
        if (!room) return;
        store.set(pendingVoiceSendDraftAtom, {
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
      })
    );
  }, [mx, store, userId]);

  useEffect(() => {
    if (!userId) return;
    void (restores.get(userId) ?? Promise.resolve()).then(() => {
      const current = store.get(pendingVoiceSendDraftAtom);
      if (!current) return clearSavedVoiceDraft(userId);
      if (current.context.ownerSessionId !== userId) return undefined;
      return saveVoiceDraft(userId, current);
    });
  }, [draft, store, userId]);
};
