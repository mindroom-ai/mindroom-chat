import { IEventWithRoomId, MsgType, RelationType } from 'matrix-js-sdk';
import type { TFunction } from 'i18next';
import { getSameSenderBundledEdit } from '../matrix/editEvent';
import { MessageEvent } from '../matrix/types/room';
import { shouldUseLongTextSearchResultBody } from '../messages/content/searchResultPolicy';
import { parseInlineMD } from '../rich-text/markdown/inline/parser';
import { parseBlockMD } from '../rich-text/markdown/block/parser';
import { matchesEnum } from '../lib/matchesEnum';
import { WORD_CHAR_PATTERN } from '../lib/regex';
import { findFirstHighlight } from './highlightRegex';

const collapseWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();
export const SEARCH_RESULT_BODY_CHAR_LIMIT = 1600;
export const SEARCH_RESULT_RICH_BODY_CHAR_LIMIT = 600;
export const SEARCH_RESULT_LIGHTWEIGHT_FORMATTED_BODY_CHAR_LIMIT = 5000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const withBody = (label: string, body?: string): string => {
  const normalizedBody = typeof body === 'string' ? collapseWhitespace(body) : '';
  return normalizedBody ? `${label}: ${normalizedBody}` : label;
};

const WORD_CHAR = new RegExp(`^${WORD_CHAR_PATTERN}$`, 'u');
const ENDS_IN_WORD_CHAR = new RegExp(`${WORD_CHAR_PATTERN}$`, 'u');
const STARTS_WITH_WORD_CHAR = new RegExp(`^${WORD_CHAR_PATTERN}`, 'u');
const HAS_WORD_CHAR = new RegExp(WORD_CHAR_PATTERN, 'u');

/** Whether `at` falls between two letters or digits of `text`, inside one word. */
const cutsWord = (text: string, at: number): boolean =>
  at > 0 &&
  at < text.length &&
  ENDS_IN_WORD_CHAR.test(text.slice(Math.max(0, at - 2), at)) &&
  STARTS_WITH_WORD_CHAR.test(text.slice(at, at + 2));

/** How many UTF-16 units the letters and digits at the start of `chars` take. */
const wordRunLength = (chars: readonly string[]): number => {
  let length = 0;
  for (const char of chars) {
    if (!WORD_CHAR.test(char)) break;
    length += char.length;
  }
  return length;
};

/** Whether `at` falls between the two halves of a surrogate pair of `text`. */
const splitsPair = (text: string, at: number): boolean =>
  at > 0 &&
  at < text.length &&
  /[\uDC00-\uDFFF]/.test(text.charAt(at)) &&
  /[\uD800-\uDBFF]/.test(text.charAt(at - 1));

/**
 * The window `start`..`end` of `text` without the parts of words cut at its edges, so a word's
 * tail is never read as a whole word. An edge never splits a character. When trimming leaves no
 * letter or digit, the window keeps its cut words.
 */
const clipToWords = (text: string, start: number, end: number): [number, number] => {
  const first = splitsPair(text, start) ? start + 1 : start;
  const last = splitsPair(text, end) ? end - 1 : end;
  const chars = Array.from(text.slice(first, last));
  const from = cutsWord(text, first) ? first + wordRunLength(chars) : first;
  const to = cutsWord(text, last) ? last - wordRunLength(chars.reverse()) : last;
  return from < to && HAS_WORD_CHAR.test(text.slice(from, to)) ? [from, to] : [first, last];
};

export const getSearchResultBodySnippet = (
  body: string,
  highlights: string[] = [],
  maxChars = SEARCH_RESULT_BODY_CHAR_LIMIT
): string => {
  if (body.length <= maxChars) return body;

  const targetIndex = findFirstHighlight(body, highlights);
  const windowSize = Math.max(maxChars - 2, 0);
  const start =
    targetIndex >= 0
      ? Math.max(0, Math.min(targetIndex - Math.floor(windowSize * 0.3), body.length - windowSize))
      : 0;
  const [from, to] = clipToWords(body, start, Math.min(body.length, start + windowSize));
  const prefix = from > 0 ? '…' : '';
  const suffix = to < body.length ? '…' : '';

  return `${prefix}${body.slice(from, to).trim()}${suffix}`;
};

const getSerializedReplacementContent = (
  event: IEventWithRoomId
): IEventWithRoomId['content'] | undefined => {
  const replacement = getSameSenderBundledEdit(event);
  if (!replacement || !isRecord(replacement.content)) return undefined;

  const replacementNewContent = replacement.content['m.new_content'];
  if (isRecord(replacementNewContent)) {
    return replacementNewContent;
  }

  return replacement.content;
};

export const getSearchResultEffectiveContent = (
  event: IEventWithRoomId
): IEventWithRoomId['content'] => {
  const relation = event.content?.['m.relates_to'];
  const inlineNewContent = event.content?.['m.new_content'];
  if (relation?.rel_type === RelationType.Replace && isRecord(inlineNewContent)) {
    return inlineNewContent;
  }

  const serializedReplacementContent = getSerializedReplacementContent(event);
  if (serializedReplacementContent) {
    return serializedReplacementContent;
  }

  if (isRecord(inlineNewContent)) {
    return inlineNewContent;
  }

  return event.content;
};

export const isSearchResultEdited = (event: IEventWithRoomId): boolean =>
  event.content?.['m.relates_to']?.rel_type === RelationType.Replace ||
  isRecord(event.content?.['m.new_content']) ||
  !!getSerializedReplacementContent(event);

export const shouldUseLightweightSearchResultBody = (
  content: IEventWithRoomId['content']
): boolean => {
  const body = typeof content?.body === 'string' ? content.body : undefined;
  const formattedBody =
    typeof content?.formatted_body === 'string' ? content.formatted_body : undefined;

  return (
    shouldUseLongTextSearchResultBody(content) ||
    (typeof body === 'string' && body.length > SEARCH_RESULT_RICH_BODY_CHAR_LIMIT) ||
    (typeof formattedBody === 'string' &&
      formattedBody.length > SEARCH_RESULT_RICH_BODY_CHAR_LIMIT * 2)
  );
};

export const getSearchResultLightweightFormattedBody = (
  content: IEventWithRoomId['content']
): string | undefined => {
  const formattedBody =
    typeof content?.formatted_body === 'string' ? content.formatted_body : undefined;

  if (
    typeof formattedBody === 'string' &&
    formattedBody.length <= SEARCH_RESULT_LIGHTWEIGHT_FORMATTED_BODY_CHAR_LIMIT
  ) {
    return formattedBody;
  }

  return undefined;
};

export const getSearchResultLightweightCustomBody = (
  content: IEventWithRoomId['content'],
  previewText: string
): string | undefined => {
  const formattedBody = getSearchResultLightweightFormattedBody(content);
  if (formattedBody) return formattedBody;

  const markdownHtml = parseBlockMD(previewText, parseInlineMD);
  if (markdownHtml !== previewText) {
    return markdownHtml;
  }

  return undefined;
};

export const getSearchResultPreviewText = (
  event: IEventWithRoomId,
  highlights: string[] = [],
  t?: TFunction
): string => {
  if (event.unsigned?.redacted_because) {
    return t?.('mindroomUi.message-search.searchResultPreview.redacted') ?? 'Message was redacted.';
  }

  const content = getSearchResultEffectiveContent(event);
  const body = typeof content?.body === 'string' ? content.body : undefined;
  const previewBody =
    typeof body === 'string'
      ? getSearchResultBodySnippet(collapseWhitespace(body), highlights)
      : undefined;

  if (matchesEnum(event.type, MessageEvent.RoomMessage)) {
    switch (content?.msgtype) {
      case MsgType.Text:
      case MsgType.Notice:
      case MsgType.Emote:
        return (
          previewBody ?? t?.('mindroomUi.message-search.searchResultPreview.message') ?? 'Message'
        );
      case MsgType.Image:
        return withBody(
          t?.('mindroomUi.message-search.searchResultPreview.image') ?? 'Image',
          previewBody
        );
      case MsgType.Video:
        return withBody(
          t?.('mindroomUi.message-search.searchResultPreview.video') ?? 'Video',
          previewBody
        );
      case MsgType.Audio:
        return withBody(
          t?.('mindroomUi.message-search.searchResultPreview.audio') ?? 'Audio',
          previewBody
        );
      case MsgType.File:
        return withBody(
          t?.('mindroomUi.message-search.searchResultPreview.file') ?? 'File',
          previewBody
        );
      case MsgType.Location:
        return withBody(
          t?.('mindroomUi.message-search.searchResultPreview.location') ?? 'Location',
          previewBody
        );
      default:
        return collapseWhitespace(
          previewBody ??
            content?.msgtype ??
            t?.('mindroomUi.message-search.searchResultPreview.message') ??
            'Message'
        );
    }
  }

  if (matchesEnum(event.type, MessageEvent.Reaction)) {
    return t?.('mindroomUi.message-search.searchResultPreview.reaction') ?? 'Reaction';
  }

  return collapseWhitespace(
    body ??
      event.type ??
      t?.('mindroomUi.message-search.searchResultPreview.unsupportedEvent') ??
      'Unsupported event'
  );
};
