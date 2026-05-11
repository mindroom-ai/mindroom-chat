import React, { type ReactNode } from 'react';
import { MsgType } from 'matrix-js-sdk';
import { HTMLReactParserOptions } from 'html-react-parser';
import { Opts } from 'linkifyjs';
import { BrokenContent, MEmote, MNotice, MText, RenderBody } from '../../components/message';
import { MindroomMessageExtras } from './MindroomMessageExtras';
import { MINDROOM_MESSAGE_EXTRAS_KEY, parseMindroomMessageExtras } from './messageExtrasData';
import { withMindroomToolTraceMarkerParserOptions } from '../../plugins/react-custom-html-parser';
import { isMindroomAiRunStreaming } from './aiRun';
import { formatMindroomMessageTextBodyAsHtml } from './blocks';
import { getMindroomLongTextSource } from './longText';
import { MindroomLongTextKind, MindroomLongTextText } from './MindroomLongTextText';
import { MindroomPasteAttachmentContent } from './MindroomPasteAttachmentContent';
import { MindroomThreadSummaryCard } from './MindroomThreadSummaryCard';
import { MindroomToolApprovalCard } from './MindroomToolApprovalCard';
import { renderMindroomStreamingIndicator } from './StreamingIndicator';
import { getMindroomPasteAttachmentFile } from './pasteAttachmentMarker';
import { MINDROOM_TOOL_APPROVAL_EVENT, parseToolApprovalContent } from './toolApproval';
import { getMindroomThreadSummaryInfo } from './threadSummary';

export type RenderMindroomMessageContentOptions = {
  displayName: string;
  eventType?: string;
  roomId?: string;
  eventId?: string;
  threadId?: string;
  msgType: string;
  edited?: boolean;
  content: Record<string, unknown>;
  renderUrlsPreview?: (urls: string[]) => ReactNode;
  highlightRegex?: RegExp;
  htmlReactParserOptions: HTMLReactParserOptions;
  linkifyOpts: Opts;
  showMessageExtras?: boolean;
  hydrateLongText?: boolean;
  onLongTextHydratedMessageExtrasRendered?: () => void;
};

type MindroomMessageExtrasRenderNoticeProps = {
  children: React.ReactNode;
  onRendered?: () => void;
};

function MindroomMessageExtrasRenderNotice({
  children,
  onRendered,
}: MindroomMessageExtrasRenderNoticeProps) {
  React.useEffect(() => {
    onRendered?.();
  }, [onRendered]);

  return <>{children}</>;
}

export const renderMindroomMessageContent = ({
  displayName,
  eventType,
  roomId,
  eventId,
  threadId,
  msgType,
  edited,
  content,
  renderUrlsPreview,
  highlightRegex,
  htmlReactParserOptions,
  linkifyOpts,
  showMessageExtras = false,
  hydrateLongText = true,
  onLongTextHydratedMessageExtrasRendered,
}: RenderMindroomMessageContentOptions): ReactNode | undefined => {
  const withToolRefFormattedBodyFallback = (bodyContent: Record<string, unknown>) => {
    if (typeof bodyContent.formatted_body === 'string') return bodyContent;
    if (typeof bodyContent.body !== 'string') return bodyContent;

    const formattedBody = formatMindroomMessageTextBodyAsHtml(bodyContent.body);
    if (!formattedBody) return bodyContent;

    return {
      ...bodyContent,
      format: 'org.matrix.custom.html',
      formatted_body: formattedBody,
    };
  };

  const getMindroomAwareHtmlReactParserOptions = (bodyContent: Record<string, unknown>) =>
    withMindroomToolTraceMarkerParserOptions(htmlReactParserOptions, bodyContent);

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

      return (
        <RenderBody
          {...props}
          customBody={customBody}
          highlightRegex={highlightRegex}
          htmlReactParserOptions={getMindroomAwareHtmlReactParserOptions(renderableContent)}
          linkifyOpts={linkifyOpts}
        />
      );
    };

  const renderMessageExtras = (
    extrasContent: Record<string, unknown>,
    fallbackContents: Record<string, unknown>[] = [],
    onFallbackExtrasRendered?: (fallbackIndex: number) => void
  ) => {
    if (!showMessageExtras) return undefined;

    const getExtrasRenderSource = () => {
      if (MINDROOM_MESSAGE_EXTRAS_KEY in extrasContent) {
        return {
          content: extrasContent,
          extras: parseMindroomMessageExtras(extrasContent),
          fallbackIndex: undefined,
        };
      }

      const fallbackIndex = fallbackContents.findIndex(
        (candidate) => MINDROOM_MESSAGE_EXTRAS_KEY in candidate
      );
      if (fallbackIndex >= 0) {
        const fallbackContent = fallbackContents[fallbackIndex];
        return {
          content: fallbackContent,
          extras: parseMindroomMessageExtras(fallbackContent),
          fallbackIndex,
        };
      }

      return { content: extrasContent, extras: null, fallbackIndex: undefined };
    };

    const { content: parserOptionsContent, extras, fallbackIndex } = getExtrasRenderSource();
    if (!extras) return undefined;

    return (
      <MindroomMessageExtrasRenderNotice
        onRendered={
          fallbackIndex === undefined ? undefined : () => onFallbackExtrasRendered?.(fallbackIndex)
        }
      >
        <MindroomMessageExtras
          extras={extras}
          htmlReactParserOptions={getMindroomAwareHtmlReactParserOptions(parserOptionsContent)}
        />
      </MindroomMessageExtrasRenderNotice>
    );
  };

  const handleLongTextFallbackExtrasRendered = (fallbackIndex: number) => {
    if (fallbackIndex === 1) {
      onLongTextHydratedMessageExtrasRendered?.();
    }
  };

  const threadSummaryInfo = getMindroomThreadSummaryInfo(content);
  if (threadSummaryInfo) {
    return (
      <MindroomThreadSummaryCard
        edited={edited}
        summaryInfo={threadSummaryInfo}
        renderBody={renderBody(content)}
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

  if (msgType === MsgType.Text || msgType === MsgType.File) {
    const isStreaming = isMindroomAiRunStreaming(content);
    const longTextSource = getMindroomLongTextSource(content);
    if (longTextSource) {
      return (
        <MindroomLongTextText
          kind={MindroomLongTextKind.Text}
          edited={edited}
          renderStateSuffix={isStreaming ? renderMindroomStreamingIndicator : undefined}
          content={longTextSource.previewContent}
          longTextSource={longTextSource}
          hydrate={hydrateLongText}
          renderBody={(resolvedContent, props) => (
            <RenderBody
              {...props}
              highlightRegex={highlightRegex}
              htmlReactParserOptions={getMindroomAwareHtmlReactParserOptions(resolvedContent)}
              linkifyOpts={linkifyOpts}
            />
          )}
          renderAfterBody={(extrasContent, fallbackContent) =>
            renderMessageExtras(
              extrasContent,
              [content, fallbackContent],
              handleLongTextFallbackExtrasRendered
            )
          }
          renderUrlsPreview={renderUrlsPreview}
        />
      );
    }

    if (msgType === MsgType.File) {
      const pasteAttachment = getMindroomPasteAttachmentFile(content);
      if (pasteAttachment) {
        return <MindroomPasteAttachmentContent attachment={pasteAttachment} />;
      }
    }

    if (msgType === MsgType.Text) {
      const renderableContent = withToolRefFormattedBodyFallback(content);
      return (
        <MText
          edited={edited}
          renderStateSuffix={isStreaming ? renderMindroomStreamingIndicator : undefined}
          content={renderableContent}
          renderBody={renderBody(renderableContent)}
          renderAfterBody={renderMessageExtras(renderableContent, [content])}
          renderUrlsPreview={renderUrlsPreview}
        />
      );
    }
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
          renderStateSuffix={isStreaming ? renderMindroomStreamingIndicator : undefined}
          content={longTextSource.previewContent}
          longTextSource={longTextSource}
          hydrate={hydrateLongText}
          renderBody={(resolvedContent, props) => (
            <RenderBody
              {...props}
              highlightRegex={highlightRegex}
              htmlReactParserOptions={getMindroomAwareHtmlReactParserOptions(resolvedContent)}
              linkifyOpts={linkifyOpts}
            />
          )}
          renderAfterBody={(extrasContent, fallbackContent) =>
            renderMessageExtras(
              extrasContent,
              [content, fallbackContent],
              handleLongTextFallbackExtrasRendered
            )
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
        renderStateSuffix={isStreaming ? renderMindroomStreamingIndicator : undefined}
        content={renderableContent}
        renderBody={renderBody(renderableContent)}
        renderAfterBody={renderMessageExtras(renderableContent, [content])}
        renderUrlsPreview={renderUrlsPreview}
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
          renderStateSuffix={isStreaming ? renderMindroomStreamingIndicator : undefined}
          content={longTextSource.previewContent}
          longTextSource={longTextSource}
          hydrate={hydrateLongText}
          renderBody={(resolvedContent, props) => (
            <RenderBody
              {...props}
              highlightRegex={highlightRegex}
              htmlReactParserOptions={getMindroomAwareHtmlReactParserOptions(resolvedContent)}
              linkifyOpts={linkifyOpts}
            />
          )}
          renderAfterBody={(extrasContent, fallbackContent) =>
            renderMessageExtras(
              extrasContent,
              [content, fallbackContent],
              handleLongTextFallbackExtrasRendered
            )
          }
          renderUrlsPreview={renderUrlsPreview}
        />
      );
    }

    const renderableContent = withToolRefFormattedBodyFallback(content);
    return (
      <MNotice
        edited={edited}
        renderStateSuffix={isStreaming ? renderMindroomStreamingIndicator : undefined}
        content={renderableContent}
        renderBody={renderBody(renderableContent)}
        renderAfterBody={renderMessageExtras(renderableContent, [content])}
        renderUrlsPreview={renderUrlsPreview}
      />
    );
  }

  return undefined;
};
