import { useCallback } from 'react';
import { atom, useAtomValue, useStore } from 'jotai';

type Store = ReturnType<typeof useStore>;

/**
 * The room whose Sub-agents side panel is open, and the conversation it was opened for (a thread
 * root's ID, or `null` the room's own timeline), when it was opened for a run's, with the sub-agent
 * it then shows. Every opening is a new value, so the room hears one for a panel that already
 * shows (folded, it unfolds).
 */
export const subagentsPanelAtom = atom<
  { roomId: string; threadId?: string | null; subagent?: string } | undefined
>(undefined);

/**
 * Opens the room's Sub-agents panel, as the header's toggle and a sub-agent job in the jobs bar do;
 * the room then closes its other panels by their rule (src/app/ui/panels/roomPanels.ts). Given the
 * conversation of the job's run, the room shows that conversation, whose runs alone the panel lists;
 * given its sub-agent too, the panel shows that sub-agent's run while it has it.
 */
export const openSubagentsPanel = (
  store: Store,
  roomId: string,
  threadId?: string | null,
  subagent?: string
): void =>
  store.set(subagentsPanelAtom, {
    roomId,
    ...(threadId === undefined ? {} : { threadId }),
    ...(subagent === undefined ? {} : { subagent }),
  });

/**
 * The conversation the room must show so that the panel, opened for `requested`, lists its runs:
 * none while it already does (the Classic view lists every run), else the requested thread's root
 * or `null` for the room's own timeline.
 */
export const conversationToShow = (
  requested: string | null | undefined,
  shown: string | undefined,
  classic: boolean
): string | null | undefined =>
  requested === undefined || classic || requested === (shown ?? null) ? undefined : requested;

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
