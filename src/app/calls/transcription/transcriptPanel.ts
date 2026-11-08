import { useCallback } from 'react';
import { atom, useAtomValue, useStore } from 'jotai';
import { callPanelRoomAtom } from '../callStore';

type Store = ReturnType<typeof useStore>;

/**
 * The room whose live transcript shows in its side panel, and whether it took the place of that
 * room's call panel, which then comes back when it closes.
 */
export type TranscriptPanel = { roomId: string; replacedCall: boolean };

export const transcriptPanelAtom = atom<TranscriptPanel | undefined>(undefined);

/**
 * Shows the room's live transcript in its side panel, in place of its call panel if that is open.
 * Opened again while it shows, it still brings back the call panel it replaced.
 */
export const openTranscriptPanel = (store: Store, roomId: string): void => {
  const shown = store.get(transcriptPanelAtom);
  const replacedCall =
    store.get(callPanelRoomAtom) === roomId || (shown?.roomId === roomId && shown.replacedCall);
  if (replacedCall) store.set(callPanelRoomAtom, undefined);
  store.set(transcriptPanelAtom, { roomId, replacedCall });
};

/** Closes the room's live transcript; the call panel it replaced comes back. */
export const closeTranscriptPanel = (store: Store, roomId: string): void => {
  const shown = store.get(transcriptPanelAtom);
  if (shown?.roomId !== roomId) return;
  store.set(transcriptPanelAtom, undefined);
  if (shown.replacedCall) store.set(callPanelRoomAtom, roomId);
};

/** Closes the room's live transcript for another panel, which keeps the place. */
export const dismissTranscriptPanel = (store: Store, roomId: string): void => {
  if (store.get(transcriptPanelAtom)?.roomId === roomId) store.set(transcriptPanelAtom, undefined);
};

/** Whether the room shows its live transcript, and the ways to open, close or dismiss it. */
export const useTranscriptPanel = (roomId: string) => {
  const store = useStore();
  const open = useAtomValue(transcriptPanelAtom)?.roomId === roomId;
  const show = useCallback(() => openTranscriptPanel(store, roomId), [roomId, store]);
  const close = useCallback(() => closeTranscriptPanel(store, roomId), [roomId, store]);
  const dismiss = useCallback(() => dismissTranscriptPanel(store, roomId), [roomId, store]);
  return { open, show, close, dismiss };
};
