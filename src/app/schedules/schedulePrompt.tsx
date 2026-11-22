import type { ReactNode } from 'react';
import * as css from './roomSchedules.css';

const INLINE_CODE_SOURCE = '`([^`\\n]+)`';
const MENTION_SOURCE = '(^|[\\s(])(@[A-Za-z0-9_.-]+(?::[A-Za-z0-9.-]+)?)';

const renderPlainSegment = (
  segment: string,
  segmentOffset: number,
  keyPrefix: string
): ReactNode[] => {
  if (!segment) return [];

  const nodes: ReactNode[] = [];
  const pattern = new RegExp(MENTION_SOURCE, 'g');
  let cursor = 0;

  let match = pattern.exec(segment);
  while (match !== null) {
    const leading = match[1] ?? '';
    const mention = match[2] ?? '';
    const matchStart = match.index;

    // Do not highlight a handle glued directly after a closing backtick.
    if (matchStart === 0 && leading === '' && segmentOffset > 0) {
      match = pattern.exec(segment);
      continue;
    }

    const trimmedMention = mention.replace(/\.+$/, '');
    if (trimmedMention.length <= 1) {
      match = pattern.exec(segment);
      continue;
    }

    const mentionStart = matchStart + leading.length;
    if (mentionStart > cursor) {
      nodes.push(segment.slice(cursor, mentionStart));
    }

    nodes.push(
      <span key={`${keyPrefix}-m-${mentionStart}`} className={css.PromptMention}>
        {trimmedMention}
      </span>
    );
    cursor = mentionStart + trimmedMention.length;
    match = pattern.exec(segment);
  }

  if (cursor < segment.length) {
    nodes.push(segment.slice(cursor));
  }

  return nodes;
};

/**
 * Formats a scheduled task prompt into pure React nodes: single-line inline code spans and
 * highlighted `@handle` mentions, preserving newlines and exact textContent for plain mentions.
 */
export const renderSchedulePrompt = (prompt: string): ReactNode => {
  if (!prompt) return prompt;

  const nodes: ReactNode[] = [];
  const codePattern = new RegExp(INLINE_CODE_SOURCE, 'g');
  let cursor = 0;
  let segmentIndex = 0;

  let match = codePattern.exec(prompt);
  while (match !== null) {
    const matchStart = match.index;
    if (matchStart > cursor) {
      nodes.push(
        ...renderPlainSegment(prompt.slice(cursor, matchStart), cursor, `s${segmentIndex}`)
      );
      segmentIndex += 1;
    }

    const codeContent = match[1] ?? '';
    nodes.push(
      <code key={`c-${matchStart}`} className={css.InlineCode}>
        {codeContent}
      </code>
    );
    cursor = matchStart + match[0].length;
    match = codePattern.exec(prompt);
  }

  if (cursor < prompt.length) {
    nodes.push(...renderPlainSegment(prompt.slice(cursor), cursor, `s${segmentIndex}`));
  }

  return nodes.length === 1 ? nodes[0] : nodes;
};
