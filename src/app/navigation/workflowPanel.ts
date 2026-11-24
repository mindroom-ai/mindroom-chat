import { useCallback } from 'react';
import { atom, useAtomValue, useStore } from 'jotai';

type Store = ReturnType<typeof useStore>;

export type WorkflowRunPanelState = {
  roomId: string;
  run: string;
  threadId?: string | null;
};

/**
 * The workflow run panel open in a room, if any. Every opening sets a fresh object value so
 * room subscriptions fire even when re-opening the same run.
 */
export const workflowRunPanelAtom = atom<WorkflowRunPanelState | undefined>(undefined);

/** Opens the room's Workflow panel on `run`, optionally targeting its thread conversation. */
export const openWorkflowRunPanel = (
  store: Store,
  roomId: string,
  run: string,
  threadId?: string | null
): void =>
  store.set(workflowRunPanelAtom, {
    roomId,
    run,
    ...(threadId === undefined ? {} : { threadId }),
  });

/** Closes the Workflow panel in `roomId`; one open in another room stays untouched. */
export const closeWorkflowRunPanel = (store: Store, roomId: string): void => {
  if (store.get(workflowRunPanelAtom)?.roomId === roomId) {
    store.set(workflowRunPanelAtom, undefined);
  }
};

/** Whether `roomId` shows the Workflow panel, which run it displays, and how to close it. */
export const useWorkflowRunPanel = (
  roomId: string
): { open: boolean; run?: string; threadId?: string | null; close: () => void } => {
  const store = useStore();
  const state = useAtomValue(workflowRunPanelAtom);
  const open = state?.roomId === roomId;
  const close = useCallback(() => closeWorkflowRunPanel(store, roomId), [roomId, store]);
  return {
    open,
    ...(open && state ? { run: state.run, threadId: state.threadId } : {}),
    close,
  };
};
