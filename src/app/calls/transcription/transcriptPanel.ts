import { useCallback } from 'react';
import { atom, useAtomValue, useStore } from 'jotai';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { callPanelRoomAtom, useActiveCall } from '../callStore';
import { getCallWindowTranscriptAtom, useCallViewFloats } from '../window/callWindowState';

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

/** Whether the room shows its live transcript, and the ways to close or dismiss it. */
export const useTranscriptPanel = (roomId: string) => {
  const store = useStore();
  const open = useAtomValue(transcriptPanelAtom)?.roomId === roomId;
  const close = useCallback(() => closeTranscriptPanel(store, roomId), [roomId, store]);
  const dismiss = useCallback(() => dismissTranscriptPanel(store, roomId), [roomId, store]);
  return { open, close, dismiss };
};

/**
 * Where Transcript (in the call's controls or on its row) shows the room's live transcript. While
 * the call view floats and shows this device's call in the room (`inWindow`, for the account
 * `userId`), the transcript shows inside the window, whose call view opens: the controls toggle
 * it (`toggle`), the row opens it. Anywhere else it opens in the room's side panel, as it always
 * did.
 */
export const openCallTranscript = (
  store: Store,
  roomId: string,
  inWindow?: { userId: string; toggle: boolean }
): void => {
  if (!inWindow) {
    openTranscriptPanel(store, roomId);
    return;
  }
  const shown = getCallWindowTranscriptAtom(inWindow.userId);
  store.set(shown, inWindow.toggle ? !store.get(shown) : true);
  store.set(callPanelRoomAtom, roomId);
};

/**
 * Transcript for the call in `roomId`: whether it shows inside the floating window (the call is
 * this device's, and its view floats), whether it shows there now, and `open`, which shows it
 * where it belongs (toggling it in the window when `toggle`).
 */
export const useCallTranscript = (roomId: string) => {
  const store = useStore();
  const userId = useMatrixClient().getSafeUserId();
  const active = useActiveCall();
  const floats = useCallViewFloats();
  const inWindow = floats && active?.kind === 'room' && active.call.room.roomId === roomId;
  const shown = useAtomValue(getCallWindowTranscriptAtom(userId));
  const open = useCallback(
    (toggle: boolean) =>
      openCallTranscript(store, roomId, inWindow ? { userId, toggle } : undefined),
    [inWindow, roomId, store, userId]
  );
  return { inWindow, shownInWindow: inWindow && shown, open };
};
