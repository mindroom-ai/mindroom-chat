import React, { type ComponentProps } from 'react';
import { MsgType, type Room } from 'matrix-js-sdk';
import { Text } from 'folds';
import {
  ImageContent,
  MSticker,
  MessageNotDecryptedContent,
  MessageUnsupportedContent,
  RedactedContent,
} from '../../../components/message';
import { Image } from '../../../components/media';
import { ImageViewer } from '../../../components/image-viewer';
import { RenderMessageContent } from '../../../components/RenderMessageContent';
import { EncryptedContent } from '../../../features/room/message/EncryptedContent';
import { getEditedEvent, getLatestMessageContent, getMemberDisplayName } from '../../../utils/room';
import { getMxIdLocalPart } from '../../../utils/matrix';
import { MessageEvent, type GetContentCallback } from '../../../../types/matrix/room';
import { isFailedLocalEchoEvent, isPendingLocalEchoEvent } from '../../messages/pendingLocalEcho';
import { ApprovalHistory } from '../../messages/ThreadApprovalControls';
import { CollapsibleMessage } from '../CollapsibleMessage';
import {
  getCollapsibleMessageMeasurementKey,
  shouldForceCollapsibleMessageOverflow,
} from '../threadCollapsibleMessages';
import { getMindroomRoomTimelineApprovalContentIfSupported } from '../roomTimelineMessageExtensions';
import type { TimelineMessageData, TimelineMessageKind, TimelineMessageRow } from './types';
import type { useTimelineMessageExpansion } from './useTimelineMessageExpansion';

export type TimelineMessageBodyPolicy = Pick<
  ComponentProps<typeof RenderMessageContent>,
  'mediaAutoLoad' | 'urlPreview' | 'htmlReactParserOptions' | 'linkifyOpts' | 'outlineAttachment'
> & {
  room: Room;
  threadId?: string;
  getExpansion: ReturnType<typeof useTimelineMessageExpansion>['getExpansion'];
};

type TimelineMessageBodyProps = {
  row: TimelineMessageRow;
  kind: TimelineMessageKind;
  policy: TimelineMessageBodyPolicy;
  approvalTimeline: TimelineMessageData['approvalTimeline'];
  messageContent?: ReturnType<typeof resolveTimelineMessageContent>;
};

// Resolve edits on every timeline render; Matrix events are mutable.
export const resolveTimelineMessageContent = (
  row: TimelineMessageRow,
  kind: TimelineMessageKind
) => {
  const editedEvent = getEditedEvent(row.eventId, row.event, row.timelineSet);
  const resolvedContent =
    kind === 'approval'
      ? getMindroomRoomTimelineApprovalContentIfSupported(row.event, editedEvent) ??
        row.event.getContent()
      : getLatestMessageContent(row.event, editedEvent);
  return { editedEvent, resolvedContent };
};

export function TimelineMessageBody({
  row,
  kind,
  policy,
  approvalTimeline,
  messageContent,
}: TimelineMessageBodyProps) {
  const { event, eventId } = row;
  const { room, threadId, getExpansion, ...contentPolicy } = policy;
  const renderSticker = () => (
    <MSticker
      content={event.getContent()}
      renderImageContent={(props) => (
        <ImageContent
          {...props}
          autoPlay={policy.mediaAutoLoad}
          renderImage={(p) => <Image {...p} loading="lazy" />}
          renderViewer={(p) => <ImageViewer {...p} />}
        />
      )}
    />
  );
  const { editedEvent, resolvedContent } = messageContent ?? {};
  const renderContent = (encrypted: boolean) => {
    if (event.isRedacted())
      return (
        <RedactedContent
          reason={encrypted ? undefined : event.getUnsigned().redacted_because?.content.reason}
        />
      );
    if (kind === 'sticker' || (encrypted && event.getType() === MessageEvent.Sticker))
      return renderSticker();

    const approvalContent = getMindroomRoomTimelineApprovalContentIfSupported(event, editedEvent);
    const isApproval = kind === 'approval' || !!approvalContent;
    const content = (isApproval ? approvalContent ?? resolvedContent : resolvedContent) ?? {};
    const senderId = event.getSender() ?? '';
    const common = {
      ...contentPolicy,
      displayName: getMemberDisplayName(room, senderId) ?? getMxIdLocalPart(senderId) ?? senderId,
      eventType: event.getType(),
      ts: event.getTs(),
      edited: !!editedEvent,
      pendingSend: isPendingLocalEchoEvent(event) || isPendingLocalEchoEvent(editedEvent),
      failedSend: isFailedLocalEchoEvent(event) || isFailedLocalEchoEvent(editedEvent),
      getContent: (() => content) as GetContentCallback,
    };
    if (isApproval) {
      if (approvalTimeline.fallbackGroupsByEventId.has(eventId))
        return encrypted ? null : (
          <ApprovalHistory records={approvalTimeline.fallbackGroupsByEventId.get(eventId) ?? []} />
        );
      return (
        <RenderMessageContent
          {...common}
          roomId={room.roomId}
          eventId={eventId}
          threadId={event.threadRootId ?? threadId}
          msgType={typeof content.msgtype === 'string' ? content.msgtype : ''}
        />
      );
    }
    if (!encrypted || event.getType() === MessageEvent.RoomMessage) {
      const msgType = event.getContent().msgtype;
      const expansion = getExpansion(eventId, content);
      const renderMessage = (loadFullContent = true) => (
        <RenderMessageContent
          {...common}
          msgType={msgType ?? ''}
          showMessageExtras
          hydrateLongText={loadFullContent}
        />
      );
      if (msgType === MsgType.Image || msgType === MsgType.Video) return renderMessage();
      return (
        <CollapsibleMessage
          {...expansion}
          expansionKey={eventId}
          forceOverflowing={shouldForceCollapsibleMessageOverflow(content)}
          measurementKey={getCollapsibleMessageMeasurementKey(
            event,
            expansion.collapseMode,
            editedEvent
          )}
        >
          {({ loadFullContent }) => renderMessage(loadFullContent)}
        </CollapsibleMessage>
      );
    }
    return (
      <Text>
        {event.getType() === MessageEvent.RoomMessageEncrypted ? (
          <MessageNotDecryptedContent />
        ) : (
          <MessageUnsupportedContent />
        )}
      </Text>
    );
  };
  return (
    <>
      {kind === 'encrypted' ? (
        <EncryptedContent mEvent={event}>{() => renderContent(true)}</EncryptedContent>
      ) : (
        renderContent(false)
      )}
      {(kind === 'message' || kind === 'encrypted') && (
        <ApprovalHistory
          records={
            approvalTimeline.historyByResponseId.get(eventId) ??
            (kind === 'encrypted'
              ? approvalTimeline.fallbackGroupsByEventId.get(eventId)
              : undefined) ??
            []
          }
        />
      )}
    </>
  );
}
