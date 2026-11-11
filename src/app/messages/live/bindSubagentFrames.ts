import { useEffect } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import { parseSubagentFrame, SUBAGENT_FRAME_EVENT_TYPE } from '../../matrix/protocol/subagentFrame';
import { bindLiveFrames, SYNTHETIC_EVENT_ID_PREFIX } from './bindLiveReplyFrames';
import { getSubagentRunStore, type SubagentRunStore } from './subagentRunStore';

// Under the prefix the patched SDK keeps out of its key retries, apart from the reply frames' ids.
const SUBAGENT_EVENT_ID_PREFIX = `${SYNTHETIC_EVENT_ID_PREFIX}subagents.`;

/**
 * Feeds the client's `io.mindroom.subagents` frames into its sub-agent run store until the
 * returned function runs, which also clears the store.
 */
export const bindSubagentFrames = (
  mx: MatrixClient,
  store: SubagentRunStore = getSubagentRunStore(mx)
): (() => void) => {
  const unbind = bindLiveFrames(
    mx,
    SUBAGENT_FRAME_EVENT_TYPE,
    SUBAGENT_EVENT_ID_PREFIX,
    (roomId, sender, content) => {
      const frame = parseSubagentFrame(content);
      if (frame) store.ingest(roomId, sender, frame, Date.now());
    }
  );
  return () => {
    unbind();
    store.clear();
  };
};

/** Keeps the client's sub-agent run store fed while the client is active. */
export const useBindSubagentFrames = (mx: MatrixClient) => {
  useEffect(() => bindSubagentFrames(mx), [mx]);
};
