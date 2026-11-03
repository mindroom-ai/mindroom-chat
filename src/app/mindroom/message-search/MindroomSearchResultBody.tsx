import React, { Fragment, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from 'folds';
import type { SearchResultBodyProps } from './SearchResultGroup';
import { getSearchResultPreviewText, isSearchResultEdited } from './searchResultPreview';
import * as css from './MindroomSearchResultBody.css';

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

/**
 * A search hit's text as MindRoom shows it: the latest edit's text, a snippet around the first
 * match of a long (or long-text sidecar) message, and the matched words marked. Search results
 * render as text, never as the message's HTML.
 */
export function MindroomSearchResultBody({
  item,
  highlights,
  highlightRegex,
}: SearchResultBodyProps) {
  const { t } = useTranslation();
  const { event } = item;
  const preview = useMemo(
    () => getSearchResultPreviewText(event, highlights, t),
    [event, highlights, t]
  );

  return (
    <Text as="div" size="T300" style={{ whiteSpace: 'pre-wrap' }} dir="auto">
      {highlightText(preview, highlightRegex)}
      {isSearchResultEdited(event) && (
        <Text as="span" size="T200" priority="300">
          {t('mindroomUi.message-search.mindroomSearchResultBody.edited')}
        </Text>
      )}
    </Text>
  );
}
