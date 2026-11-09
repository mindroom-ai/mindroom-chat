import { useCallback } from 'react';
import { atom, useAtomValue, useStore } from 'jotai';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { callPanelRoomAtom, useActiveCall, useInCall } from '../callStore';
import {
  focusHandOffAtom,
  getCallWindowTranscriptAtom,
  useCallViewFloats,
} from '../window/callWindowState';
import { callTranscriptionAtom } from './transcriptionState';

type Store = ReturnType<typeof useStore>;

/**
 * The room whose live transcript shows in its side panel, and whether it took the place of that
 * room's call panel, which then comes back when it closes.
 */
export type TranscriptPanel = { roomId: string; replacedCall: boolean };

export const transcriptPanelAtom = atom<TranscriptPanel | undefined>(undefined);

/**
 * Shows the room's live transcript in its side panel, in place of its call panel if that is open
 * there; a call view that floats (`callFloats`) is no side panel, and stays. Opened again while it
 * shows, it still brings back the call panel it replaced.
 */
export const openTranscriptPanel = (store: Store, roomId: string, callFloats = false): void => {
  const shown = store.get(transcriptPanelAtom);
  const replacesCall = !callFloats && store.get(callPanelRoomAtom) === roomId;
  if (replacesCall) store.set(callPanelRoomAtom, undefined);
  const replacedCall = replacesCall || (shown?.roomId === roomId && shown.replacedCall);
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
 * Transcript for the call in `roomId`, in the call's controls or on its row: whether it shows
 * inside the floating window (the call is this device's and still on here, this device
 * transcribes it, and its view floats), whether it shows there now, and `open`. There, the window's
 * call view opens with the transcript: the controls toggle it (`toggle`), the row opens it and
 * hands it its focus, and the room's side transcript closes, so one shows it. The window shows only
 * what this device's transcriber reads, so anywhere else the room's side panel, which reads the
 * call itself, shows it, beside a floating call view: a call that failed or ended here (its
 * finished view has no transcript, while the others may still talk), and one whose transcriber
 * did not load or MindRoom has not answered yet.
 */
export const useCallTranscript = (roomId: string) => {
  const store = useStore();
  const userId = useMatrixClient().getSafeUserId();
  const active = useActiveCall();
  const live = useInCall();
  const floats = useCallViewFloats();
  const transcription = useAtomValue(callTranscriptionAtom);
  const transcribed = transcription?.roomId === roomId && transcription.status !== 'joining';
  const inWindow =
    floats && live && transcribed && active?.kind === 'room' && active.call.room.roomId === roomId;
  const shown = useAtomValue(getCallWindowTranscriptAtom(userId));
  const open = useCallback(
    (toggle: boolean) => {
      if (!inWindow) {
        openTranscriptPanel(store, roomId, floats);
        return;
      }
      const shownAtom = getCallWindowTranscriptAtom(userId);
      const show = toggle ? !store.get(shownAtom) : true;
      store.set(shownAtom, show);
      store.set(callPanelRoomAtom, roomId);
      if (show) dismissTranscriptPanel(store, roomId);
      if (!toggle) store.set(focusHandOffAtom, { to: 'transcript', from: document.activeElement });
    },
    [floats, inWindow, roomId, store, userId]
  );
  return { inWindow, shownInWindow: inWindow && shown, open };
};
