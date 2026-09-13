import React from 'react';
import { MsgType } from 'matrix-js-sdk';
import { HTMLReactParserOptions } from 'html-react-parser';
import { Opts } from 'linkifyjs';
import { config } from 'folds';
import {
  AudioContent,
  BrokenContent,
  DownloadFile,
  FileContent,
  ImageContent,
  MAudio,
  MBadEncrypted,
  MEmote,
  MFile,
  MImage,
  MLocation,
  MNotice,
  MindroomThreadSummaryCard,
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
import { Image, MediaControl, Video } from './media';
import { ImageViewer } from './image-viewer';
import { PdfViewer } from './Pdf-viewer';
import { TextViewer } from './text-viewer';
import { testMatrixTo } from '../plugins/matrix-to';
import { IImageContent } from '../../types/matrix/common';
import { getMindroomLongTextSource } from './message/mindroomLongText';
import { MindroomLongTextKind, MindroomLongTextText } from './message/MindroomLongTextText';
import { getMindroomThreadSummaryInfo } from './message/mindroomThreadSummary';
import { MindroomToolApprovalCard } from './message/MindroomToolApprovalCard';
import {
  MINDROOM_TOOL_APPROVAL_EVENT,
  parseToolApprovalContent,
} from './message/mindroomToolApproval';
import { withMindroomToolTraceMarkerParserOptions } from '../plugins/react-custom-html-parser';
import { isMindroomAiRunStreaming } from './message/mindroomAiRun';

type RenderMessageContentProps = {
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
  highlightRegex?: RegExp;
  htmlReactParserOptions: HTMLReactParserOptions;
  linkifyOpts: Opts;
  outlineAttachment?: boolean;
};
export function RenderMessageContent({
  displayName,
  eventType,
  roomId,
  eventId,
  threadId,
  msgType,
  ts,
  edited,
  getContent,
  mediaAutoLoad,
  urlPreview,
  highlightRegex,
  htmlReactParserOptions,
  linkifyOpts,
  outlineAttachment,
}: RenderMessageContentProps) {
  const getMindroomAwareContent = (): Record<string, unknown> => getContent<Record<string, unknown>>();

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

  const getMindroomAwareHtmlReactParserOptions = (content: Record<string, unknown>) =>
    withMindroomToolTraceMarkerParserOptions(htmlReactParserOptions, content);

  const renderCaption = () => {
    const content: IImageContent = getContent();
    if (content.filename && content.filename !== content.body) {
      return (
        <MText
          style={{ marginTop: config.space.S200 }}
          edited={edited}
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
                body={body}
                mimeType={mimeType}
                url={url}
                encInfo={encInfo}
                renderViewer={(p) => <PdfViewer {...p} />}
              />
            )}
            renderAsTextFile={() => (
              <ReadTextFile
                body={body}
                mimeType={mimeType}
                url={url}
                encInfo={encInfo}
                renderViewer={(p) => <TextViewer {...p} />}
              />
            )}
          >
            <DownloadFile body={body} mimeType={mimeType} url={url} encInfo={encInfo} info={info} />
          </FileContent>
        )}
        outlined={outlineAttachment}
      />
      {renderCaption()}
    </>
  );

  const content = getMindroomAwareContent();
  const threadSummaryInfo = getMindroomThreadSummaryInfo(content);
  if (threadSummaryInfo) {
    return (
      <MindroomThreadSummaryCard
        edited={edited}
        summaryInfo={threadSummaryInfo}
        renderBody={(props) => (
          <RenderBody
            {...props}
            highlightRegex={highlightRegex}
            htmlReactParserOptions={getMindroomAwareHtmlReactParserOptions(content)}
            linkifyOpts={linkifyOpts}
          />
        )}
      />
    );
  }

  if (eventType === MINDROOM_TOOL_APPROVAL_EVENT) {
    const approval = parseToolApprovalContent(eventType, content);
    return approval ? (
      <MindroomToolApprovalCard
        approval={approval}
        roomId={roomId}
        eventId={eventId}
        threadId={threadId}
      />
    ) : (
      <BrokenContent />
    );
  }

  if (msgType === MsgType.Text) {
    const isStreaming = isMindroomAiRunStreaming(content);
    const longTextSource = getMindroomLongTextSource(content);
    if (longTextSource) {
      return (
        <MindroomLongTextText
          kind={MindroomLongTextKind.Text}
          edited={edited}
          isStreaming={isStreaming}
          content={longTextSource.previewContent}
          longTextSource={longTextSource}
          renderBody={(resolvedContent, props) => (
            <RenderBody
              {...props}
              highlightRegex={highlightRegex}
              htmlReactParserOptions={getMindroomAwareHtmlReactParserOptions(resolvedContent)}
              linkifyOpts={linkifyOpts}
            />
          )}
          renderUrlsPreview={urlPreview ? renderUrlsPreview : undefined}
        />
      );
    }
    const mindroomHtmlReactParserOptions = getMindroomAwareHtmlReactParserOptions(content);

    return (
      <MText
        edited={edited}
        isStreaming={isStreaming}
        content={content}
        renderBody={(props) => (
          <RenderBody
            {...props}
            highlightRegex={highlightRegex}
            htmlReactParserOptions={mindroomHtmlReactParserOptions}
            linkifyOpts={linkifyOpts}
          />
        )}
        renderUrlsPreview={urlPreview ? renderUrlsPreview : undefined}
      />
    );
  }

  if (msgType === MsgType.Emote) {
    const isStreaming = isMindroomAiRunStreaming(content);
    const longTextSource = getMindroomLongTextSource(content);
    if (longTextSource) {
      return (
        <MindroomLongTextText
          kind={MindroomLongTextKind.Emote}
          displayName={displayName}
          edited={edited}
          isStreaming={isStreaming}
          content={longTextSource.previewContent}
          longTextSource={longTextSource}
          renderBody={(resolvedContent, props) => (
            <RenderBody
              {...props}
              highlightRegex={highlightRegex}
              htmlReactParserOptions={getMindroomAwareHtmlReactParserOptions(resolvedContent)}
              linkifyOpts={linkifyOpts}
            />
          )}
          renderUrlsPreview={urlPreview ? renderUrlsPreview : undefined}
        />
      );
    }
    const mindroomHtmlReactParserOptions = getMindroomAwareHtmlReactParserOptions(content);

    return (
      <MEmote
        displayName={displayName}
        edited={edited}
        isStreaming={isStreaming}
        content={content}
        renderBody={(props) => (
          <RenderBody
            {...props}
            highlightRegex={highlightRegex}
            htmlReactParserOptions={mindroomHtmlReactParserOptions}
            linkifyOpts={linkifyOpts}
          />
        )}
        renderUrlsPreview={urlPreview ? renderUrlsPreview : undefined}
      />
    );
  }

  if (msgType === MsgType.Notice) {
    const isStreaming = isMindroomAiRunStreaming(content);
    const longTextSource = getMindroomLongTextSource(content);
    if (longTextSource) {
      return (
        <MindroomLongTextText
          kind={MindroomLongTextKind.Notice}
          edited={edited}
          isStreaming={isStreaming}
          content={longTextSource.previewContent}
          longTextSource={longTextSource}
          renderBody={(resolvedContent, props) => (
            <RenderBody
              {...props}
              highlightRegex={highlightRegex}
              htmlReactParserOptions={getMindroomAwareHtmlReactParserOptions(resolvedContent)}
              linkifyOpts={linkifyOpts}
            />
          )}
          renderUrlsPreview={urlPreview ? renderUrlsPreview : undefined}
        />
      );
    }
    const mindroomHtmlReactParserOptions = getMindroomAwareHtmlReactParserOptions(content);

    return (
      <MNotice
        edited={edited}
        isStreaming={isStreaming}
        content={content}
        renderBody={(props) => (
          <RenderBody
            {...props}
            highlightRegex={highlightRegex}
            htmlReactParserOptions={mindroomHtmlReactParserOptions}
            linkifyOpts={linkifyOpts}
          />
        )}
        renderUrlsPreview={urlPreview ? renderUrlsPreview : undefined}
      />
    );
  }

  if (msgType === MsgType.Image) {
    return (
      <>
        <MImage
          content={getContent()}
          renderImageContent={(props) => (
            <ImageContent
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
          content={getContent()}
          renderAsFile={renderFile}
          renderVideoContent={({ body, info, ...props }) => (
            <VideoContent
              body={body}
              info={info}
              {...props}
              renderThumbnail={
                mediaAutoLoad
                  ? () => (
                      <ThumbnailContent
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
          content={getContent()}
          renderAsFile={renderFile}
          renderAudioContent={(props) => (
            <AudioContent {...props} renderMediaControl={(p) => <MediaControl {...p} />} />
          )}
          outlined={outlineAttachment}
        />
        {renderCaption()}
      </>
    );
  }

  if (msgType === MsgType.File) {
    const longTextSource = getMindroomLongTextSource(content);
    if (longTextSource) {
      const isStreaming = isMindroomAiRunStreaming(content);
      return (
        <MindroomLongTextText
          kind={MindroomLongTextKind.Text}
          edited={edited}
          isStreaming={isStreaming}
          content={longTextSource.previewContent}
          longTextSource={longTextSource}
          renderBody={(resolvedContent, props) => (
            <RenderBody
              {...props}
              highlightRegex={highlightRegex}
              htmlReactParserOptions={getMindroomAwareHtmlReactParserOptions(resolvedContent)}
              linkifyOpts={linkifyOpts}
            />
          )}
          renderUrlsPreview={urlPreview ? renderUrlsPreview : undefined}
        />
      );
    }
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
