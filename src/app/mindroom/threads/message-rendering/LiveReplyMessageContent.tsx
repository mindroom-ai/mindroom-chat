import { useCallback, type ComponentProps } from 'react';
import type { IContent } from 'matrix-js-sdk';
import { RenderMessageContent } from '../../../components/RenderMessageContent';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useLiveReplyContent } from '../../live/useLiveReplyContent';

type LiveReplyMessageContentProps = ComponentProps<typeof RenderMessageContent>;

/**
 * Message content of an agent reply with its live reply frames (MSC2477 ephemeral events) laid
 * over the durable edit while the reply streams. URL previews wait for the final edit: a live
 * frame's links are still being typed.
 */
export function LiveReplyMessageContent(props: LiveReplyMessageContentProps) {
  const { mEvent, getContent, urlPreview } = props;
  const mx = useMatrixClient();
  const durableContent = getContent<IContent>();
  const { content, live } = useLiveReplyContent(mx, mEvent, durableContent);
  const getLiveContent = useCallback(() => content, [content]) as <T>() => T;

  return (
    <RenderMessageContent {...props} getContent={getLiveContent} urlPreview={urlPreview && !live} />
  );
}
