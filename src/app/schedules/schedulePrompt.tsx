import type { ReactNode } from 'react';
import * as css from './roomSchedules.css';

const MENTION_SOURCE = '(^|[\\s(])(@[A-Za-z0-9._=/+-]+(?::[A-Za-z0-9.-]+(?::\\d+)?)?)';

type PromptToken = {
  kind: 'text' | 'code';
  value: string;
  offset: number;
};

/**
 * Splits only clean single-backtick inline spans on a single line.
 * Escaped backticks (`\``) and multi-backtick runs (`` `` ``, ```` ``` ````) stay verbatim.
 */
const tokenizeInlineCode = (prompt: string): PromptToken[] => {
  const tokens: PromptToken[] = [];
  let textStart = 0;
  let i = 0;

  while (i < prompt.length) {
    if (prompt[i] === '\\' && prompt[i + 1] === '`') {
      i += 2;
      continue;
    }

    if (prompt[i] !== '`') {
      i += 1;
      continue;
    }

    let runEnd = i;
    while (runEnd < prompt.length && prompt[runEnd] === '`') {
      runEnd += 1;
    }
    if (runEnd - i > 1) {
      i = runEnd;
      continue;
    }

    let closeIndex = -1;
    let j = i + 1;
    while (j < prompt.length && prompt[j] !== '\n') {
      if (prompt[j] === '\\' && prompt[j + 1] === '`') {
        j += 2;
        continue;
      }
      if (prompt[j] === '`') {
        let closeRunEnd = j;
        while (closeRunEnd < prompt.length && prompt[closeRunEnd] === '`') {
          closeRunEnd += 1;
        }
        if (closeRunEnd - j > 1) {
          break;
        }
        if (j > i + 1) {
          closeIndex = j;
        }
        break;
      }
      j += 1;
    }

    if (closeIndex !== -1) {
      if (i > textStart) {
        tokens.push({ kind: 'text', value: prompt.slice(textStart, i), offset: textStart });
      }
      tokens.push({ kind: 'code', value: prompt.slice(i + 1, closeIndex), offset: i });
      i = closeIndex + 1;
      textStart = i;
    } else {
      i += 1;
    }
  }

  if (textStart < prompt.length) {
    tokens.push({ kind: 'text', value: prompt.slice(textStart), offset: textStart });
  }

  return tokens;
};

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

    const trimmedMention = mention.replace(/[.,;:!?)]+$/, '');
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
  const tokens = tokenizeInlineCode(prompt);

  tokens.forEach((token, index) => {
    if (token.kind === 'code') {
      nodes.push(
        <code key={`c-${token.offset}`} className={css.InlineCode}>
          {token.value}
        </code>
      );
    } else {
      nodes.push(...renderPlainSegment(token.value, token.offset, `s${index}`));
    }
  });

  return nodes.length === 1 ? nodes[0] : nodes;
};
