import React from 'react';
import { MsgType, type MatrixEvent } from 'matrix-js-sdk';
import { HTMLReactParserOptions } from 'html-react-parser';
import { Opts } from 'linkifyjs';
import { config } from 'folds';
import { getEventAttachmentOwner } from '../mindroom/messages/eventAttachments';
import {
  DownloadFile,
  FileContent,
  ImageContent,
  MAudio,
  MBadEncrypted,
  MFile,
  MImage,
  MLocation,
  MText,
  MVideo,
  ReadPdfFile,
  ReadTextFile,
  RenderBody,
  ThumbnailContent,
  UnsupportedContent,
  VideoContent,
} from './message';
import { UrlPreviewCard, UrlPreviewHolder } from './url-preview';
import { Image, Video } from './media';
import { ImageViewer } from './image-viewer';
import { PdfViewer } from './Pdf-viewer';
import { TextViewer } from './text-viewer';
import { testMatrixTo } from '../plugins/matrix-to';
import { IImageContent } from '../../types/matrix/common';
import { renderMindroomMessageContent } from '../mindroom/messages/renderMindroomMessageContent';
import { getMindroomMessageStateSuffixRenderer } from '../mindroom/messages/messageStateSuffix';
import { hasMindroomAgentMessageMetadata } from '../mindroom/matrix/agentIdentity';
import { isMindroomVisibleRouterVoiceEcho } from '../mindroom/messages/transcribingPlaceholder';

type RenderMessageContentProps = {
  mEvent?: MatrixEvent;
  displayName: string;
  eventType?: string;
  roomId?: string;
  eventId?: string;
  threadId?: string;
  msgType: string;
  ts: number;
  edited?: boolean;
  getContent: <T>() => T;
  mediaAutoLoad?: boolean;
  urlPreview?: boolean;
  showMessageExtras?: boolean;
  highlightRegex?: RegExp;
  htmlReactParserOptions: HTMLReactParserOptions;
  linkifyOpts: Opts;
  outlineAttachment?: boolean;
  hydrateLongText?: boolean;
  pendingSend?: boolean;
  failedSend?: boolean;
};
export function RenderMessageContent({
  mEvent,
  displayName,
  eventType,
  roomId,
  eventId,
  threadId,
  msgType,
  ts,
  edited: messageEdited,
  getContent,
  mediaAutoLoad,
  urlPreview,
  showMessageExtras = false,
  highlightRegex,
  htmlReactParserOptions,
  linkifyOpts,
  outlineAttachment,
  hydrateLongText = true,
  pendingSend,
  failedSend,
}: RenderMessageContentProps) {
  const content = getContent<Record<string, unknown>>();
  // MatrixEvent mutates in place when a replacement changes its content.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const owner = React.useMemo(() => getEventAttachmentOwner(mEvent), [mEvent, content]);
  // Agent streaming and router transcription use edits to finish their messages.
  const edited =
    messageEdited &&
    !hasMindroomAgentMessageMetadata(content) &&
    !isMindroomVisibleRouterVoiceEcho(content);

  const renderUrlsPreview = (urls: string[]) => {
    const filteredUrls = urls.filter((url) => !testMatrixTo(url));
    if (filteredUrls.length === 0) return undefined;
    return (
      <UrlPreviewHolder>
        {filteredUrls.map((url) => (
          <UrlPreviewCard key={url} url={url} ts={ts} />
        ))}
      </UrlPreviewHolder>
    );
  };

  const renderCaption = () => {
    const content: IImageContent = getContent();
    if (content.filename && content.filename !== content.body) {
      return (
        <MText
          style={{ marginTop: config.space.S200 }}
          edited={edited}
          renderStateSuffix={getMindroomMessageStateSuffixRenderer({
            edited,
            pendingSend,
            failedSend,
          })}
          content={content}
          renderBody={(props) => (
            <RenderBody
              {...props}
              highlightRegex={highlightRegex}
              htmlReactParserOptions={htmlReactParserOptions}
              linkifyOpts={linkifyOpts}
            />
          )}
          renderUrlsPreview={urlPreview ? renderUrlsPreview : undefined}
        />
      );
    }
    return null;
  };

  const renderFile = () => (
    <>
      <MFile
        content={getContent()}
        renderFileContent={({ body, mimeType, info, encInfo, url }) => (
          <FileContent
            body={body}
            mimeType={mimeType}
            renderAsPdfFile={() => (
              <ReadPdfFile
                owner={owner}
                body={body}
                mimeType={mimeType}
                url={url}
                encInfo={encInfo}
                renderViewer={(p) => <PdfViewer {...p} />}
              />
            )}
            renderAsTextFile={() => (
              <ReadTextFile
                owner={owner}
                body={body}
                mimeType={mimeType}
                url={url}
                encInfo={encInfo}
                renderViewer={(p) => <TextViewer {...p} />}
              />
            )}
          >
            <DownloadFile
              owner={owner}
              body={body}
              mimeType={mimeType}
              url={url}
              encInfo={encInfo}
              info={info}
            />
          </FileContent>
        )}
        outlined={outlineAttachment}
      />
      {renderCaption()}
    </>
  );

  const mindroomContent = renderMindroomMessageContent({
    mEvent,
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
    renderUrlsPreview: urlPreview ? renderUrlsPreview : undefined,
    highlightRegex,
    htmlReactParserOptions,
    linkifyOpts,
    showMessageExtras,
    hydrateLongText,
  });
  if (mindroomContent !== undefined) return mindroomContent;

  if (msgType === MsgType.Image) {
    return (
      <>
        <MImage
          content={getContent()}
          renderImageContent={(props) => (
            <ImageContent
              owner={owner}
              {...props}
              autoPlay={mediaAutoLoad}
              renderImage={(p) => <Image {...p} loading="lazy" />}
              renderViewer={(p) => <ImageViewer {...p} />}
            />
          )}
          outlined={outlineAttachment}
        />
        {renderCaption()}
      </>
    );
  }

  if (msgType === MsgType.Video) {
    return (
      <>
        <MVideo
          owner={owner}
          content={getContent()}
          renderAsFile={renderFile}
          renderVideoContent={({ body, info, ...props }) => (
            <VideoContent
              owner={owner}
              body={body}
              info={info}
              {...props}
              renderThumbnail={
                mediaAutoLoad
                  ? () => (
                      <ThumbnailContent
                        owner={owner}
                        info={info}
                        renderImage={(src) => (
                          <Image alt={body} title={body} src={src} loading="lazy" />
                        )}
                      />
                    )
                  : undefined
              }
              renderVideo={(p) => <Video {...p} />}
            />
          )}
          outlined={outlineAttachment}
        />
        {renderCaption()}
      </>
    );
  }

  if (msgType === MsgType.Audio) {
    return (
      <>
        <MAudio
          owner={owner}
          content={getContent()}
          renderAsFile={renderFile}
          outlined={outlineAttachment}
        />
        {renderCaption()}
      </>
    );
  }

  if (msgType === MsgType.File) {
    return renderFile();
  }

  if (msgType === MsgType.Location) {
    return <MLocation content={getContent()} />;
  }

  if (msgType === 'm.bad.encrypted') {
    return <MBadEncrypted />;
  }

  return <UnsupportedContent />;
}
