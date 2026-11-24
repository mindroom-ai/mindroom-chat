import { createStore } from 'jotai';
import { describe, expect, it } from 'vitest';
import {
  closeWorkflowRunPanel,
  openWorkflowRunPanel,
  workflowRunPanelAtom,
} from './workflowPanel';

const ROOM = '!room:example.org';
const OTHER_ROOM = '!other:example.org';
const RUN = 'wf-11111111111111111111111111111111';
const THREAD = '$thread-1';

describe('workflowPanel navigation state', () => {
  it('opens for a run and closes only in its own room', () => {
    const store = createStore();
    openWorkflowRunPanel(store, ROOM, RUN, THREAD);
    closeWorkflowRunPanel(store, OTHER_ROOM);
    expect(store.get(workflowRunPanelAtom)).toEqual({ roomId: ROOM, run: RUN, threadId: THREAD });

    closeWorkflowRunPanel(store, ROOM);
    expect(store.get(workflowRunPanelAtom)).toBeUndefined();
  });

  it('produces a fresh object on every opening so subscriptions always fire', () => {
    const store = createStore();
    openWorkflowRunPanel(store, ROOM, RUN, null);
    const first = store.get(workflowRunPanelAtom);
    openWorkflowRunPanel(store, ROOM, RUN, null);
    const second = store.get(workflowRunPanelAtom);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
  });
});
