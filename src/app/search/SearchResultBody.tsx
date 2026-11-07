import React, { Fragment, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { MatrixEvent, type IEventWithRoomId, type Room } from 'matrix-js-sdk';
import { Box, Text } from 'folds';
import { RenderMessageContent } from '../messages/content/RenderMessageContent';
import { RenderBody } from '../messages/content/RenderBody';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useMentionClickHandler } from '../messages/useMentionClickHandler';
import { useMediaAuthentication } from '../matrix/hooks/useMediaAuthentication';
import { getReactCustomHtmlParser, LINKIFY_OPTS } from '../messages/html/react-custom-html-parser';
import { useSettingValue } from '../preferences/useSettingValue';
import { settingsAtom } from '../preferences/settings';
import { getMemberDisplayName } from '../matrix/room';
import { getMxIdLocalPart } from '../matrix/matrix';
import { MessageEvent, StateEvent } from '../matrix/types/room';
import { getSearchResultOpenTarget } from './searchResultOpenTarget';
import {
  getSearchResultEffectiveContent,
  getSearchResultLightweightCustomBody,
  getSearchResultPreviewText,
  isSearchResultEdited,
  shouldUseLightweightSearchResultBody,
} from './searchResultPreview';
import type { ResultItem } from './useMessageSearch';
import * as css from './SearchResultBody.css';
import { matchesEnum } from '../lib/matchesEnum';
import { isTrustedAgentSender, sanitizeContent } from '../matrix/protocol/untrustedContent';
import { readCallTranscript } from '../matrix/protocol/callTranscript';
import { revealDirectionControls } from '../ui/directional';

/** One search hit and the terms the server matched in it. */
export type SearchResultBodyProps = {
  room: Room;
  item: ResultItem;
  highlights: string[];
  highlightRegex?: RegExp;
};

const highlightText = (text: string, regex?: RegExp): React.ReactNode => {
  if (!regex) return text;
  const pattern = new RegExp(
    regex.source,
    regex.flags.includes('g') ? regex.flags : `${regex.flags}g`
  );
  const parts: React.ReactNode[] = [];
  let last = 0;
  let match = pattern.exec(text);
  while (match) {
    if (match[0] === '') {
      pattern.lastIndex += 1;
    } else {
      if (match.index > last) parts.push(text.slice(last, match.index));
      parts.push(
        <mark key={`${match.index}`} className={css.SearchMatch}>
          {match[0]}
        </mark>
      );
      last = match.index + match[0].length;
    }
    match = pattern.exec(text);
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.map((part, index) =>
    // eslint-disable-next-line react/no-array-index-key
    typeof part === 'string' ? <Fragment key={index}>{part}</Fragment> : part
  );
};

/** A line of plain text with the matched words marked. */
function MarkedText({ text, highlightRegex }: { text: string; highlightRegex?: RegExp }) {
  return (
    <Text as="div" size="T300" style={{ whiteSpace: 'pre-wrap' }} dir="auto">
      {highlightText(text, highlightRegex)}
    </Text>
  );
}

/**
 * The text a hit on a room's name or topic matched: the server searches those fields of the
 * state events too, and their events have no message body.
 */
const getStateHitText = (
  event: IEventWithRoomId,
  label: (key: 'roomName' | 'roomTopic') => string
): string | undefined => {
  const value = (field: string) => {
    const text = event.content?.[field];
    return typeof text === 'string' ? revealDirectionControls(text) : '';
  };
  if (matchesEnum(event.type, StateEvent.RoomTopic))
    return `${label('roomTopic')}: ${value('topic')}`;
  if (matchesEnum(event.type, StateEvent.RoomName)) return `${label('roomName')}: ${value('name')}`;
  return undefined;
};

/** A reply quotes a message that search does not return, so the hit says so. */
const quotesAnotherMessage = (content: Record<string, unknown>): boolean => {
  const relation = content['m.relates_to'] as
    | { 'm.in_reply_to'?: { event_id?: unknown }; is_falling_back?: boolean }
    | undefined;
  return typeof relation?.['m.in_reply_to']?.event_id === 'string' && !relation.is_falling_back;
};

/**
 * A search hit as the room shows the message: its latest text with Markdown, mentions, code and
 * MindRoom's tool calls, the matched words marked. Long messages (and long-text sidecars) take
 * the lightweight path: a snippet around the first match, as HTML when the message has some; a
 * voice call's transcript shows as its call card instead.
 * Hits without a message body (redactions, reactions, room names and topics) are a line of text.
 */
export function SearchResultBody({
  room,
  item,
  highlights,
  highlightRegex,
}: SearchResultBodyProps) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const authenticated = useMediaAuthentication();
  const mediaAutoLoad = useSettingValue(settingsAtom, 'mediaAutoLoad');
  const { event } = item;
  // Search hits are raw events: the same shape and agent-key checks as the timeline's events.
  const content = useMemo(
    () =>
      sanitizeContent(
        getSearchResultEffectiveContent(event),
        isTrustedAgentSender(event.sender)
      ) as Record<string, unknown>,
    [event]
  );
  const preview = useMemo(
    () => getSearchResultPreviewText(event, highlights, t),
    [event, highlights, t]
  );
  const matrixEvent = useMemo(() => new MatrixEvent(event), [event]);
  // A mention opens its profile card or room here, as it does in the timeline.
  const openMention = useMentionClickHandler(room.roomId);
  const parserOptions = useMemo(
    () =>
      getReactCustomHtmlParser(client, room.roomId, {
        linkifyOpts: LINKIFY_OPTS,
        useAuthentication: authenticated,
        highlightRegex,
        handleMentionClick: openMention,
      }),
    [client, room.roomId, authenticated, highlightRegex, openMention]
  );

  const stateText = getStateHitText(event, (key) => t(`featureUi.roomSettings.permissions.${key}`));
  if (stateText !== undefined)
    return <MarkedText text={stateText} highlightRegex={highlightRegex} />;
  if (event.unsigned?.redacted_because || !matchesEnum(event.type, MessageEvent.RoomMessage)) {
    return <MarkedText text={preview} highlightRegex={highlightRegex} />;
  }

  const edited = isSearchResultEdited(event);
  let body: React.ReactNode;
  // A call's transcript shows as its card, open at the match, whatever the length of its body.
  if (shouldUseLightweightSearchResultBody(content) && !readCallTranscript(content)) {
    body = (
      <Text as="div" size="T300" dir="auto">
        <RenderBody
          body={preview}
          customBody={getSearchResultLightweightCustomBody(content, preview)}
          highlightRegex={highlightRegex}
          linkifyOpts={LINKIFY_OPTS}
          htmlReactParserOptions={parserOptions}
        />
        {edited && (
          <Text as="span" size="T200" priority="300">
            {t('mindroomUi.message-search.mindroomSearchResultBody.edited')}
          </Text>
        )}
      </Text>
    );
  } else {
    const sender = event.sender;
    body = (
      <RenderMessageContent
        mEvent={matrixEvent}
        eventId={getSearchResultOpenTarget(event).mainEventId}
        roomId={room.roomId}
        eventType={event.type}
        msgType={typeof content.msgtype === 'string' ? content.msgtype : ''}
        displayName={getMemberDisplayName(room, sender) ?? getMxIdLocalPart(sender) ?? sender}
        ts={event.origin_server_ts}
        edited={edited}
        getContent={(() => content) as <T>() => T}
        mediaAutoLoad={!!mediaAutoLoad}
        urlPreview={false}
        outlineAttachment
        highlightRegex={highlightRegex}
        htmlReactParserOptions={parserOptions}
        linkifyOpts={LINKIFY_OPTS}
      />
    );
  }

  return (
    <Box direction="Column" gap="100" style={{ minWidth: 0 }}>
      {body}
      {quotesAnotherMessage(content) && (
        <Text size="T200" priority="300">
          {t(
            'mindroomUi.message-search.searchResultGroup.replyContextHiddenInSearchResultsOpenTheMessageFor'
          )}
        </Text>
      )}
    </Box>
  );
}
