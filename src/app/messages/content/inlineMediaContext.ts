import { createContext, useMemo } from 'react';
import type { EventAttachmentOwner } from '../../matrix/protocol/eventAttachments';
import {
  INLINE_MEDIA_CONTENT_KEY,
  readInlineMedia,
  type InlineMediaMap,
} from '../../matrix/protocol/inlineMedia';

export type InlineMediaContextValue = {
  entries: InlineMediaMap;
  owner?: EventAttachmentOwner;
};

export const InlineMediaContext = createContext<InlineMediaContextValue | undefined>(undefined);

/**
 * Memoizes validated inline media for one message revision from its raw `io.mindroom.inline_media`
 * field so re-renders without map changes keep a stable context value and `RenderBody` stays memoized.
 */
export const useInlineMediaValue = (
  content: Record<string, unknown> | undefined,
  owner?: EventAttachmentOwner
): InlineMediaContextValue | undefined => {
  const raw = content?.[INLINE_MEDIA_CONTENT_KEY];
  const entries = useMemo(
    () => (raw === undefined ? undefined : readInlineMedia({ [INLINE_MEDIA_CONTENT_KEY]: raw })),
    [raw]
  );
  const ownerRoomId = owner?.roomId;
  const ownerEventId = owner?.eventId;
  const ownerRevisionTs = owner?.revisionTs;
  const ownerRevisionId = owner?.revisionId;
  const ownerRedacted = owner?.redacted;
  return useMemo(() => {
    if (!entries) return undefined;
    const stableOwner =
      ownerRoomId && ownerEventId && ownerRevisionTs !== undefined
        ? {
            roomId: ownerRoomId,
            eventId: ownerEventId,
            revisionTs: ownerRevisionTs,
            revisionId: ownerRevisionId,
            redacted: ownerRedacted,
          }
        : undefined;
    return { entries, owner: stableOwner };
  }, [entries, ownerRoomId, ownerEventId, ownerRevisionTs, ownerRevisionId, ownerRedacted]);
};
