import { useCallback } from 'react';
import { atom, useAtomValue, useStore } from 'jotai';

type Store = ReturnType<typeof useStore>;

/**
 * The room whose Sub-agents side panel is open. Every opening is a new value, so the room hears one
 * for a panel that already shows (folded, it unfolds).
 */
export const subagentsPanelAtom = atom<{ roomId: string } | undefined>(undefined);

/**
 * Opens the room's Sub-agents panel, as the header's toggle and a sub-agent job in the jobs bar do;
 * the room then closes its other panels by their rule (src/app/ui/panels/roomPanels.ts).
 */
export const openSubagentsPanel = (store: Store, roomId: string): void =>
  store.set(subagentsPanelAtom, { roomId });

/** Closes the room's Sub-agents panel; one open in another room stays. */
export const closeSubagentsPanel = (store: Store, roomId: string): void => {
  if (store.get(subagentsPanelAtom)?.roomId === roomId) store.set(subagentsPanelAtom, undefined);
};

/** Whether the room shows its Sub-agents panel, and the ways to open and close it there. */
export const useSubagentsPanel = (roomId: string) => {
  const store = useStore();
  const open = useAtomValue(subagentsPanelAtom)?.roomId === roomId;
  const show = useCallback(() => openSubagentsPanel(store, roomId), [roomId, store]);
  const close = useCallback(() => closeSubagentsPanel(store, roomId), [roomId, store]);
  return { open, show, close };
};
