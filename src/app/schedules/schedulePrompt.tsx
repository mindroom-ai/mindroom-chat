import type { ReactNode } from 'react';
import * as css from './roomSchedules.css';

const MENTION_SOURCE = '(^|[\\s(])(@[A-Za-z0-9._=/+-]+(?::[A-Za-z0-9.-]+(?::\\d+)?)?)';

type PromptSegment = {
  kind: 'fence' | 'text';
  text: string;
  offset: number;
};

type PromptToken = {
  kind: 'text' | 'code' | 'verbatim';
  value: string;
  offset: number;
};

/**
 * Pass 1: splits the prompt line-by-line into fenced code blocks and plain text segments.
 * A line whose leading spaces/tabs are followed by >= 3 backticks or tildes opens a fence and
 * closes only on a subsequent line whose leading spaces/tabs are followed by at least that many of
 * the same fence character and optional trailing spaces/tabs/CR (or runs to EOF if unclosed).
 */
const splitFenceSegments = (prompt: string): PromptSegment[] => {
  const segments: PromptSegment[] = [];
  let textStart = 0;
  let inFence = false;
  let fenceStart = 0;
  let fenceChar: '`' | '~' | '' = '';
  let fenceRunLen = 0;
  let pos = 0;

  while (pos < prompt.length) {
    const nl = prompt.indexOf('\n', pos);
    const lineContentEnd = nl === -1 ? prompt.length : nl;
    const nextPos = nl === -1 ? prompt.length : nl + 1;

    let cursor = pos;
    while (cursor < lineContentEnd && (prompt[cursor] === ' ' || prompt[cursor] === '\t')) {
      cursor += 1;
    }
    const ch = prompt[cursor];
    const isMarker = ch === '`' || ch === '~';
    let markerEnd = cursor;
    if (isMarker) {
      while (markerEnd < lineContentEnd && prompt[markerEnd] === ch) {
        markerEnd += 1;
      }
    }
    const runLen = markerEnd - cursor;

    if (!inFence) {
      // CommonMark §4.5: a backtick fence opener's info string cannot contain backticks.
      if (
        isMarker &&
        runLen >= 3 &&
        (ch === '~' || !prompt.slice(markerEnd, lineContentEnd).includes('`'))
      ) {
        if (pos > textStart) {
          segments.push({ kind: 'text', text: prompt.slice(textStart, pos), offset: textStart });
        }
        inFence = true;
        fenceStart = pos;
        fenceChar = ch;
        fenceRunLen = runLen;
      }
    } else if (ch === fenceChar && runLen >= fenceRunLen) {
      let tail = markerEnd;
      while (
        tail < lineContentEnd &&
        (prompt[tail] === ' ' || prompt[tail] === '\t' || prompt[tail] === '\r')
      ) {
        tail += 1;
      }
      if (tail === lineContentEnd) {
        segments.push({
          kind: 'fence',
          text: prompt.slice(fenceStart, nextPos),
          offset: fenceStart,
        });
        inFence = false;
        fenceChar = '';
        fenceRunLen = 0;
        textStart = nextPos;
      }
    }

    pos = nextPos;
  }

  if (inFence) {
    segments.push({ kind: 'fence', text: prompt.slice(fenceStart), offset: fenceStart });
  } else if (textStart < prompt.length) {
    segments.push({ kind: 'text', text: prompt.slice(textStart), offset: textStart });
  }

  return segments;
};

/**
 * Pass 2: splits only clean single-backtick inline spans on a single line within a non-fence text
 * segment. Escaped backticks (`\``) and multi-backtick spans stay verbatim.
 */
const tokenizeInlineCode = (segment: string): PromptToken[] => {
  const tokens: PromptToken[] = [];
  let textStart = 0;
  let i = 0;

  while (i < segment.length) {
    if (segment[i] === '\\' && segment[i + 1] === '`') {
      i += 2;
      continue;
    }

    if (segment[i] !== '`') {
      i += 1;
      continue;
    }

    let runEnd = i;
    while (runEnd < segment.length && segment[runEnd] === '`') {
      runEnd += 1;
    }
    const runLen = runEnd - i;

    if (runLen >= 2) {
      let k = runEnd;
      let matchedEnd = -1;
      // CommonMark §6.1: backslashes inside a code span are literal, never escaping the closer.
      while (k < segment.length) {
        if (segment[k] === '`') {
          let closeEnd = k;
          while (closeEnd < segment.length && segment[closeEnd] === '`') {
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
        tokens.push({ kind: 'text', value: segment.slice(textStart, i), offset: textStart });
      }
      tokens.push({ kind: 'verbatim', value: segment.slice(i, verbatimEnd), offset: i });
      i = verbatimEnd;
      textStart = i;
      continue;
    }

    let closeIndex = -1;
    let j = i + 1;
    // CommonMark §6.1: backslashes inside a code span are literal, never escaping the closer.
    while (j < segment.length && segment[j] !== '\n') {
      if (segment[j] === '`') {
        let closeRunEnd = j;
        while (closeRunEnd < segment.length && segment[closeRunEnd] === '`') {
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
        tokens.push({ kind: 'text', value: segment.slice(textStart, i), offset: textStart });
      }
      tokens.push({ kind: 'code', value: segment.slice(i + 1, closeIndex), offset: i });
      i = closeIndex + 1;
      textStart = i;
    } else {
      i += 1;
    }
  }

  if (textStart < segment.length) {
    tokens.push({ kind: 'text', value: segment.slice(textStart), offset: textStart });
  }

  return tokens;
};

const renderPlainSegment = (
  segment: string,
  tokenOffset: number,
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
    if (matchStart === 0 && leading === '' && tokenOffset > 0) {
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
      <bdi key={`${keyPrefix}-m-${mentionStart}`} dir="ltr" className={css.PromptMention}>
        {trimmedMention}
      </bdi>
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
 * Formats a scheduled task prompt into pure React nodes: single-line backtick spans render their
 * code content inside `<code>` and `@handle` mentions render inside `<bdi dir="ltr">`, while
 * fenced code blocks and newlines stay verbatim.
 */
export const renderSchedulePrompt = (prompt: string): ReactNode => {
  if (!prompt) return prompt;

  const nodes: ReactNode[] = [];
  const segments = splitFenceSegments(prompt);

  segments.forEach((segment, segmentIndex) => {
    if (segment.kind === 'fence') {
      nodes.push(segment.text);
      return;
    }

    const tokens = tokenizeInlineCode(segment.text);
    tokens.forEach((token, tokenIndex) => {
      if (token.kind === 'code') {
        nodes.push(
          <code key={`c-${segment.offset + token.offset}`} dir="ltr" className={css.InlineCode}>
            {token.value}
          </code>
        );
      } else if (token.kind === 'verbatim') {
        nodes.push(token.value);
      } else {
        nodes.push(
          ...renderPlainSegment(token.value, token.offset, `s${segmentIndex}-${tokenIndex}`)
        );
      }
    });
  });

  return nodes.length === 1 ? nodes[0] : nodes;
};
