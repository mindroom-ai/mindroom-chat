import { useCallback } from 'react';
import { atom, useAtomValue, useStore } from 'jotai';

type Store = ReturnType<typeof useStore>;
export type WorkflowRunPanelState = { roomId: string; run: string; threadId?: string | null };

/** Open workflow graph panel; every opening sets a new object so room subscriptions fire. */
export const workflowRunPanelAtom = atom<WorkflowRunPanelState | undefined>(undefined);

export const openWorkflowRunPanel = (
  store: Store,
  roomId: string,
  run: string,
  threadId?: string | null
): void =>
  store.set(workflowRunPanelAtom, { roomId, run, ...(threadId === undefined ? {} : { threadId }) });

export const closeWorkflowRunPanel = (store: Store, roomId: string): void => {
  if (store.get(workflowRunPanelAtom)?.roomId === roomId)
    store.set(workflowRunPanelAtom, undefined);
};

export const useWorkflowRunPanel = (roomId: string) => {
  const store = useStore();
  const state = useAtomValue(workflowRunPanelAtom);
  const open = state?.roomId === roomId;
  const close = useCallback(() => closeWorkflowRunPanel(store, roomId), [roomId, store]);
  return { open, ...(open && state ? { run: state.run, threadId: state.threadId } : {}), close };
};
