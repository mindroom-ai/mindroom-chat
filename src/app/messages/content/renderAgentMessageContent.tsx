import { useContext, useMemo, type ComponentProps, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { MsgType, type MatrixEvent } from 'matrix-js-sdk';
import { Box, Icon, Icons, Spinner, Text as FText, config } from 'folds';
import type { HTMLReactParserOptions } from 'html-react-parser';
import {
  resolveHtmlReactParserOptions,
  type HtmlReactParserOptionsSource,
} from '../../rich-text/htmlReactParserOptions';
import type { Opts as LinkifyOpts } from 'linkifyjs';
import { getEventAttachmentOwner } from '../../matrix/protocol/eventAttachments';
import { INLINE_MEDIA_CONTENT_KEY, readInlineMedia } from '../../matrix/protocol/inlineMedia';
import { COMPACTIONS_CONTENT_KEY } from '../../matrix/protocol/compactions';
import { MEmote, MNotice, MText } from './MsgTypeRenderers';
import { RenderBody } from './RenderBody';
import { useBodySanitizeOptions } from './useBodySanitizeOptions';
import { BrokenContent } from './BrokenContent';
import { trimReplyFromBody } from '../../matrix/room';
import { useToolTraceMarkerParserOptions } from '../html/HtmlBlocks';
import type { ToolMetadataStatus } from '../../matrix/protocol/toolTrace';
import { getAiRunInfo, isAiRunStreaming, isFinishedAgentReply } from '../../matrix/protocol/aiRun';
import { formatMarkdownTextBodyAsHtml, formatMessageTextBodyAsHtml } from '../html/blocks';
import { getLongTextSource, type LongTextSource } from '../../matrix/protocol/longText';
import { useResolvedMessageContent } from './useResolvedMessageContent';
import { PasteAttachmentContent } from './PasteAttachmentContent';
import { ThinkingPlaceholder } from '../agent-run/ThinkingPlaceholder';
import { withReasoning } from '../agent-run/Reasoning';
import { FinishedWorkFold } from '../agent-run/FinishedWorkFold';
import { splitFinishedWork } from '../agent-run/finishedWorkSplit';
import { RestartSeam, RunErrorCard } from '../agent-run/RunErrorCard';
import { parseRestartSeamNode, prepareRunErrorBody } from '../agent-run/runErrorHtml';
import { LIVE_COMPACTIONS_KEY } from '../live/useLiveReplyContent';
import { TranscribingPlaceholder } from '../agent-run/TranscribingPlaceholder';
import { ThreadSummaryCard } from '../thread-summary/ThreadSummaryCard';
import { ToolApprovalCard } from '../../approvals/ToolApprovalCard';
import { SecretRequestCard } from '../../approvals/SecretRequestCard';
import { useSecretRequestWaiting } from '../inlineSecretRequests';
import { ToolCallMessageContext } from '../agent-run/toolCallStatus';
import { renderStreamingIndicator } from '../agent-run/StreamingIndicator';
import { isThinkingPlaceholderBody } from '../../matrix/protocol/thinkingPlaceholder';
import { isTranscribingPlaceholder } from '../../matrix/protocol/transcribingPlaceholder';
import { getPasteAttachmentFile } from '../../matrix/protocol/pasteAttachmentMarker';
import {
  MINDROOM_TOOL_APPROVAL_EVENT,
  parseToolApprovalContent,
} from '../../matrix/protocol/toolApproval';
import { getThreadSummaryInfo } from '../../matrix/protocol/threadSummary';
import { parseSecretRequestContent } from '../../matrix/protocol/secretRequest';
import {
  parseWorkflowRunCard,
  parseWorkflowRunQuestion,
} from '../../matrix/protocol/workflowRunContent';
import { WorkflowQuestionCard } from '../workflow-run/WorkflowQuestionCard';
import { WorkflowRunCard } from '../workflow-run/WorkflowRunCard';
import { readAgentNoticeMarker } from '../agentNoticeMarker';
import { readTriggerWake } from '../../matrix/protocol/triggerWake';
import { readTodoPoke } from '../../matrix/protocol/todoPoke';
import { TriggerWakeMarker } from '../TriggerWakeMarker';
import { TodoPokeMarker } from '../TodoPokeMarker';
import { getMessageStateSuffixRenderer } from './messageStateSuffix';
import { InlineCanvasFrame } from '../canvas/InlineCanvasFrame';
import { ChatUiActionButton } from '../../ui-actions/ChatUiActionButton';
import { CHAT_UI_ACTION_KEY, readCanvasNoticeTitle } from '../../matrix/protocol/chatUiProtocol';
import {
  CANVAS_RESPONSE_KEY,
  readCanvasResponse,
  readCanvasSidecarResponse,
} from '../canvas/canvasMessages';
import { CanvasResponseReceipt } from '../canvas/CanvasResponseReceipt';
import { readCallTranscript } from '../../matrix/protocol/callTranscript';
import { CallTranscriptCard } from './CallTranscriptCard';
import { readInteractiveQuestion } from '../../matrix/protocol/interactiveQuestion';
import { QuestionCard } from '../question/QuestionCard';
import { QuestionReply } from '../question/QuestionReply';
import { ownDirectionLine } from '../../ui/directional';
import { matchesEnum } from '../../lib/matchesEnum';

const withoutCompactions = (content: Record<string, unknown>): Record<string, unknown> => {
  if (!(COMPACTIONS_CONTENT_KEY in content) && !(LIVE_COMPACTIONS_KEY in content)) return content;
  const { [COMPACTIONS_CONTENT_KEY]: _list, [LIVE_COMPACTIONS_KEY]: _live, ...rest } = content;
  return rest;
};

const withToolRefFormattedBodyFallback = (
  bodyContent: Record<string, unknown>,
  fromMindroomAgent: boolean
) => {
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
  ts?: number;
  edited?: boolean;
  content: Record<string, unknown>;
  pendingSend?: boolean;
  failedSend?: boolean;
  highlightRegex?: RegExp;
  htmlReactParserOptions: HTMLReactParserOptions; // turns formatted_body HTML into React nodes
  linkifyOpts: LinkifyOpts; // links bare URLs in plain-text bodies
  renderUrlsPreview?: (urls: string[]) => ReactNode;
  hydrateLongText?: boolean;
  /** Shown in another thread's view (a fork's prefix): its cards offer no decisions there. */
  readOnly?: boolean;
  /** Disable RunErrorCard, fallback error stripping, and restart seams (e.g. search previews). */
  disableRunErrorUi?: boolean;
};

type AgentRenderBodyProps = Omit<ComponentProps<typeof RenderBody>, 'htmlReactParserOptions'> & {
  htmlReactParserOptions: HTMLReactParserOptions;
  /** The content whose tool and paste markers the body renders. */
  markerContent: Record<string, unknown>;
  metadataStatus?: ToolMetadataStatus;
  /** Whether a tool marker draws a row: only an agent's does. */
  toolRows: boolean;
  mEvent?: MatrixEvent;
  /** Whether the HTML contains service-restart seam sentinels to replace. */
  restartSeams?: boolean;
};

/** A body with MindRoom's markers, parsed again only when that message changes. */
function AgentRenderBody({
  htmlReactParserOptions,
  markerContent,
  metadataStatus,
  toolRows,
  mEvent,
  restartSeams = false,
  ...props
}: AgentRenderBodyProps) {
  const rawInlineMedia = markerContent[INLINE_MEDIA_CONTENT_KEY];
  const inlineMedia = useMemo(() => {
    const entries = readInlineMedia(rawInlineMedia);
    return entries ? { entries, owner: getEventAttachmentOwner(mEvent) } : undefined;
  }, [rawInlineMedia, mEvent]);
  const toolOptions = useToolTraceMarkerParserOptions(
    htmlReactParserOptions,
    markerContent,
    metadataStatus,
    toolRows
  );
  const parserOptions = useMemo<HtmlReactParserOptionsSource>(() => {
    if (!restartSeams) return toolOptions;
    return () => {
      const resolved = resolveHtmlReactParserOptions(toolOptions);
      return {
        ...resolved,
        replace: (domNode, index) => {
          const restartCount = parseRestartSeamNode(domNode);
          if (restartCount !== undefined) return <RestartSeam count={restartCount} />;
          return resolved.replace?.(domNode, index);
        },
      };
    };
  }, [restartSeams, toolOptions]);

  return <RenderBody {...props} inlineMedia={inlineMedia} htmlReactParserOptions={parserOptions} />;
}

type AgentWorkBodyProps = {
  /** The body's HTML; undefined for a plain body or the thinking placeholder. */
  html?: string;
  foldKey: string;
  /** Whether the reply finished and may fold its work. */
  finished: boolean;
  durationMs?: number;
  /** The body of the given HTML. */
  renderHtml: (customBody: string | undefined) => ReactNode;
  /** The reasoning header and tool-call cog around a body. */
  wrapWithReasoning: (body: ReactNode) => ReactNode;
  /** The base parser options the body renders with, which decide where its work ends. */
  htmlReactParserOptions: HTMLReactParserOptions;
};

/**
 * An agent reply, in the same tree from its first streamed frame on, with or without tool calls,
 * so the state inside it, such as collapsed reasoning, stays as they come; its work folded once it
 * finished with an answer after its last tool call and text or media before it
 * (`splitFinishedWork`).
 */
function AgentWorkBody({
  html,
  foldKey,
  finished,
  durationMs,
  renderHtml,
  wrapWithReasoning,
  htmlReactParserOptions,
}: AgentWorkBodyProps) {
  // While a request of its calls waits, under it, the work stays open: the call it blocks shows.
  const waiting = useSecretRequestWaiting(useContext(ToolCallMessageContext)?.eventId);
  const sanitizeOptions = useBodySanitizeOptions();
  // A timeline renders its rows again on each streamed edit of any reply; the split waits for this
  // reply's own HTML to change, and for it to finish.
  const split = useMemo(
    () =>
      finished && !waiting && html !== undefined
        ? splitFinishedWork(html, htmlReactParserOptions, sanitizeOptions)
        : undefined,
    [finished, waiting, html, htmlReactParserOptions, sanitizeOptions]
  );
  return (
    <FinishedWorkFold
      foldKey={foldKey}
      durationMs={durationMs}
      whole={wrapWithReasoning(renderHtml(html))}
      folded={
        split && {
          work: wrapWithReasoning(renderHtml(split.head)),
          answer: renderHtml(split.tail),
        }
      }
    />
  );
}

type AgentTextKind = 'text' | 'emote' | 'notice';

type RenderMessageBodyFn = (
  bodyContent: Record<string, unknown>,
  props: { body: string; customBody?: string },
  options?: {
    canFold?: boolean;
    metadataStatus?: ToolMetadataStatus;
    allowFallback?: boolean;
    allowRunError?: boolean;
  }
) => ReactNode;

type AgentTextMessageProps = {
  options: RenderAgentMessageContentOptions;
  kind: AgentTextKind;
  isFileMessage: boolean;
  isThinkingPlaceholder: boolean;
  renderableContent: Record<string, unknown>;
  longTextSource?: LongTextSource;
  isStreaming: boolean;
  renderBody: RenderMessageBodyFn;
  renderThinkingBody: (bodyContent: Record<string, unknown>) => ReactNode;
  renderRunErrorCard: (bodyContent: Record<string, unknown>) => ReactNode;
};

/**
 * Unified text/notice/emote/long-text message component. Keeps one tree identity across
 * ThinkingPlaceholder -> streamed m.notice -> m.text -> m.file sidecar -> live m.text -> final
 * sidecar while resolving sidecar content, canvas sidecar receipts, wake/poke markers, and call
 * transcripts through one seam (`useResolvedMessageContent`).
 */
function AgentTextMessage({
  options,
  kind,
  isFileMessage,
  isThinkingPlaceholder,
  renderableContent,
  longTextSource,
  isStreaming,
  renderBody,
  renderThinkingBody,
  renderRunErrorCard,
}: AgentTextMessageProps) {
  const {
    mEvent,
    fromMindroomAgent = false,
    displayName,
    roomId,
    ts,
    edited,
    content: outerContent,
    pendingSend,
    failedSend,
    highlightRegex,
    linkifyOpts,
    renderUrlsPreview,
    hydrateLongText = true,
  } = options;
  const { t } = useTranslation();
  const resolved = useResolvedMessageContent({
    outerContent,
    content: renderableContent,
    longTextSource,
    fromMindroomAgent,
    hydrate: hydrateLongText,
  });

  if (longTextSource && isFileMessage && outerContent[CANVAS_RESPONSE_KEY]) {
    const receipt = readCanvasSidecarResponse(
      resolved.rawHydratedContent,
      outerContent['m.relates_to']
    );
    if (receipt) {
      return (
        <CanvasResponseReceipt
          receipt={receipt}
          delivered={!pendingSend && !failedSend}
          renderStateSuffix={getMessageStateSuffixRenderer({ edited, pendingSend, failedSend })}
        />
      );
    }
  }

  if (!highlightRegex && fromMindroomAgent && kind !== 'emote') {
    const triggerWake = readTriggerWake(resolved.content);
    if (triggerWake) {
      return (
        <TriggerWakeMarker
          wake={triggerWake}
          ts={ts ?? mEvent?.getTs()}
          roomId={roomId ?? mEvent?.getRoomId()}
        />
      );
    }
    const todoPoke = readTodoPoke(resolved.content);
    if (todoPoke) {
      return (
        <TodoPokeMarker
          poke={todoPoke}
          ts={ts ?? mEvent?.getTs()}
          senderDisplayName={displayName}
        />
      );
    }
  }

  const textProps = {
    edited: isThinkingPlaceholder ? undefined : edited,
    renderStateSuffix: getMessageStateSuffixRenderer({
      edited,
      pendingSend,
      failedSend,
      renderStateSuffix:
        isStreaming && !isThinkingPlaceholder ? renderStreamingIndicator : undefined,
    }),
    content: resolved.content,
    renderBody: isThinkingPlaceholder
      ? () => renderThinkingBody(resolved.content)
      : (props: { body: string; customBody?: string }) =>
          renderBody(resolved.content, props, {
            canFold: resolved.canFold,
            metadataStatus: resolved.toolMetadataStatus,
            allowFallback: !longTextSource,
          }),
    renderAfterBody: renderRunErrorCard(resolved.content),
    renderUrlsPreview:
      isThinkingPlaceholder || resolved.toolMetadataStatus === 'loading'
        ? undefined
        : renderUrlsPreview,
  };

  const textElement = (
    <>
      {kind === 'emote' ? (
        <MEmote displayName={displayName} {...textProps} />
      ) : (
        <MText {...textProps} />
      )}
      {resolved.showLoadingIndicator && (
        <Box alignItems="Center" gap="100" style={{ marginTop: config.space.S100 }}>
          <Spinner size="100" variant="Secondary" />
          <FText size="T200">
            {t('mindroomUi.messages.mindroomLongTextText.loadingFullResponse')}
          </FText>
        </Box>
      )}
    </>
  );

  const callTranscript = fromMindroomAgent ? readCallTranscript(resolved.content) : undefined;
  if (callTranscript) {
    return (
      <CallTranscriptCard
        transcript={callTranscript}
        sender={mEvent?.getSender()}
        roomId={roomId ?? mEvent?.getRoomId()}
        fallback={textElement}
        highlightRegex={highlightRegex}
        linkifyOpts={linkifyOpts}
      />
    );
  }

  return textElement;
}

export const renderAgentMessageContent = (
  options: RenderAgentMessageContentOptions
): ReactNode | undefined => {
  const {
    mEvent,
    fromMindroomAgent = false,
    displayName,
    eventType,
    roomId,
    eventId,
    threadId,
    msgType,
    ts,
    edited,
    content,
    pendingSend,
    failedSend,
    highlightRegex,
    htmlReactParserOptions,
    linkifyOpts,
    readOnly,
    disableRunErrorUi = false,
  } = options;
  // A MindRoom agent's question shows as a card with a button per option.
  const question = fromMindroomAgent
    ? readInteractiveQuestion(content, mEvent?.getOriginalContent())
    : undefined;
  const renderQuestionCard =
    question && mEvent
      ? (showText: boolean) => (
          <QuestionCard
            question={question}
            mEvent={mEvent}
            roomId={roomId ?? mEvent.getRoomId()}
            threadId={threadId}
            readOnly={readOnly}
            showText={showText}
          />
        )
      : undefined;
  // Anyone can type a tool marker, so only an agent's draws a row, as only an agent's trace counts.
  // Content without an event is the app's own (a sub-agent's run), not something a member sent.
  const toolRows = fromMindroomAgent || !mEvent;

  // The reply's HTML goes along whole: its tool markers place the reasoning segments.
  // A reply's compactions count only from an agent for this viewer, as a compaction notice does.
  const wrapWithReasoning = (
    bodyContent: Record<string, unknown>,
    html: string | undefined,
    body: ReactNode
  ) =>
    withReasoning(
      fromMindroomAgent ? bodyContent : withoutCompactions(bodyContent),
      body,
      htmlReactParserOptions,
      linkifyOpts,
      html
    );

  // A finished reply folds its work, everything up to its last tool call, behind one row, as
  // T3 Code folds a finished turn; the answer after it stays. The work took from the reply's first
  // event to its final edit. Search results and highlighted rows show the whole reply. A
  // regenerated reply keeps its previous answer's run status, so a stream status of its own must
  // also say it ended well.
  const foldEventId = eventId ?? mEvent?.getId();
  const outerAiRun = getAiRunInfo(content);
  const foldsWork = fromMindroomAgent && highlightRegex === undefined;
  const finished = isFinishedAgentReply(content);
  const finalEditTs = mEvent?.replacingEvent()?.getTs();
  const workDurationMs =
    finalEditTs === undefined || mEvent === undefined ? undefined : finalEditTs - mEvent.getTs();

  // Search previews disable run-error UI explicitly (even when highlightRegex is undefined,
  // e.g. an m.replace hit with no highlights), and highlighted hits also stay intact.
  const showRunErrorUi = fromMindroomAgent && !disableRunErrorUi && highlightRegex === undefined;

  /**
   * Renders RunErrorCard outside MessageTextBody (via renderAfterBody) so the card and its
   * interactive controls never inherit MessageTextBody's P400/P300 opacity dimming.
   */
  const renderRunErrorCard = (bodyContent: Record<string, unknown>): ReactNode => {
    if (!showRunErrorUi) return null;
    const aiRun = getAiRunInfo(bodyContent) ?? outerAiRun;
    if (!aiRun?.error) return null;
    return (
      <RunErrorCard
        error={aiRun.error}
        aiRun={aiRun}
        mEvent={mEvent}
        roomId={roomId ?? mEvent?.getRoomId()}
        threadId={threadId}
        readOnly={readOnly}
        linkifyOpts={linkifyOpts}
      />
    );
  };

  /** The reply's reasoning and body, folded work, question card, and restart seam. */
  const wrapAgentBody = (
    bodyContent: Record<string, unknown>,
    html: string | undefined,
    renderHtml: (
      customBody: string | undefined,
      restartSeams: boolean,
      effectiveBody: string | undefined
    ) => ReactNode,
    canFold = true,
    plainBody?: string,
    allowRunError = true
  ) => {
    const runErrorEnabled = showRunErrorUi && allowRunError;
    const prepared = prepareRunErrorBody({
      enabled: runErrorEnabled,
      body: plainBody,
      html,
      aiRun: runErrorEnabled ? (getAiRunInfo(bodyContent) ?? outerAiRun) : undefined,
    });

    const renderEffectiveHtml = (customBody: string | undefined): ReactNode =>
      prepared.bodyEmpty ? null : renderHtml(customBody, prepared.hasRestartSeam, prepared.body);

    const wrap = (
      render: (customBody: string | undefined) => ReactNode,
      bodyHtml: string | undefined = prepared.html
    ) => {
      if (!foldsWork || foldEventId === undefined) {
        return wrapWithReasoning(bodyContent, bodyHtml, render(bodyHtml));
      }
      return (
        <AgentWorkBody
          html={bodyHtml}
          foldKey={`finished-work:${foldEventId}`}
          finished={finished && canFold}
          durationMs={workDurationMs}
          renderHtml={render}
          wrapWithReasoning={(body) => wrapWithReasoning(bodyContent, bodyHtml, body)}
          htmlReactParserOptions={htmlReactParserOptions}
        />
      );
    };

    return (
      <QuestionReply
        html={prepared.html}
        question={question}
        renderCard={renderQuestionCard}
        renderHtml={renderEffectiveHtml}
        renderBody={wrap}
      />
    );
  };

  const renderMessageBody: RenderMessageBodyFn = (
    bodyContent,
    props,
    { canFold = true, metadataStatus, allowFallback = true, allowRunError = true } = {}
  ) => {
    const { body, customBody: providedCustomBody } = props;
    const renderableContent =
      providedCustomBody === undefined && allowFallback
        ? withToolRefFormattedBodyFallback({ ...bodyContent, body }, fromMindroomAgent)
        : bodyContent;
    const customBody =
      providedCustomBody ??
      (allowFallback && typeof renderableContent.formatted_body === 'string'
        ? renderableContent.formatted_body
        : undefined);
    return wrapAgentBody(
      renderableContent,
      customBody,
      (html, restartSeams, effectiveBody) => (
        <AgentRenderBody
          {...props}
          body={effectiveBody ?? body}
          customBody={html}
          highlightRegex={highlightRegex}
          htmlReactParserOptions={htmlReactParserOptions}
          markerContent={renderableContent}
          metadataStatus={metadataStatus}
          toolRows={toolRows}
          mEvent={mEvent}
          restartSeams={restartSeams}
          linkifyOpts={linkifyOpts}
        />
      ),
      canFold,
      body,
      allowRunError
    );
  };

  const getMessageStateSuffix = (renderStateSuffix?: () => ReactNode) =>
    getMessageStateSuffixRenderer({
      edited,
      pendingSend,
      failedSend,
      renderStateSuffix,
    });

  const isTextMessage = matchesEnum(msgType, MsgType.Text);
  const isFileMessage = matchesEnum(msgType, MsgType.File);
  const canvasReceipt = isTextMessage ? readCanvasResponse(content) : undefined;
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
        renderBody={(props) => renderMessageBody(content, props, { allowRunError: false })}
      />
    );
  }

  // An open thread shows these as marker rows of their own (useTimelineMessageFeature); other
  // views, such as threads shown in the room, keep the message row with the marker as its body.
  // Search results pass highlightRegex so matches stay visible inline instead of collapsing.
  const notice =
    fromMindroomAgent && !highlightRegex
      ? readAgentNoticeMarker(
          content,
          ts ?? mEvent?.getTs(),
          roomId ?? mEvent?.getRoomId(),
          displayName
        )
      : null;
  if (notice) return notice;

  // Workflow run and question notices render as cards only when sent by a MindRoom agent.
  const workflowRoomId = roomId ?? mEvent?.getRoomId();
  if (fromMindroomAgent && workflowRoomId) {
    const common = {
      roomId: workflowRoomId,
      threadId: threadId ?? mEvent?.threadRootId ?? null,
      eventId: eventId ?? mEvent?.getId(),
      readOnly,
    };
    const runCard = parseWorkflowRunCard(content);
    if (runCard)
      return (
        <WorkflowRunCard
          card={runCard}
          sender={mEvent?.getSender()}
          updatedAt={mEvent?.replacingEvent()?.getTs() ?? mEvent?.getTs()}
          {...common}
        />
      );
    const workflowQuestion = parseWorkflowRunQuestion(content);
    if (workflowQuestion) return <WorkflowQuestionCard question={workflowQuestion} {...common} />;
  }

  // An agent asking for a key; any member can write this content, which then renders as its body.
  // The answer goes to the sender's own MindRoom server.
  const secretRequest = fromMindroomAgent ? parseSecretRequestContent(content) : null;
  const secretRequestRoomId = roomId ?? mEvent?.getRoomId();
  const secretRequestSender = mEvent?.getSender();
  if (secretRequest && secretRequestRoomId && secretRequestSender) {
    return (
      <SecretRequestCard
        request={secretRequest}
        roomId={secretRequestRoomId}
        agentUserId={secretRequestSender}
        eventId={eventId ?? mEvent?.getId()}
        readOnly={readOnly}
      />
    );
  }

  if (eventType === MINDROOM_TOOL_APPROVAL_EVENT) {
    // Only MindRoom sends approval cards; any member can post this event type.
    const approval = fromMindroomAgent ? parseToolApprovalContent(eventType, content) : null;
    return approval ? (
      <ToolApprovalCard
        approval={approval}
        roomId={roomId}
        eventId={eventId}
        threadId={threadId}
        readOnly={readOnly}
      />
    ) : (
      <BrokenContent />
    );
  }

  let textKind: AgentTextKind | undefined;
  if (isTextMessage || isFileMessage) {
    if (isTextMessage && isTranscribingPlaceholder(content)) {
      return (
        <MText
          content={content}
          renderStateSuffix={getMessageStateSuffix()}
          renderBody={() => <TranscribingPlaceholder />}
        />
      );
    }
    textKind = 'text';
  } else if (matchesEnum(msgType, MsgType.Emote)) {
    textKind = 'emote';
  } else if (matchesEnum(msgType, MsgType.Notice)) {
    const uiAction = content[CHAT_UI_ACTION_KEY];
    // Canvas updates are edits of the request, so an edited canvas keeps its button.
    const editableUiAction =
      !!uiAction &&
      typeof uiAction === 'object' &&
      (uiAction as Record<string, unknown>).action === 'show_canvas';
    if (mEvent && uiAction && (!edited || editableUiAction)) {
      // The body of a canvas request tells other Matrix clients to open MindRoom Chat; Chat names the canvas.
      const canvasTitle = fromMindroomAgent ? readCanvasNoticeTitle(content) : undefined;
      const noticeElement = (
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
              : (props) => renderMessageBody(content, props)
          }
          // A read-only row (a fork's parent message) answers nothing: its canvas is the parent's.
          // An inline page still shows there, display-only.
          renderAfterBody={(() => {
            const uiActionButton = !readOnly && <ChatUiActionButton event={mEvent} />;
            const runErrorCard = renderRunErrorCard(content);
            if (uiActionButton && runErrorCard) {
              return (
                <>
                  {uiActionButton}
                  {runErrorCard}
                </>
              );
            }
            return uiActionButton || runErrorCard;
          })()}
        />
      );
      return canvasTitle ? (
        <InlineCanvasFrame event={mEvent} readOnly={readOnly} fallback={noticeElement} />
      ) : (
        noticeElement
      );
    }
    textKind = 'notice';
  } else {
    return undefined;
  }

  const longTextSource = getRenderableLongTextSource(content);
  if (!longTextSource && isFileMessage) {
    const pasteAttachment = getPasteAttachmentFile(content);
    if (pasteAttachment) {
      return (
        <PasteAttachmentContent
          owner={getEventAttachmentOwner(mEvent)}
          attachment={pasteAttachment}
        />
      );
    }
    return undefined;
  }

  const isStreaming = isAiRunStreaming(content);
  const isThinkingPlaceholder =
    !longTextSource && isTextMessage && isStreaming && isThinkingPlaceholderBody(content);
  const renderableContent = longTextSource
    ? longTextSource.previewContent
    : isThinkingPlaceholder
      ? content
      : withToolRefFormattedBodyFallback(content, fromMindroomAgent);

  return (
    <AgentTextMessage
      options={options}
      kind={textKind}
      isFileMessage={isFileMessage}
      isThinkingPlaceholder={isThinkingPlaceholder}
      renderableContent={renderableContent}
      longTextSource={
        longTextSource ? { ...longTextSource, owner: getEventAttachmentOwner(mEvent) } : undefined
      }
      isStreaming={isStreaming}
      renderBody={renderMessageBody}
      renderThinkingBody={(bodyContent) =>
        // In the reply's own tree, so its reasoning stays as the first text replaces this.
        wrapAgentBody(
          bodyContent,
          undefined,
          () => <ThinkingPlaceholder startedAt={mEvent?.getTs()} />,
          false
        )
      }
      renderRunErrorCard={renderRunErrorCard}
    />
  );
};
