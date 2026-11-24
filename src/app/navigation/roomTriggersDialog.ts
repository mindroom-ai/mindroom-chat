import { atom, type useStore } from 'jotai';

type Store = ReturnType<typeof useStore>;

/**
 * The room whose Triggers dialog is open, with an optional trigger ID to focus and highlight
 * (as when opened from a trigger wake pill) and an optional opener element for focus restore.
 * Every opening sets a new object, so clicking another wake pill while open re-targets its row.
 */
export type RoomTriggersDialogState = {
  roomId: string;
  triggerId?: string;
  opener?: HTMLElement;
};

export const roomTriggersDialogAtom = atom<RoomTriggersDialogState | undefined>(undefined);

/** Opens the room's Triggers dialog, optionally focused on `triggerId`. */
export const openRoomTriggersDialog = (
  store: Store,
  roomId: string,
  options?: { triggerId?: string; opener?: HTMLElement }
): void => {
  store.set(roomTriggersDialogAtom, {
    roomId,
    ...(options?.triggerId !== undefined && { triggerId: options.triggerId }),
    ...(options?.opener !== undefined && { opener: options.opener }),
  });
};

/** Closes the room's Triggers dialog; one open in another room stays. */
export const closeRoomTriggersDialog = (store: Store, roomId: string): void => {
  if (store.get(roomTriggersDialogAtom)?.roomId === roomId) {
    store.set(roomTriggersDialogAtom, undefined);
  }
};
