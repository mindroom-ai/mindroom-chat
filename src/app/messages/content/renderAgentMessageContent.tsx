import { useContext, useMemo, type JSX, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { MsgType, type MatrixEvent } from 'matrix-js-sdk';
import { Box, Icon, Icons, Spinner, Text as FText, config } from 'folds';
import type { ChildNode } from 'domhandler';
import type { HTMLReactParserOptions } from 'html-react-parser';
import {
  resolveHtmlReactParserOptions,
  type HtmlReactParserOptionsSource,
} from '../../rich-text/htmlReactParserOptions';
import { FootnoteScopeProvider } from '../../rich-text/Footnote';
import { sanitizeCustomHtml } from '../../rich-text/sanitize';
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
import { ReplyReasoning } from '../agent-run/Reasoning';
import { FinishedWorkFold } from '../agent-run/FinishedWorkFold';
import { RestartSeam, RunErrorCard } from '../agent-run/RunErrorCard';
import { stripTrailingRunErrorText } from '../agent-run/runErrorHtml';
import { getReplySlot, parseRenderedHtml, prepareAgentReplyDom } from '../agent-run/replyDom';
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
import { ownDirectionLine } from '../../ui/directional';
import { matchesEnum } from '../../lib/matchesEnum';

const useStableJson = <T,>(value: T | undefined): T | undefined => {
  const key = value === undefined ? undefined : JSON.stringify(value);
  return useMemo(() => (key === undefined ? undefined : (JSON.parse(key) as T)), [key]);
};

const withoutCompactions = (content: Record<string, unknown>): Record<string, unknown> => {
  if (!(COMPACTIONS_CONTENT_KEY in content) && !(LIVE_COMPACTIONS_KEY in content)) return content;
  const { [COMPACTIONS_CONTENT_KEY]: _list, [LIVE_COMPACTIONS_KEY]: _live, ...rest } = content;
  return rest;
};

const withToolRefFormattedBodyFallback = (
  bodyContent: Record<string, unknown>,
  fromMindroomAgent: boolean
) => {
  if (typeof bodyContent.formatted_body === 'string' || typeof bodyContent.body !== 'string') {
    return bodyContent;
  }
  const formattedBody =
    (fromMindroomAgent && formatMarkdownTextBodyAsHtml(bodyContent.body)) ||
    formatMessageTextBodyAsHtml(bodyContent.body);
  return formattedBody
    ? { ...bodyContent, format: 'org.matrix.custom.html', formatted_body: formattedBody }
    : bodyContent;
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
  const formattedBody = formatMarkdownTextBodyAsHtml(trimReplyFromBody(previewContent.body));
  return formattedBody
    ? {
        ...source,
        previewContent: {
          ...previewContent,
          format: 'org.matrix.custom.html',
          formatted_body: formattedBody,
        },
      }
    : source;
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

/** Renders RunErrorCard outside MessageTextBody so it never inherits P400/P300 opacity dimming. */
const renderRunErrorCard = (
  options: RenderAgentMessageContentOptions,
  bodyContent: Record<string, unknown>
): ReactNode => {
  if (
    !options.fromMindroomAgent ||
    options.disableRunErrorUi ||
    options.highlightRegex !== undefined
  ) {
    return null;
  }
  const aiRun = getAiRunInfo(bodyContent) ?? getAiRunInfo(options.content);
  if (!aiRun?.error) return null;
  return (
    <RunErrorCard
      error={aiRun.error}
      aiRun={aiRun}
      mEvent={options.mEvent}
      roomId={options.roomId ?? options.mEvent?.getRoomId()}
      threadId={options.threadId}
      readOnly={options.readOnly}
      linkifyOpts={options.linkifyOpts}
    />
  );
};

type AgentRenderBodyProps = {
  options: RenderAgentMessageContentOptions;
  body: string;
  parsedDom?: readonly ChildNode[];
  markerContent: Record<string, unknown>;
  metadataStatus?: ToolMetadataStatus;
  hasSlots: boolean;
  renderQuestionCard?: (showText: boolean) => JSX.Element;
};

/** A body with MindRoom's markers and reply slots, parsed again only when that message changes. */
function AgentRenderBody({
  options,
  body,
  parsedDom,
  markerContent,
  metadataStatus,
  hasSlots,
  renderQuestionCard,
}: AgentRenderBodyProps) {
  const { mEvent, fromMindroomAgent = false, htmlReactParserOptions } = options;
  const rawInlineMedia = markerContent[INLINE_MEDIA_CONTENT_KEY];
  const inlineMedia = useMemo(() => {
    const entries = readInlineMedia(rawInlineMedia);
    return entries ? { entries, owner: getEventAttachmentOwner(mEvent) } : undefined;
  }, [rawInlineMedia, mEvent]);
  const toolOptions = useToolTraceMarkerParserOptions(
    htmlReactParserOptions,
    markerContent,
    metadataStatus,
    fromMindroomAgent || !mEvent
  );
  const parserOptions = useMemo<HtmlReactParserOptionsSource>(() => {
    if (!hasSlots) return toolOptions;
    return () => {
      const resolved = resolveHtmlReactParserOptions(toolOptions);
      return {
        ...resolved,
        replace: (domNode, index) => {
          const slot = getReplySlot(domNode);
          if (slot) {
            return slot.kind === 'restartSeam' ? (
              <RestartSeam count={slot.count} />
            ) : (
              (renderQuestionCard?.(true) ?? null)
            );
          }
          return resolved.replace?.(domNode, index);
        },
      };
    };
  }, [hasSlots, toolOptions, renderQuestionCard]);

  return (
    <RenderBody
      body={body}
      parsedDom={parsedDom}
      highlightRegex={options.highlightRegex}
      linkifyOpts={options.linkifyOpts}
      inlineMedia={inlineMedia}
      htmlReactParserOptions={parserOptions}
    />
  );
}

type AgentReplyBodyProps = {
  options: RenderAgentMessageContentOptions;
  bodyContent: Record<string, unknown>;
  plainBody?: string;
  customBody?: string;
  thinkingPlaceholder?: ReactNode;
  metadataStatus?: ToolMetadataStatus;
  canFold?: boolean;
  allowFallback?: boolean;
  allowRunError?: boolean;
};

/**
 * Single-sanitize, single-parse agent reply body with 2-layer memoization and a fixed 2-slot
 * FootnoteScopeProvider so thinking, tool disclosures, and late questions keep tree identity.
 */
function AgentReplyBody({
  options,
  bodyContent,
  plainBody,
  customBody,
  thinkingPlaceholder,
  metadataStatus,
  canFold = true,
  allowFallback = true,
  allowRunError = true,
}: AgentReplyBodyProps) {
  const {
    mEvent,
    fromMindroomAgent = false,
    content: outerContent,
    htmlReactParserOptions,
  } = options;
  const renderableContent =
    customBody === undefined && allowFallback && plainBody !== undefined
      ? withToolRefFormattedBodyFallback({ ...bodyContent, body: plainBody }, fromMindroomAgent)
      : bodyContent;
  const html =
    customBody ??
    (allowFallback && typeof renderableContent.formatted_body === 'string'
      ? renderableContent.formatted_body
      : undefined);

  const waiting = useSecretRequestWaiting(useContext(ToolCallMessageContext)?.eventId);
  const sanitizeOptions = useBodySanitizeOptions();
  const { htmlparser2 } = htmlReactParserOptions;

  // Layer 1: sanitize and parse the reply HTML ONCE.
  const canonicalDom = useMemo(
    () =>
      html
        ? parseRenderedHtml(sanitizeCustomHtml(html, sanitizeOptions), { htmlparser2 })
        : undefined,
    [html, sanitizeOptions, htmlparser2]
  );

  const foldEventId = options.eventId ?? mEvent?.getId();
  const foldsWork = fromMindroomAgent && options.highlightRegex === undefined;
  const finalEditTs = mEvent?.replacingEvent()?.getTs();
  const workDurationMs =
    finalEditTs === undefined || mEvent === undefined ? undefined : finalEditTs - mEvent.getTs();
  const shouldFold =
    foldsWork &&
    foldEventId !== undefined &&
    isFinishedAgentReply(outerContent) &&
    canFold &&
    !waiting &&
    !thinkingPlaceholder;

  const runErrorEnabled =
    fromMindroomAgent &&
    !options.disableRunErrorUi &&
    options.highlightRegex === undefined &&
    allowRunError;
  const runError = useStableJson(
    runErrorEnabled
      ? (getAiRunInfo(renderableContent) ?? getAiRunInfo(outerContent))?.error
      : undefined
  );
  const question = useStableJson(
    fromMindroomAgent && mEvent
      ? readInteractiveQuestion(outerContent, mEvent.getOriginalContent())
      : undefined
  );
  const renderQuestionCard = useMemo(
    () =>
      question && mEvent
        ? (showText: boolean) => (
            <QuestionCard
              question={question}
              mEvent={mEvent}
              roomId={options.roomId ?? mEvent.getRoomId()}
              threadId={options.threadId}
              readOnly={options.readOnly}
              showText={showText}
            />
          )
        : undefined,
    [question, mEvent, options.roomId, options.threadId, options.readOnly]
  );

  // Layer 2: DOM-native structural transforms on the cached canonical DOM.
  const plan = useMemo(
    () =>
      canonicalDom
        ? prepareAgentReplyDom({
            canonicalDom,
            runErrorEnabled,
            runError,
            question,
            shouldFold,
            baseOpts: htmlReactParserOptions,
          })
        : undefined,
    [canonicalDom, runErrorEnabled, runError, question, shouldFold, htmlReactParserOptions]
  );

  const plainStripped =
    canonicalDom === undefined && runErrorEnabled && runError && plainBody !== undefined
      ? stripTrailingRunErrorText(plainBody, runError)
      : undefined;
  const bodyEmpty = plan
    ? plan.bodyEmpty
    : Boolean(plainStripped?.stripped && plainStripped.body === '');
  const reasoningContent = fromMindroomAgent
    ? renderableContent
    : withoutCompactions(renderableContent);

  const renderDom = (nodes: readonly ChildNode[] | undefined): ReactNode => {
    if (thinkingPlaceholder !== undefined) return thinkingPlaceholder;
    if (bodyEmpty) return null;
    return (
      <AgentRenderBody
        options={options}
        body={plainStripped?.body ?? plainBody ?? ''}
        parsedDom={nodes}
        markerContent={renderableContent}
        metadataStatus={metadataStatus}
        hasSlots={plan?.hasSlots ?? false}
        renderQuestionCard={plan?.questionPlaced ? renderQuestionCard : undefined}
      />
    );
  };

  const wrapReasoning = (body: ReactNode) => (
    <ReplyReasoning
      content={reasoningContent}
      html={bodyEmpty ? undefined : html}
      parsedDom={bodyEmpty ? undefined : plan?.nodes}
      toolCallIndexes={plan?.toolCallIndexes}
      htmlReactParserOptions={htmlReactParserOptions}
    >
      {body}
    </ReplyReasoning>
  );

  const main =
    foldsWork && foldEventId !== undefined ? (
      <FinishedWorkFold
        foldKey={`finished-work:${foldEventId}`}
        durationMs={workDurationMs}
        whole={wrapReasoning(renderDom(plan?.nodes))}
        folded={
          plan?.split && {
            work: wrapReasoning(renderDom(plan.split.work)),
            answer: renderDom(plan.split.answer),
          }
        }
      />
    ) : (
      wrapReasoning(renderDom(plan?.nodes))
    );

  return (
    <FootnoteScopeProvider>
      {main}
      {!plan?.questionPlaced && renderQuestionCard ? renderQuestionCard(false) : null}
    </FootnoteScopeProvider>
  );
}

type AgentTextKind = 'text' | 'emote' | 'notice';

type AgentTextMessageProps = {
  options: RenderAgentMessageContentOptions;
  kind: AgentTextKind;
  isFileMessage: boolean;
  isThinkingPlaceholder: boolean;
  renderableContent: Record<string, unknown>;
  longTextSource?: LongTextSource;
  isStreaming: boolean;
};

/**
 * Unified text/notice/emote/long-text message component. Keeps one tree identity across
 * ThinkingPlaceholder -> streamed m.notice -> m.text -> m.file sidecar -> live m.text -> final
 * sidecar via `useResolvedMessageContent`.
 */
function AgentTextMessage({
  options,
  kind,
  isFileMessage,
  isThinkingPlaceholder,
  renderableContent,
  longTextSource,
  isStreaming,
}: AgentTextMessageProps) {
  const { mEvent, fromMindroomAgent = false, content: outerContent } = options;
  const { t } = useTranslation();
  const resolved = useResolvedMessageContent({
    outerContent,
    content: renderableContent,
    longTextSource,
    fromMindroomAgent,
    hydrate: options.hydrateLongText ?? true,
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
          delivered={!options.pendingSend && !options.failedSend}
          renderStateSuffix={getMessageStateSuffixRenderer(options)}
        />
      );
    }
  }

  if (!options.highlightRegex && fromMindroomAgent && kind !== 'emote') {
    const triggerWake = readTriggerWake(resolved.content);
    if (triggerWake) {
      return (
        <TriggerWakeMarker
          wake={triggerWake}
          ts={options.ts ?? mEvent?.getTs()}
          roomId={options.roomId ?? mEvent?.getRoomId()}
        />
      );
    }
    const todoPoke = readTodoPoke(resolved.content);
    if (todoPoke) {
      return (
        <TodoPokeMarker
          poke={todoPoke}
          ts={options.ts ?? mEvent?.getTs()}
          senderDisplayName={options.displayName}
        />
      );
    }
  }

  const textProps = {
    edited: isThinkingPlaceholder ? undefined : options.edited,
    renderStateSuffix: getMessageStateSuffixRenderer({
      ...options,
      renderStateSuffix:
        isStreaming && !isThinkingPlaceholder ? renderStreamingIndicator : undefined,
    }),
    content: resolved.content,
    renderBody: isThinkingPlaceholder
      ? () => (
          // In the reply's own tree, so its reasoning stays as the first text replaces this.
          <AgentReplyBody
            options={options}
            bodyContent={resolved.content}
            thinkingPlaceholder={<ThinkingPlaceholder startedAt={mEvent?.getTs()} />}
            canFold={false}
            allowFallback={false}
          />
        )
      : (props: { body: string; customBody?: string }) => (
          <AgentReplyBody
            options={options}
            bodyContent={resolved.content}
            plainBody={props.body}
            customBody={props.customBody}
            canFold={resolved.canFold}
            metadataStatus={resolved.toolMetadataStatus}
            allowFallback={!longTextSource}
          />
        ),
    renderAfterBody: renderRunErrorCard(options, resolved.content),
    renderUrlsPreview:
      isThinkingPlaceholder || resolved.toolMetadataStatus === 'loading'
        ? undefined
        : options.renderUrlsPreview,
  };

  const textElement = (
    <>
      {kind === 'emote' ? (
        <MEmote displayName={options.displayName} {...textProps} />
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
  return callTranscript ? (
    <CallTranscriptCard
      transcript={callTranscript}
      sender={mEvent?.getSender()}
      roomId={options.roomId ?? mEvent?.getRoomId()}
      fallback={textElement}
      highlightRegex={options.highlightRegex}
      linkifyOpts={options.linkifyOpts}
    />
  ) : (
    textElement
  );
}

export const renderAgentMessageContent = (
  options: RenderAgentMessageContentOptions
): ReactNode | undefined => {
  const { mEvent, fromMindroomAgent = false, content, msgType } = options;
  const getMessageStateSuffix = () => getMessageStateSuffixRenderer(options);

  const isTextMessage = matchesEnum(msgType, MsgType.Text);
  const isFileMessage = matchesEnum(msgType, MsgType.File);
  const canvasReceipt = isTextMessage ? readCanvasResponse(content) : undefined;
  if (canvasReceipt) {
    return (
      <CanvasResponseReceipt
        receipt={canvasReceipt}
        delivered={!options.pendingSend && !options.failedSend}
        renderStateSuffix={getMessageStateSuffix()}
      />
    );
  }

  const threadSummaryInfo = getThreadSummaryInfo(content);
  if (threadSummaryInfo) {
    return (
      <ThreadSummaryCard
        edited={options.edited}
        summaryInfo={threadSummaryInfo}
        renderBody={(props) => (
          <AgentReplyBody
            options={options}
            bodyContent={content}
            plainBody={props.body}
            customBody={props.customBody}
            allowRunError={false}
          />
        )}
      />
    );
  }

  const notice =
    fromMindroomAgent && !options.highlightRegex
      ? readAgentNoticeMarker(
          content,
          options.ts ?? mEvent?.getTs(),
          options.roomId ?? mEvent?.getRoomId(),
          options.displayName
        )
      : null;
  if (notice) return notice;

  const workflowRoomId = options.roomId ?? mEvent?.getRoomId();
  if (fromMindroomAgent && workflowRoomId) {
    const common = {
      roomId: workflowRoomId,
      threadId: options.threadId ?? mEvent?.threadRootId ?? null,
      eventId: options.eventId ?? mEvent?.getId(),
      readOnly: options.readOnly,
    };
    const runCard = parseWorkflowRunCard(content);
    if (runCard) {
      return (
        <WorkflowRunCard
          card={runCard}
          sender={mEvent?.getSender()}
          updatedAt={mEvent?.replacingEvent()?.getTs() ?? mEvent?.getTs()}
          {...common}
        />
      );
    }
    const workflowQuestion = parseWorkflowRunQuestion(content);
    if (workflowQuestion) return <WorkflowQuestionCard question={workflowQuestion} {...common} />;
  }

  const secretRequest = fromMindroomAgent ? parseSecretRequestContent(content) : null;
  const secretRequestRoomId = options.roomId ?? mEvent?.getRoomId();
  const secretRequestSender = mEvent?.getSender();
  if (secretRequest && secretRequestRoomId && secretRequestSender) {
    return (
      <SecretRequestCard
        request={secretRequest}
        roomId={secretRequestRoomId}
        agentUserId={secretRequestSender}
        eventId={options.eventId ?? mEvent?.getId()}
        readOnly={options.readOnly}
      />
    );
  }

  if (options.eventType === MINDROOM_TOOL_APPROVAL_EVENT) {
    const approval = fromMindroomAgent
      ? parseToolApprovalContent(options.eventType, content)
      : null;
    return approval ? (
      <ToolApprovalCard
        approval={approval}
        roomId={options.roomId}
        eventId={options.eventId}
        threadId={options.threadId}
        readOnly={options.readOnly}
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
    const editableUiAction =
      !!uiAction &&
      typeof uiAction === 'object' &&
      (uiAction as Record<string, unknown>).action === 'show_canvas';
    if (mEvent && uiAction && (!options.edited || editableUiAction)) {
      const canvasTitle = fromMindroomAgent ? readCanvasNoticeTitle(content) : undefined;
      const uiActionButton = !options.readOnly && <ChatUiActionButton event={mEvent} />;
      const runErrorCard = renderRunErrorCard(options, content);
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
              : (props) => (
                  <AgentReplyBody
                    options={options}
                    bodyContent={content}
                    plainBody={props.body}
                    customBody={props.customBody}
                  />
                )
          }
          renderAfterBody={
            uiActionButton && runErrorCard ? (
              <>
                {uiActionButton}
                {runErrorCard}
              </>
            ) : (
              uiActionButton || runErrorCard
            )
          }
        />
      );
      return canvasTitle ? (
        <InlineCanvasFrame event={mEvent} readOnly={options.readOnly} fallback={noticeElement} />
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
    return pasteAttachment ? (
      <PasteAttachmentContent
        owner={getEventAttachmentOwner(mEvent)}
        attachment={pasteAttachment}
      />
    ) : undefined;
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
    />
  );
};
