import React, { type ReactNode } from 'react';
import { MsgType } from 'matrix-js-sdk';
import { HTMLReactParserOptions } from 'html-react-parser';
import { Opts } from 'linkifyjs';
import { BrokenContent, MEmote, MNotice, MText, RenderBody } from '../../components/message';
import { withMindroomToolTraceMarkerParserOptions } from '../../plugins/react-custom-html-parser';
import { isMindroomAiRunStreaming } from './aiRun';
import { getMindroomLongTextSource } from './longText';
import { MindroomLongTextKind, MindroomLongTextText } from './MindroomLongTextText';
import { MindroomThreadSummaryCard } from './MindroomThreadSummaryCard';
import { MindroomToolApprovalCard } from './MindroomToolApprovalCard';
import { renderMindroomStreamingIndicator } from './StreamingIndicator';
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
};

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
}: RenderMindroomMessageContentOptions): ReactNode | undefined => {
  const getMindroomAwareHtmlReactParserOptions = (bodyContent: Record<string, unknown>) =>
    withMindroomToolTraceMarkerParserOptions(htmlReactParserOptions, bodyContent);

  const renderBody = (bodyContent: Record<string, unknown>) => (props: {
    body: string;
    customBody?: string;
  }) => (
    <RenderBody
      {...props}
      highlightRegex={highlightRegex}
      htmlReactParserOptions={getMindroomAwareHtmlReactParserOptions(bodyContent)}
      linkifyOpts={linkifyOpts}
    />
  );

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
          renderBody={(resolvedContent, props) => (
            <RenderBody
              {...props}
              highlightRegex={highlightRegex}
              htmlReactParserOptions={getMindroomAwareHtmlReactParserOptions(resolvedContent)}
              linkifyOpts={linkifyOpts}
            />
          )}
          renderUrlsPreview={renderUrlsPreview}
        />
      );
    }

    if (msgType === MsgType.Text) {
      return (
        <MText
          edited={edited}
          renderStateSuffix={isStreaming ? renderMindroomStreamingIndicator : undefined}
          content={content}
          renderBody={renderBody(content)}
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
          renderBody={(resolvedContent, props) => (
            <RenderBody
              {...props}
              highlightRegex={highlightRegex}
              htmlReactParserOptions={getMindroomAwareHtmlReactParserOptions(resolvedContent)}
              linkifyOpts={linkifyOpts}
            />
          )}
          renderUrlsPreview={renderUrlsPreview}
        />
      );
    }

    return (
      <MEmote
        displayName={displayName}
        edited={edited}
        renderStateSuffix={isStreaming ? renderMindroomStreamingIndicator : undefined}
        content={content}
        renderBody={renderBody(content)}
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
          renderBody={(resolvedContent, props) => (
            <RenderBody
              {...props}
              highlightRegex={highlightRegex}
              htmlReactParserOptions={getMindroomAwareHtmlReactParserOptions(resolvedContent)}
              linkifyOpts={linkifyOpts}
            />
          )}
          renderUrlsPreview={renderUrlsPreview}
        />
      );
    }

    return (
      <MNotice
        edited={edited}
        renderStateSuffix={isStreaming ? renderMindroomStreamingIndicator : undefined}
        content={content}
        renderBody={renderBody(content)}
        renderUrlsPreview={renderUrlsPreview}
      />
    );
  }

  return undefined;
};
