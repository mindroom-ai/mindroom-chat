import { type ComponentProps, type ReactNode } from 'react';
import { MsgType, type MatrixEvent } from 'matrix-js-sdk';
import { Box, Icon, Icons } from 'folds';
import type { HTMLReactParserOptions } from 'html-react-parser';
import type { Opts as LinkifyOpts } from 'linkifyjs';
import { getEventAttachmentOwner } from '../../matrix/protocol/eventAttachments';
import { MEmote, MNotice, MText } from './MsgTypeRenderers';
import { RenderBody } from './RenderBody';
import { BrokenContent } from './BrokenContent';
import { trimReplyFromBody } from '../../matrix/room';
import { MessageExtras } from '../MessageExtras';
import {
  MINDROOM_MESSAGE_EXTRAS_KEY,
  parseMessageExtras,
} from '../../matrix/protocol/messageExtrasData';
import { useToolTraceMarkerParserOptions } from '../html/HtmlBlocks';
import type { ToolMetadataStatus } from '../../matrix/protocol/toolTrace';
import { isAiRunStreaming } from '../../matrix/protocol/aiRun';
import { formatMarkdownTextBodyAsHtml, formatMessageTextBodyAsHtml } from '../html/blocks';
import { getLongTextSource } from '../../matrix/protocol/longText';
import { LongTextKind, LongTextText } from './LongTextText';
import { PasteAttachmentContent } from './PasteAttachmentContent';
import { ThinkingPlaceholder } from '../agent-run/ThinkingPlaceholder';
import { withReasoning } from '../agent-run/Reasoning';
import { LIVE_REASONING_KEY } from '../live/useLiveReplyContent';
import { TranscribingPlaceholder } from '../agent-run/TranscribingPlaceholder';
import { ThreadSummaryCard } from '../thread-summary/ThreadSummaryCard';
import { ToolApprovalCard } from '../../approvals/ToolApprovalCard';
import { renderStreamingIndicator } from '../agent-run/StreamingIndicator';
import { isThinkingPlaceholderBody } from '../../matrix/protocol/thinkingPlaceholder';
import { isTranscribingPlaceholder } from '../../matrix/protocol/transcribingPlaceholder';
import { getPasteAttachmentFile } from '../../matrix/protocol/pasteAttachmentMarker';
import {
  MINDROOM_TOOL_APPROVAL_EVENT,
  parseToolApprovalContent,
} from '../../matrix/protocol/toolApproval';
import { getThreadSummaryInfo } from '../../matrix/protocol/threadSummary';
import { readSnoozeEndedNote } from '../../matrix/protocol/threadSnooze';
import { SnoozeEndedMarker } from '../SnoozeEndedMarker';
import { getMessageStateSuffixRenderer } from './messageStateSuffix';
import { ChatUiActionButton } from '../../ui-actions/ChatUiActionButton';
import { CHAT_UI_ACTION_KEY, readCanvasNoticeTitle } from '../../matrix/protocol/chatUiProtocol';
import { CANVAS_RESPONSE_KEY, readCanvasResponse } from '../canvas/canvasMessages';
import { CanvasResponseReceipt } from '../canvas/CanvasResponseReceipt';
import { CanvasResponseSidecarReceipt } from '../canvas/CanvasResponseSidecarReceipt';
import { readCallTranscript } from '../../matrix/protocol/callTranscript';
import { CallTranscriptCard } from './CallTranscriptCard';
import { ownDirectionLine } from '../../ui/directional';

export type RenderAgentMessageContentOptions = {
  mEvent?: MatrixEvent;
  /** Whether the sender is a MindRoom account on the viewer's homeserver. */
  fromMindroomAgent?: boolean;
  displayName: string;
  eventType?: string;
  roomId?: string;
  eventId?: string;
  threadId?: string;
  msgType: string;
  edited?: boolean;
  content: Record<string, unknown>;
  pendingSend?: boolean;
  failedSend?: boolean;
  highlightRegex?: RegExp;
  htmlReactParserOptions: HTMLReactParserOptions; // turns formatted_body HTML into React nodes
  linkifyOpts: LinkifyOpts; // links bare URLs in plain-text bodies
  renderUrlsPreview?: (urls: string[]) => ReactNode;
  showMessageExtras?: boolean;
  hydrateLongText?: boolean;
};

type AgentRenderBodyProps = Omit<ComponentProps<typeof RenderBody>, 'htmlReactParserOptions'> & {
  htmlReactParserOptions: HTMLReactParserOptions;
  /** The content whose tool and paste markers the body renders. */
  markerContent: Record<string, unknown>;
  metadataStatus?: ToolMetadataStatus;
};

/** A body with MindRoom's markers, parsed again only when that message changes. */
function AgentRenderBody({
  htmlReactParserOptions,
  markerContent,
  metadataStatus,
  ...props
}: AgentRenderBodyProps) {
  return (
    <RenderBody
      {...props}
      htmlReactParserOptions={useToolTraceMarkerParserOptions(
        htmlReactParserOptions,
        markerContent,
        metadataStatus
      )}
    />
  );
}

export const renderAgentMessageContent = ({
  mEvent,
  fromMindroomAgent = false,
  displayName,
  eventType,
  roomId,
  eventId,
  threadId,
  msgType,
  edited,
  content,
  pendingSend,
  failedSend,
  highlightRegex,
  htmlReactParserOptions,
  linkifyOpts,
  renderUrlsPreview,
  showMessageExtras = false,
  hydrateLongText = true,
}: RenderAgentMessageContentOptions): ReactNode | undefined => {
  const withToolRefFormattedBodyFallback = (bodyContent: Record<string, unknown>) => {
    if (typeof bodyContent.formatted_body === 'string') return bodyContent;
    if (typeof bodyContent.body !== 'string') return bodyContent;

    // MindRoom writes an agent's HTML from its Markdown body; a reply that arrives with the body
    // alone renders as that HTML would have.
    const formattedBody =
      (fromMindroomAgent && formatMarkdownTextBodyAsHtml(bodyContent.body)) ||
      formatMessageTextBodyAsHtml(bodyContent.body);
    if (!formattedBody) return bodyContent;

    return {
      ...bodyContent,
      format: 'org.matrix.custom.html',
      formatted_body: formattedBody,
    };
  };

  const getRenderableLongTextSource = (bodyContent: Record<string, unknown>) => {
    const source = getLongTextSource(bodyContent);
    if (!source) return undefined;

    const { previewContent } = source;
    if (
      (typeof previewContent.formatted_body === 'string' &&
        previewContent.formatted_body.length > 0) ||
      typeof previewContent.body !== 'string'
    ) {
      return source;
    }

    const trimmedBody = trimReplyFromBody(previewContent.body);
    const formattedBody = formatMarkdownTextBodyAsHtml(trimmedBody);
    if (!formattedBody) return source;

    return {
      ...source,
      previewContent: {
        ...previewContent,
        format: 'org.matrix.custom.html',
        formatted_body: formattedBody,
      },
    };
  };

  const wrapWithReasoning = (bodyContent: Record<string, unknown>, body: ReactNode) =>
    withReasoning(bodyContent, body, htmlReactParserOptions, linkifyOpts);

  const renderBody =
    (bodyContent: Record<string, unknown>) => (props: { body: string; customBody?: string }) => {
      const { body, customBody: providedCustomBody } = props;
      const renderableContent =
        providedCustomBody === undefined
          ? withToolRefFormattedBodyFallback({ ...bodyContent, body })
          : bodyContent;
      const customBody =
        providedCustomBody ??
        (typeof renderableContent.formatted_body === 'string'
          ? renderableContent.formatted_body
          : undefined);

      return wrapWithReasoning(
        renderableContent,
        <AgentRenderBody
          {...props}
          customBody={customBody}
          highlightRegex={highlightRegex}
          htmlReactParserOptions={htmlReactParserOptions}
          markerContent={renderableContent}
          linkifyOpts={linkifyOpts}
        />
      );
    };

  // A long call's transcript is only in the sidecar; until it is hydrated, and when the card may
  // not name its speakers, the body shows.
  const renderLongCallTranscript = (resolvedContent: Record<string, unknown>, body: ReactNode) => {
    const transcript = fromMindroomAgent ? readCallTranscript(resolvedContent) : undefined;
    return transcript ? (
      <CallTranscriptCard
        transcript={transcript}
        sender={mEvent?.getSender()}
        roomId={roomId ?? mEvent?.getRoomId()}
        fallback={body}
        highlightRegex={highlightRegex}
        linkifyOpts={linkifyOpts}
      />
    ) : (
      body
    );
  };

  const renderLongTextBody: ComponentProps<typeof LongTextText>['renderBody'] = (
    resolvedContent,
    props,
    metadataStatus
  ) =>
    renderLongCallTranscript(
      resolvedContent,
      wrapWithReasoning(
        // The live reasoning rides on the outer content, not on the preview or the sidecar.
        content[LIVE_REASONING_KEY] === undefined
          ? resolvedContent
          : { ...resolvedContent, [LIVE_REASONING_KEY]: content[LIVE_REASONING_KEY] },
        <AgentRenderBody
          {...props}
          highlightRegex={highlightRegex}
          htmlReactParserOptions={htmlReactParserOptions}
          markerContent={resolvedContent}
          metadataStatus={metadataStatus}
          linkifyOpts={linkifyOpts}
        />
      )
    );

  const renderMessageExtras = (
    extrasContent: Record<string, unknown>,
    fallbackContents: Record<string, unknown>[] = []
  ) => {
    if (!showMessageExtras) return undefined;

    const extrasSource = [extrasContent, ...fallbackContents].find(
      (candidate) => MINDROOM_MESSAGE_EXTRAS_KEY in candidate
    );
    const extras = extrasSource && parseMessageExtras(extrasSource);
    if (!extrasSource || !extras) return undefined;

    return (
      <MessageExtras
        extras={extras}
        htmlReactParserOptions={htmlReactParserOptions}
        markerContent={extrasSource}
      />
    );
  };

  const getMessageStateSuffix = (renderStateSuffix?: () => ReactNode) =>
    getMessageStateSuffixRenderer({
      edited,
      pendingSend,
      failedSend,
      renderStateSuffix,
    });

  const canvasReceipt = msgType === MsgType.Text ? readCanvasResponse(content) : undefined;
  if (canvasReceipt) {
    return (
      <CanvasResponseReceipt
        receipt={canvasReceipt}
        delivered={!pendingSend && !failedSend}
        renderStateSuffix={getMessageStateSuffix()}
      />
    );
  }

  const threadSummaryInfo = getThreadSummaryInfo(content);
  if (threadSummaryInfo) {
    return (
      <ThreadSummaryCard
        edited={edited}
        summaryInfo={threadSummaryInfo}
        renderBody={renderBody(content)}
      />
    );
  }

  // An open thread shows this as a marker row of its own (useTimelineMessageFeature); other
  // views, such as threads shown in the room, keep the message row with the marker as its body.
  const snoozeEndedNote = fromMindroomAgent ? readSnoozeEndedNote(content) : null;
  if (snoozeEndedNote !== null) return <SnoozeEndedMarker note={snoozeEndedNote} />;

  if (eventType === MINDROOM_TOOL_APPROVAL_EVENT) {
    // Only MindRoom sends approval cards; any member can post this event type.
    const approval = fromMindroomAgent ? parseToolApprovalContent(eventType, content) : null;
    return approval ? (
      <ToolApprovalCard approval={approval} roomId={roomId} eventId={eventId} threadId={threadId} />
    ) : (
      <BrokenContent />
    );
  }

  if (msgType === MsgType.Text || msgType === MsgType.File) {
    if (msgType === MsgType.Text && isTranscribingPlaceholder(content)) {
      return (
        <MText
          content={content}
          renderStateSuffix={getMessageStateSuffix()}
          renderBody={() => <TranscribingPlaceholder />}
          renderAfterBody={renderMessageExtras(content)}
        />
      );
    }

    const isStreaming = isAiRunStreaming(content);
    if (msgType === MsgType.Text && isStreaming && isThinkingPlaceholderBody(content)) {
      return (
        <MText
          content={content}
          renderStateSuffix={getMessageStateSuffix()}
          renderBody={() =>
            wrapWithReasoning(content, <ThinkingPlaceholder startedAt={mEvent?.getTs()} />)
          }
          renderAfterBody={renderMessageExtras(content)}
        />
      );
    }

    const longTextSource = getRenderableLongTextSource(content);
    if (longTextSource) {
      const longText = (
        <LongTextText
          kind={LongTextKind.Text}
          edited={edited}
          renderStateSuffix={getMessageStateSuffix(
            isStreaming ? renderStreamingIndicator : undefined
          )}
          content={longTextSource.previewContent}
          longTextSource={{ ...longTextSource, owner: getEventAttachmentOwner(mEvent) }}
          hydrate={hydrateLongText}
          renderBody={renderLongTextBody}
          renderAfterBody={(extrasContent, fallbackContent) =>
            renderMessageExtras(extrasContent, [content, fallbackContent])
          }
          renderUrlsPreview={renderUrlsPreview}
        />
      );
      // A canvas answer too large for one event arrives as a sidecar; its receipt waits for the file.
      if (msgType === MsgType.File && content[CANVAS_RESPONSE_KEY]) {
        return (
          <CanvasResponseSidecarReceipt
            source={{ ...longTextSource, owner: getEventAttachmentOwner(mEvent) }}
            relation={content['m.relates_to']}
            hydrate={hydrateLongText}
            delivered={!pendingSend && !failedSend}
            renderStateSuffix={getMessageStateSuffix()}
            fallback={longText}
          />
        );
      }
      return longText;
    }

    if (msgType === MsgType.File) {
      const pasteAttachment = getPasteAttachmentFile(content);
      if (pasteAttachment) {
        return (
          <PasteAttachmentContent
            owner={getEventAttachmentOwner(mEvent)}
            attachment={pasteAttachment}
          />
        );
      }
    }

    if (msgType === MsgType.Text) {
      const renderableContent = withToolRefFormattedBodyFallback(content);
      return (
        <MText
          edited={edited}
          renderStateSuffix={getMessageStateSuffix(
            isStreaming ? renderStreamingIndicator : undefined
          )}
          content={renderableContent}
          renderBody={renderBody(renderableContent)}
          renderAfterBody={renderMessageExtras(renderableContent)}
          renderUrlsPreview={renderUrlsPreview}
        />
      );
    }
  }

  if (msgType === MsgType.Emote) {
    const isStreaming = isAiRunStreaming(content);
    const longTextSource = getRenderableLongTextSource(content);
    if (longTextSource) {
      return (
        <LongTextText
          kind={LongTextKind.Emote}
          displayName={displayName}
          edited={edited}
          renderStateSuffix={getMessageStateSuffix(
            isStreaming ? renderStreamingIndicator : undefined
          )}
          content={longTextSource.previewContent}
          longTextSource={{ ...longTextSource, owner: getEventAttachmentOwner(mEvent) }}
          hydrate={hydrateLongText}
          renderBody={renderLongTextBody}
          renderAfterBody={(extrasContent, fallbackContent) =>
            renderMessageExtras(extrasContent, [content, fallbackContent])
          }
          renderUrlsPreview={renderUrlsPreview}
        />
      );
    }

    const renderableContent = withToolRefFormattedBodyFallback(content);
    return (
      <MEmote
        displayName={displayName}
        edited={edited}
        renderStateSuffix={getMessageStateSuffix(
          isStreaming ? renderStreamingIndicator : undefined
        )}
        content={renderableContent}
        renderBody={renderBody(renderableContent)}
        renderAfterBody={renderMessageExtras(renderableContent)}
        renderUrlsPreview={renderUrlsPreview}
      />
    );
  }

  if (msgType === MsgType.Notice) {
    const uiAction = content[CHAT_UI_ACTION_KEY];
    // Canvas updates are edits of the request, so an edited canvas keeps its button.
    const editableUiAction =
      !!uiAction &&
      typeof uiAction === 'object' &&
      (uiAction as Record<string, unknown>).action === 'show_canvas';
    if (mEvent && uiAction && (!edited || editableUiAction)) {
      // The body of a canvas request tells other Matrix clients to open MindRoom Chat; Chat names the canvas.
      const canvasTitle = fromMindroomAgent ? readCanvasNoticeTitle(content) : undefined;
      return (
        <MNotice
          content={content}
          renderBody={
            canvasTitle
              ? () => (
                  <Box as="span" alignItems="Center" gap="200" data-canvas-notice-title>
                    <Icon size="100" src={Icons.Category} />
                    <span {...ownDirectionLine}>{canvasTitle}</span>
                  </Box>
                )
              : renderBody(content)
          }
          renderAfterBody={<ChatUiActionButton event={mEvent} />}
        />
      );
    }
    const isStreaming = isAiRunStreaming(content);
    const longTextSource = getRenderableLongTextSource(content);
    if (longTextSource) {
      return (
        <LongTextText
          kind={LongTextKind.Notice}
          edited={edited}
          renderStateSuffix={getMessageStateSuffix(
            isStreaming ? renderStreamingIndicator : undefined
          )}
          content={longTextSource.previewContent}
          longTextSource={{ ...longTextSource, owner: getEventAttachmentOwner(mEvent) }}
          hydrate={hydrateLongText}
          renderBody={renderLongTextBody}
          renderAfterBody={(extrasContent, fallbackContent) =>
            renderMessageExtras(extrasContent, [content, fallbackContent])
          }
          renderUrlsPreview={renderUrlsPreview}
        />
      );
    }

    const renderableContent = withToolRefFormattedBodyFallback(content);
    return (
      <MNotice
        edited={edited}
        renderStateSuffix={getMessageStateSuffix(
          isStreaming ? renderStreamingIndicator : undefined
        )}
        content={renderableContent}
        renderBody={renderBody(renderableContent)}
        renderAfterBody={renderMessageExtras(renderableContent)}
        renderUrlsPreview={renderUrlsPreview}
      />
    );
  }

  return undefined;
};
