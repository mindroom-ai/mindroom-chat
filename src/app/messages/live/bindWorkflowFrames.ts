import { useEffect } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import { parseWorkflowFrame, WORKFLOW_FRAME_EVENT_TYPE } from '../../matrix/protocol/workflowFrame';
import { bindLiveFrames, SYNTHETIC_EVENT_ID_PREFIX } from './bindLiveReplyFrames';
import { getWorkflowRunStore, type WorkflowRunStore } from './workflowRunStore';

// Under the prefix the patched SDK keeps out of its key retries, apart from reply and sub-agent ids.
const WORKFLOW_EVENT_ID_PREFIX = `${SYNTHETIC_EVENT_ID_PREFIX}workflow.`;

/**
 * Feeds the client's `io.mindroom.workflow` frames into its workflow run store until the returned
 * function runs, which also clears the store.
 */
export const bindWorkflowFrames = (
  mx: MatrixClient,
  store: WorkflowRunStore = getWorkflowRunStore(mx)
): (() => void) => {
  const unbind = bindLiveFrames(
    mx,
    WORKFLOW_FRAME_EVENT_TYPE,
    WORKFLOW_EVENT_ID_PREFIX,
    (roomId, sender, content) => {
      const frame = parseWorkflowFrame(content);
      if (frame) store.ingest(roomId, sender, frame, Date.now());
    }
  );
  return () => {
    unbind();
    store.clear();
  };
};

/** Keeps the client's workflow run store fed while the client is active. */
export const useBindWorkflowFrames = (mx: MatrixClient) => {
  useEffect(() => bindWorkflowFrames(mx), [mx]);
};
