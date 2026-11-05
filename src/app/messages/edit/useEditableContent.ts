import { useEffect, useState } from 'react';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { getEditedEvent } from '../../matrix/room';
import { hydrateCachedLongText } from '../../event-store/cache/attachmentRepository';
import { loadEditableContent } from './longEdit';

export type EditableContent = {
  /** The latest content of the message, whole; missing until loaded or when it cannot be. */
  content?: Record<string, unknown>;
  failed: boolean;
};

/** The content the editor starts from: the latest edit or the message, with a long text whole. */
export const useEditableContent = (
  room: Room,
  mEvent: MatrixEvent
): EditableContent => {
  const mx = useMatrixClient();
  const [editable, setEditable] = useState<EditableContent>({ failed: false });

  useEffect(() => {
    const eventId = mEvent.getId()!;
    const timeline = room.getTimelineForEvent(eventId);
    const editedEvent = timeline && getEditedEvent(eventId, mEvent, timeline.getTimelineSet());
    const latest: Record<string, unknown> =
      editedEvent?.getContent()['m.new_content'] ?? mEvent.getContent();
    let cancelled = false;
    // No cache owner: the editor only reads the text, usually already cached by the timeline.
    loadEditableContent(latest, (source) => hydrateCachedLongText(mx, source))
      .catch(() => undefined)
      .then((content) => {
        if (!cancelled) setEditable({ content, failed: content === undefined });
      });
    return () => {
      cancelled = true;
    };
  }, [mx, room, mEvent]);

  return editable;
};
