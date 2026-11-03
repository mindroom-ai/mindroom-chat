import React, { ReactNode } from 'react';
import { MatrixEvent, MsgType } from 'matrix-js-sdk';
import type { HTMLReactParserOptions } from 'html-react-parser';
import type { Opts as LinkifyOpts } from 'linkifyjs';
import { Box } from 'folds';
import {
  FileContent,
  FileDownloadButton,
  ImageContent,
  MAudio,
  MBadEncrypted,
  MFile,
  MImage,
  MLocation,
  MSticker,
  MText,
  MVideo,
  ReadPdfFile,
  ReadTextFile,
  RenderBody,
  ThumbnailContent,
  UnsupportedContent,
  VideoContent,
} from './message';
import type { RenderImageContentArgs } from './message';
import { UrlPreviewCard, UrlPreviewHolder } from './url-preview';
import { Image, Video } from './media';
import { ImageViewer } from './image-viewer';
import { PdfViewer } from './Pdf-viewer';
import { TextViewer } from './text-viewer';
import { useMatrixClient } from '../hooks/useMatrixClient';
import { renderMindroomMessageContent } from '../mindroom/messages/renderMindroomMessageContent';
import { getMindroomMessageStateSuffixRenderer } from '../mindroom/messages/messageStateSuffix';
import { getEventAttachmentOwner } from '../mindroom/messages/eventAttachments';
import { isMindroomVisibleRouterVoiceEcho } from '../mindroom/messages/transcribingPlaceholder';
import {
  hasMindroomAgentMessageMetadata,
  isMindroomAgentUserIdForViewer,
} from '../mindroom/matrix/agentIdentity';
import { MessageEvent } from '../../types/matrix/room';

type RenderMessageContentProps = {
  mEvent?: MatrixEvent;
  eventId?: string;
  displayName: string;
  msgType: string;
  eventType?: string;
  roomId?: string;













  showMessageExtras?: boolean;
  pendingSend?: boolean;
  failedSend?: boolean;
  hydrateLongText?: boolean;
};

type Content = Record<string, unknown>;

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
 * The body of one timeline event. MindRoom's renderer goes first (agent replies, tool calls,
 * approvals, summaries, long text); standard Matrix message types follow.
 */























  const content = getContent<Content>();
  const fromMindroomAgent = isMindroomAgentUserIdForViewer(
    mEvent?.getSender(),
    mx.getUserId() ?? undefined
  );
  // Agents stream by editing; their replies are not "edited" in the human sense.
  const agentManaged =
    fromMindroomAgent &&
    (hasMindroomAgentMessageMetadata(content) || isMindroomVisibleRouterVoiceEcho(content));
  const showEdited = !!edited && !agentManaged;

  const renderUrlsPreview = urlPreview









  const mindroomContent = renderMindroomMessageContent({
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
  if (mindroomContent !== undefined) return <>{mindroomContent}</>;

  const owner = getEventAttachmentOwner(mEvent);
  const renderStateSuffix = getMindroomMessageStateSuffixRenderer({
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

  switch (msgType) {
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
              owner={owner}
              renderThumbnail={
                video.info.thumbnail_url || video.info.thumbnail_file
                  ? () => (
                      <ThumbnailContent
                        info={video.info}
                        owner={owner}
                        renderImage={(src) => <Image src={src} alt={video.body} />}
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






  }
}
