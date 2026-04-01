import React, { useMemo } from 'react';
import { IEventWithRoomId, MsgType } from 'matrix-js-sdk';
import { Text } from 'folds';
import { MEmote, MNotice, MText, RedactedContent, RenderBody } from '../../components/message';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import {
  getReactCustomHtmlParser,
  LINKIFY_OPTS,
  makeHighlightRegex,
} from '../../plugins/react-custom-html-parser';
import { MessageEvent } from '../../../types/matrix/room';
import {
  getSearchResultEffectiveContent,
  getSearchResultLightweightCustomBody,
  getSearchResultPreviewText,
  isSearchResultEdited,
  shouldUseLightweightSearchResultBody,
} from './searchResultPreview';

type SearchResultBodyProps = {
  roomId: string;
  event: IEventWithRoomId;
  displayName: string;
  highlights: string[];
};

export function SearchResultBody({
  roomId,
  event,
  displayName,
  highlights,
}: SearchResultBodyProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();

  if (event.unsigned?.redacted_because) {
    return <RedactedContent reason={event.unsigned?.redacted_because.content.reason} />;
  }

  const edited = isSearchResultEdited(event);
  const effectiveContent = getSearchResultEffectiveContent(event);
  const useLightweightBody = shouldUseLightweightSearchResultBody(effectiveContent);
  const highlightRegex = useMemo(() => makeHighlightRegex(highlights), [highlights]);
  const htmlReactParserOptions = useMemo(
    () =>
      getReactCustomHtmlParser(mx, roomId, {
        linkifyOpts: LINKIFY_OPTS,
        highlightRegex,
        useAuthentication,
      }),
    [highlightRegex, mx, roomId, useAuthentication]
  );
  const needsPreviewText = useLightweightBody || !highlightRegex;
  const previewText = useMemo(
    () => (needsPreviewText ? getSearchResultPreviewText(event, highlights) : undefined),
    [event, highlights, needsPreviewText]
  );
  const content = useMemo(() => {
    if (!useLightweightBody) return effectiveContent;

    const nextPreviewText = previewText ?? getSearchResultPreviewText(event, highlights);
    return {
      ...effectiveContent,
      body: nextPreviewText,
      formatted_body: getSearchResultLightweightCustomBody(effectiveContent, nextPreviewText),
    };
  }, [effectiveContent, event, highlights, previewText, useLightweightBody]);

  const renderSnippetBody = () => {
    if (!previewText) return null;

    return (
      <RenderBody
        body={previewText}
        highlightRegex={highlightRegex}
        htmlReactParserOptions={htmlReactParserOptions}
        linkifyOpts={LINKIFY_OPTS}
      />
    );
  };

  if (useLightweightBody) {
    if (event.type === MessageEvent.RoomMessage) {
      const renderBody = (props: { body: string; customBody?: string }) => (
        <RenderBody
          {...props}
          highlightRegex={highlightRegex}
          htmlReactParserOptions={htmlReactParserOptions}
          linkifyOpts={LINKIFY_OPTS}
        />
      );

      switch (content.msgtype) {
        case MsgType.Text:
          return <MText edited={edited} content={content} renderBody={renderBody} />;
        case MsgType.Notice:
          return <MNotice edited={edited} content={content} renderBody={renderBody} />;
        case MsgType.Emote:
          return (
            <MEmote
              displayName={displayName}
              edited={edited}
              content={content}
              renderBody={renderBody}
            />
          );
        default:
          break;
      }
    }

    return (
      <Text size="T400" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {renderSnippetBody()}
        {edited && ' (edited)'}
      </Text>
    );
  }

  if (!highlightRegex) {
    return (
      <Text size="T400" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {renderSnippetBody()}
        {edited && ' (edited)'}
      </Text>
    );
  }

  if (event.type === MessageEvent.RoomMessage) {
    const renderBody = (props: { body: string; customBody?: string }) => (
      <RenderBody
        {...props}
        highlightRegex={highlightRegex}
        htmlReactParserOptions={htmlReactParserOptions}
        linkifyOpts={LINKIFY_OPTS}
      />
    );

    switch (content.msgtype) {
      case MsgType.Text:
        return <MText edited={edited} content={content} renderBody={renderBody} />;
      case MsgType.Notice:
        return <MNotice edited={edited} content={content} renderBody={renderBody} />;
      case MsgType.Emote:
        return (
          <MEmote
            displayName={displayName}
            edited={edited}
            content={content}
            renderBody={renderBody}
          />
        );
      default:
        break;
    }
  }

  return (
    <Text size="T400" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {renderSnippetBody()}
    </Text>
  );
}
