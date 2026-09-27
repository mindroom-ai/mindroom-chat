import { useEffect } from 'react';
import { useStore } from 'jotai';
import type { Descendant } from 'slate';
import { callEmbedAtom } from '../../state/callEmbed';
import {
  getRoomInputDraftKey,
  pendingVoiceSendDraftAtom,
  roomIdToMsgDraftAtomFamily,
  roomIdToUploadItemsAtomFamily,
  roomUploadAtomFamily,
  voiceAutoSendPendingAtom,
} from '../../state/room/roomInputDrafts';
import { UploadStatus } from '../../state/upload';
import { isVoiceCaptureActive } from '../voice/voiceCaptureDiagnostics';
import {
  registerStorageRecoveryBlocker,
  registerStorageRecoveryPreparation,
} from './storageConnectionRecovery';

type JotaiStore = ReturnType<typeof useStore>;

/**
 * A composer send still unanswered after this long will not finish on its own
 * once storage is lost: the Rust crypto store can no longer encrypt it.
 */
export const STUCK_SEND_MS = 10_000;

export type ComposerTextSend = {
  userId: string;
  /** The composer that sent it, which can differ from the event's room or thread. */
  roomId: string;
  threadId: string | undefined;
  /** The composer content before it was cleared, formatting included. */
  draft: Descendant[];
  startedAt: number;
};

const composerTextSends = new Set<ComposerTextSend>();

/**
 * Tracks a composer text send until the homeserver answers. A failed send is
 * already restored into its composer by the send session, so only sends that
 * never settle need saving before a recovery reload.
 */
export const trackComposerTextSend = (send: ComposerTextSend): (() => void) => {
  composerTextSends.add(send);
  return () => {
    composerTextSends.delete(send);
  };
};

const isInFlight = (send: ComposerTextSend, now: number): boolean =>
  now - send.startedAt < STUCK_SEND_MS;

/**
 * Work that exists only in this page's memory, which an automatic recovery
 * reload would discard. Composer text persists on every edit, and stuck
 * composer sends are moved back into their composers before reloading.
 */
export const hasUnsavedTransientWork = ({
  store,
  now = Date.now(),
}: {
  store: JotaiStore;
  now?: number;
}): boolean =>
  isVoiceCaptureActive() ||
  store.get(voiceAutoSendPendingAtom) ||
  store.get(pendingVoiceSendDraftAtom) !== undefined ||
  store.get(callEmbedAtom) !== undefined ||
  Array.from(composerTextSends).some((send) => isInFlight(send, now)) ||
  roomIdToUploadItemsAtomFamily
    .getParams()
    .some((key) => store.get(roomIdToUploadItemsAtomFamily(key)).length > 0) ||
  roomUploadAtomFamily
    .getParams()
    .some((file) => store.get(roomUploadAtomFamily(file)).status === UploadStatus.Loading);

/**
 * Appends unanswered composer sends to the drafts of the composers that sent
 * them. Automatic reloads leave sends in flight alone, because they wait for
 * them; a user-requested reload saves every unanswered send.
 */
export const saveUnsentComposerText = ({
  store,
  includeInFlight,
  now = Date.now(),
}: {
  store: JotaiStore;
  includeInFlight: boolean;
  now?: number;
}): void => {
  Array.from(composerTextSends).forEach((send) => {
    if (!includeInFlight && isInFlight(send, now)) return;
    composerTextSends.delete(send);
    const draftAtom = roomIdToMsgDraftAtomFamily(
      getRoomInputDraftKey(send.userId, send.roomId, send.threadId)
    );
    store.set(draftAtom, [...store.get(draftAtom), ...send.draft]);
  });
};

/** Keeps storage-loss recovery from reloading over unsent or in-progress work. */
export const useStorageRecoveryBlocker = (): void => {
  const store = useStore();

  useEffect(() => {
    const unregisterBlocker = registerStorageRecoveryBlocker(() =>
      hasUnsavedTransientWork({ store })
    );
    const unregisterPreparation = registerStorageRecoveryPreparation(({ automatic }) =>
      saveUnsentComposerText({ store, includeInFlight: !automatic })
    );
    return () => {
      unregisterBlocker();
      unregisterPreparation();
    };
  }, [store]);
};

export const resetComposerTextSendsForTesting = (): void => {
  composerTextSends.clear();
};
