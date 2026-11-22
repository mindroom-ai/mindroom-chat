import type { ReactNode } from 'react';
import * as css from './roomSchedules.css';

const MENTION_SOURCE = '(^|[\\s(])(@[A-Za-z0-9._=/+-]+(?::[A-Za-z0-9.-]+(?::\\d+)?)?)';

type PromptToken = {
  kind: 'text' | 'code' | 'verbatim';
  value: string;
  offset: number;
};

const isStartOfLine = (text: string, index: number): boolean => {
  let pos = index - 1;
  while (pos >= 0 && (text[pos] === ' ' || text[pos] === '\t')) {
    pos -= 1;
  }
  return pos < 0 || text[pos] === '\n';
};

const findFenceBlockEnd = (prompt: string, openRunEnd: number, runLen: number): number => {
  const firstNewline = prompt.indexOf('\n', openRunEnd);
  if (firstNewline === -1) return prompt.length;

  let lineStart = firstNewline + 1;
  while (lineStart < prompt.length) {
    const nextNewline = prompt.indexOf('\n', lineStart);
    const lineEnd = nextNewline === -1 ? prompt.length : nextNewline;

    let pos = lineStart;
    while (pos < lineEnd && (prompt[pos] === ' ' || prompt[pos] === '\t')) {
      pos += 1;
    }
    let ticksEnd = pos;
    while (ticksEnd < lineEnd && prompt[ticksEnd] === '`') {
      ticksEnd += 1;
    }
    if (ticksEnd - pos >= runLen) {
      let tail = ticksEnd;
      while (tail < lineEnd && (prompt[tail] === ' ' || prompt[tail] === '\t')) {
        tail += 1;
      }
      if (tail === lineEnd) {
        return lineEnd;
      }
    }

    if (nextNewline === -1) break;
    lineStart = nextNewline + 1;
  }

  return prompt.length;
};

/**
 * Splits only clean single-backtick inline spans on a single line.
 * Escaped backticks (`\``), fenced code blocks, and multi-backtick spans stay verbatim.
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
    const runLen = runEnd - i;

    if (runLen >= 3 && isStartOfLine(prompt, i)) {
      const verbatimEnd = findFenceBlockEnd(prompt, runEnd, runLen);
      if (i > textStart) {
        tokens.push({ kind: 'text', value: prompt.slice(textStart, i), offset: textStart });
      }
      tokens.push({ kind: 'verbatim', value: prompt.slice(i, verbatimEnd), offset: i });
      i = verbatimEnd;
      textStart = i;
      continue;
    }

    if (runLen >= 2) {
      let k = runEnd;
      let matchedEnd = -1;
      while (k < prompt.length && prompt[k] !== '\n') {
        if (prompt[k] === '\\' && prompt[k + 1] === '`') {
          k += 2;
          continue;
        }
        if (prompt[k] === '`') {
          let closeEnd = k;
          while (closeEnd < prompt.length && prompt[closeEnd] === '`') {
            closeEnd += 1;
          }
          if (closeEnd - k === runLen) {
            matchedEnd = closeEnd;
            break;
          }
          k = closeEnd;
          continue;
        }
        k += 1;
      }

      const verbatimEnd = matchedEnd === -1 ? runEnd : matchedEnd;
      if (i > textStart) {
        tokens.push({ kind: 'text', value: prompt.slice(textStart, i), offset: textStart });
      }
      tokens.push({ kind: 'verbatim', value: prompt.slice(i, verbatimEnd), offset: i });
      i = verbatimEnd;
      textStart = i;
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
    } else if (token.kind === 'verbatim') {
      nodes.push(token.value);
    } else {
      nodes.push(...renderPlainSegment(token.value, token.offset, `s${index}`));
    }
  });

  return nodes.length === 1 ? nodes[0] : nodes;
};
