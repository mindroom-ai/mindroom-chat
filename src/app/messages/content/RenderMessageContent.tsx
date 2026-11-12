import { ReactElement, ReactNode, useMemo } from 'react';
import { MatrixEvent, MsgType } from 'matrix-js-sdk';
import type { HTMLReactParserOptions } from 'html-react-parser';
import type { Opts as LinkifyOpts } from 'linkifyjs';
import { Box } from 'folds';
import { ErrorBoundary } from 'react-error-boundary';
import {
  MAudio,
  MBadEncrypted,
  MNotDecrypted,
  MFile,
  MImage,
  MLocation,
  MSticker,
  MText,
  MVideo,
  UnsupportedContent,
} from './MsgTypeRenderers';
import { RenderBody } from './RenderBody';
import { FileDownloadButton } from './FileHeader';
import { FileContent, ReadPdfFile, ReadTextFile } from './FileContent';
import { ImageContent } from './ImageContent';
import { ThumbnailContent } from './ThumbnailContent';
import { VideoContent } from './VideoContent';
import type { RenderImageContentArgs } from './MsgTypeRenderers';
import { UrlPreviewCard, UrlPreviewHolder } from '../url-preview/UrlPreviewCard';
import { Image, Video } from '../../ui/media/Media';
import { ImageViewer } from '../viewers/ImageViewer';
import { PdfViewer } from '../viewers/PdfViewer';
import { TextViewer } from '../viewers/TextViewer';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { renderAgentMessageContent } from './renderAgentMessageContent';
import { getMessageStateSuffixRenderer } from './messageStateSuffix';
import { getEventAttachmentOwner } from '../../matrix/protocol/eventAttachments';
import { isVisibleRouterVoiceEcho } from '../../matrix/protocol/transcribingPlaceholder';
import {
  hasMindroomAgentMessageMetadata,
  isMindroomAgentUserIdForViewer,
} from '../../matrix/protocol/agentIdentity';
import { MessageEvent } from '../../matrix/types/room';
import { MEDIA_SPOILER_PROPERTY } from '../../matrix/send/msgContent';
import { ToolCallMessageContext } from '../agent-run/toolCallStatus';
import { ToolCallsFold } from '../agent-run/ToolCallsFold';
import { readCallTranscript } from '../../matrix/protocol/callTranscript';
import { readCallRow } from '../../matrix/protocol/callRow';
import { LazyCallRow } from '../../calls/transcription/LazyCallRow';
import { CallTranscriptCard } from './CallTranscriptCard';
import {
  useMessageRenderer,
  type MatchedRenderer,
  type PluginEvent,
} from '../../plugins/messageRenderers';
import { pluginFailure } from '../../plugins/pluginFailure';
import { reportBoundaryError } from '../../bug-reports/error-reporting/errorReporting';
import { revealDirectionControls } from '../../ui/directional';

const MSG_TYPES: ReadonlySet<string> = new Set(Object.values(MsgType));

/** Whether `value`, an event's `msgtype`, is one the SDK names. */
const isMsgType = (value: string): value is MsgType => MSG_TYPES.has(value);

/** How text bodies are parsed and decorated. */
type BodyOptions = {
  urlPreview?: boolean;
  highlightRegex?: RegExp;
  hydrateLongText?: boolean;
  htmlReactParserOptions: HTMLReactParserOptions;
  linkifyOpts: LinkifyOpts;
};

type RenderMessageContentProps = BodyOptions & {
  mEvent?: MatrixEvent;
  eventId?: string;
  displayName: string;
  msgType: string;
  eventType?: string;
  roomId?: string;
  threadId?: string;
  getContent: <T>() => T;
  /** Sent time, which link previews are requested for. */
  ts: number;
  edited?: boolean;
  pendingSend?: boolean;
  failedSend?: boolean;
  /** Load images and videos without a click. */
  mediaAutoLoad?: boolean;
  /** Draw a hairline around attachments that sit on a surface of their own color. */
  outlineAttachment?: boolean;
  showMessageExtras?: boolean;
};

type Content = Record<string, unknown>;

/** One preview card per link, keyed by URL; a card asks for its preview as of the sent time. */
function UrlPreviewList({ urls, sentAt }: { urls: string[]; sentAt: number }) {
  const cards = urls.map((url) => <UrlPreviewCard key={url} url={url} ts={sentAt} />);
  return <UrlPreviewHolder>{cards}</UrlPreviewHolder>;
}

/** Since Matrix 1.10 a media event with a `filename` and a different `body` has a caption. */
const getCaption = (content: Content): string | undefined => {
  const { body, filename } = content;
  return typeof body === 'string' &&
    body.length > 0 &&
    typeof filename === 'string' &&
    filename.length > 0 &&
    body !== filename
    ? body
    : undefined;
};

/**
 * The app's own rendering of one timeline event's body. MindRoom's renderer goes first (agent
 * replies, tool calls, approvals, summaries, long text); standard Matrix message types follow.
 */
function CoreMessageContent({
  mEvent,
  eventId,
  roomId,
  threadId,
  eventType,
  msgType,
  displayName,
  ts,
  edited,
  getContent,
  mediaAutoLoad,
  urlPreview,
  outlineAttachment,
  highlightRegex,
  htmlReactParserOptions,
  linkifyOpts,
  showMessageExtras,
  pendingSend,
  failedSend,
  hydrateLongText,
}: RenderMessageContentProps) {
  const client = useMatrixClient();
  const content = getContent<Content>();
  const fromMindroomAgent = isMindroomAgentUserIdForViewer(
    mEvent?.getSender(),
    client.getUserId() ?? undefined
  );
  // Agents stream by editing; their replies are not "edited" in the human sense.
  const agentManaged =
    fromMindroomAgent &&
    (hasMindroomAgentMessageMetadata(content) || isVisibleRouterVoiceEcho(content));
  const showEdited = !!edited && !agentManaged;
  // A voice call's transcript from an agent shows as a call card; malformed, it renders as its HTML.
  const callTranscript = useMemo(
    () => (fromMindroomAgent ? readCallTranscript(content) : undefined),
    [content, fromMindroomAgent]
  );

  // A reply shown outside its thread's view (Classic lists them in the order sent) still follows
  // its thread's choice of showing tool calls.
  const toolThreadId = threadId ?? mEvent?.threadRootId;
  const toolCallMessage = useMemo(
    () => ({ eventId, roomId, threadId: toolThreadId }),
    [eventId, roomId, toolThreadId]
  );

  // A call between people starts with the router's row, shown as its latest edit has it: who is
  // in the call, Join and Transcript while live; how long it lasted once over.
  const callRow = fromMindroomAgent ? readCallRow(content) : undefined;
  if (callRow && mEvent) return <LazyCallRow mEvent={mEvent} row={callRow} body={content.body} />;

  const renderUrlsPreview = urlPreview
    ? (urls: string[]) => <UrlPreviewList urls={urls} sentAt={ts} />
    : undefined;

  const agentContent = renderAgentMessageContent({
    mEvent,
    fromMindroomAgent,
    displayName,
    eventType,
    roomId,
    eventId,
    threadId,
    msgType,
    edited: showEdited,
    content,
    pendingSend,
    failedSend,
    highlightRegex,
    htmlReactParserOptions,
    linkifyOpts,
    renderUrlsPreview,
    showMessageExtras,
    hydrateLongText,
  });
  // An agent reply's tool rows find the approval cards MindRoom posted for its calls by its ID.
  const agentMessage = agentContent !== undefined && (
    <ToolCallMessageContext.Provider value={toolCallMessage}>
      <ToolCallsFold>{agentContent}</ToolCallsFold>
    </ToolCallMessageContext.Provider>
  );
  if (callTranscript && agentMessage) {
    return (
      <CallTranscriptCard
        transcript={callTranscript}
        sender={mEvent?.getSender()}
        roomId={roomId ?? mEvent?.getRoomId()}
        fallback={agentMessage}
        highlightRegex={highlightRegex}
        linkifyOpts={linkifyOpts}
      />
    );
  }
  if (agentMessage) return agentMessage;

  const owner = getEventAttachmentOwner(mEvent);
  const renderStateSuffix = getMessageStateSuffixRenderer({
    edited: showEdited,
    pendingSend,
    failedSend,
  });

  const renderBody = ({ body, customBody }: { body: string; customBody?: string }) => (
    <RenderBody
      body={body}
      customBody={customBody}
      highlightRegex={highlightRegex}
      linkifyOpts={linkifyOpts}
      htmlReactParserOptions={htmlReactParserOptions}
    />
  );

  const renderCaption = () => {
    const caption = getCaption(content);
    if (!caption) return null;
    return (
      <MText
        edited={showEdited}
        content={{ ...content, msgtype: MsgType.Text, body: caption }}
        renderBody={renderBody}
        renderStateSuffix={renderStateSuffix}
        renderUrlsPreview={renderUrlsPreview}
      />
    );
  };

  const renderFile = () => (
    <MFile
      content={content}
      outlined={outlineAttachment}
      renderFileContent={(file) => (
        <FileContent
          body={file.body}
          mimeType={file.mimeType}
          renderAsTextFile={() => (
            <ReadTextFile
              owner={owner}
              {...file}
              iconOnly
              renderViewer={(props) => <TextViewer {...props} />}
            />
          )}
          renderAsPdfFile={() => (
            <ReadPdfFile
              owner={owner}
              {...file}
              iconOnly
              renderViewer={(props) => <PdfViewer {...props} />}
            />
          )}
        >
          <FileDownloadButton
            filename={file.body}
            mimeType={file.mimeType}
            url={file.url}
            encInfo={file.encInfo}
            owner={owner}
          />
        </FileContent>
      )}
    />
  );

  const renderImageContent = (image: RenderImageContentArgs) => (
    <ImageContent
      {...image}
      owner={owner}
      autoPlay={mediaAutoLoad}
      markedAsSpoiler={content[MEDIA_SPOILER_PROPERTY] === true}
      renderImage={(props) => <Image {...props} />}
      renderViewer={(props) => <ImageViewer {...props} />}
    />
  );

  const withCaption = (media: ReactNode) => (
    <Box direction="Column" gap="200">
      {media}
      {renderCaption()}
    </Box>
  );

  if (eventType === MessageEvent.Sticker) {
    return <MSticker content={content} renderImageContent={renderImageContent} />;
  }

  switch (isMsgType(msgType) ? msgType : undefined) {
    case MsgType.Image:
      return withCaption(
        <MImage
          content={content}
          outlined={outlineAttachment}
          renderAsFile={renderFile}
          renderImageContent={renderImageContent}
        />
      );
    case MsgType.Video:
      return withCaption(
        <MVideo
          content={content}
          outlined={outlineAttachment}
          renderAsFile={renderFile}
          renderVideoContent={(video) => (
            <VideoContent
              {...video}
              autoPlay={mediaAutoLoad}
              markedAsSpoiler={content[MEDIA_SPOILER_PROPERTY] === true}
              owner={owner}
              renderThumbnail={
                video.info.thumbnail_url || video.info.thumbnail_file
                  ? () => (
                      <ThumbnailContent
                        info={video.info}
                        owner={owner}
                        renderImage={(src) => (
                          <Image src={src} alt={revealDirectionControls(video.body)} />
                        )}
                      />
                    )
                  : undefined
              }
              renderVideo={(props) => <Video {...props} />}
            />
          )}
        />
      );
    case MsgType.Audio:
      return withCaption(
        <MAudio
          content={content}
          owner={owner}
          outlined={outlineAttachment}
          renderAsFile={renderFile}
        />
      );
    case MsgType.File:
      return withCaption(renderFile());
    case MsgType.Location:
      return <MLocation content={content} />;
    default:
      // Matrix 1.x leaves events the client cannot decrypt as `m.bad.encrypted` placeholders; an
      // event still of the encrypted type has not been decrypted yet.
      if (msgType === 'm.bad.encrypted') return <MBadEncrypted />;
      return eventType === 'm.room.encrypted' ? <MNotDecrypted /> : <UnsupportedContent />;
  }
}

/** A client plugin's rendering of a message; if it fails, `fallback` (core's) shows instead. */
function PluginMessageContent({
  tag,
  renderer: { Component },
  event,
  fallback,
}: MatchedRenderer & { event: PluginEvent; fallback: ReactElement }) {
  return (
    <ErrorBoundary
      fallback={fallback}
      // After a failure the plugin tries again once another renderer or other content comes along,
      // as a reply streams in, not each time the timeline draws the same message again.
      resetKeys={[Component, JSON.stringify(event.content)]}
      onError={(thrown: unknown, info) => {
        // eslint-disable-next-line no-console
        console.error(`[plugin ${tag}] failed to render a message; core renders it`, thrown);
        reportBoundaryError(pluginFailure(tag, thrown), info.componentStack);
      }}
    >
      <Component event={event} />
    </ErrorBoundary>
  );
}

/**
 * The body of one timeline event: a client plugin's rendering when one of its message renderers
 * takes the event (src/app/plugins/messageRenderers.ts), else the app's own.
 */
export function RenderMessageContent(props: RenderMessageContentProps) {
  const { mEvent, eventId, roomId, eventType, getContent } = props;
  const viewerId = useMatrixClient().getUserId() ?? undefined;
  const sender = mEvent?.getSender();
  const event: PluginEvent | undefined = sender
    ? {
        eventId: eventId ?? mEvent?.getId(),
        roomId: roomId ?? mEvent?.getRoomId(),
        type: eventType ?? mEvent?.getType(),
        sender,
        content: getContent<Content>(),
      }
    : undefined;
  const plugin = useMessageRenderer(event, viewerId);
  const core = <CoreMessageContent {...props} />;
  return plugin && event ? (
    <PluginMessageContent {...plugin} event={event} fallback={core} />
  ) : (
    core
  );
}
