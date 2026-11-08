import { useEffect, useState } from 'react';
import { MatrixEventEvent, type Room } from 'matrix-js-sdk';
import { findThreadRootEvent } from '../../event-store/threads/threadUtils';
import { isCallRowEvent, readCallRow } from '../../matrix/protocol/callRow';
import { getEditedEvent, getLatestMessageContent } from '../../matrix/room';

/**
 * The call's row a thread's root is (`io.mindroom.call` from a MindRoom agent) while the call is
 * live, as its latest edit has it, following the edits. Undefined once an edit ends the call, so
 * the thread's card shows as any other thread's, and for any other root, or one (or a room) not
 * loaded.
 */
export const useThreadRootLiveCallRow = (room: Room | null, rootId: string) => {
  const root = room ? findThreadRootEvent(room, rootId) : undefined;
  const isRow = !!root && isCallRowEvent(root);
  const [, setEdits] = useState(0);
  useEffect(() => {
    if (!root || !isRow) return undefined;
    const edited = () => setEdits((edits) => edits + 1);
    root.on(MatrixEventEvent.Replaced, edited);
    return () => {
      root.off(MatrixEventEvent.Replaced, edited);
    };
  }, [isRow, root]);
  if (!room || !root || !isRow) return undefined;
  const edit = getEditedEvent(rootId, root, room.getUnfilteredTimelineSet());
  const content = getLatestMessageContent(root, edit);
  const row = readCallRow(content);
  return row && !row.ended ? { mEvent: root, row, body: content.body } : undefined;
};
