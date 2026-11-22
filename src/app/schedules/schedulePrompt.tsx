import type { ReactNode } from 'react';
import * as css from './roomSchedules.css';

const FENCE_OPEN = /^[ \t]*`{3,}[^`\n]*\r?\n?$/;
const FENCE_CLOSE = /^[ \t]*`{3,}[ \t]*\r?\n?$/;
const INLINE_RE =
  /(?:(`{2,})(?:[\s\S]*?\1)?)|`([^`\n]+)`|(^|[\s(])(@[A-Za-z0-9._=/+-]+(?::[A-Za-z0-9.-]+(?::\d+)?)?)/g;

const splitFences = (prompt: string): [boolean, string][] => {
  const out: [boolean, string][] = [];
  let inFence = false;
  let buf = '';
  for (const line of prompt.split(/(?<=\n)/)) {
    if (!inFence && FENCE_OPEN.test(line)) {
      if (buf) out.push([false, buf]);
      [buf, inFence] = [line, true];
    } else if (inFence && FENCE_CLOSE.test(line)) {
      out.push([true, buf + line]);
      [buf, inFence] = ['', false];
    } else {
      buf += line;
    }
  }
  if (buf) out.push([inFence, buf]);
  return out;
};

/** Formats single-line backtick spans and `@handle` mentions, leaving fences and multi-backtick runs verbatim. */
export const renderSchedulePrompt = (prompt: string): ReactNode => {
  if (!prompt) return prompt;
  const nodes: ReactNode[] = [];
  splitFences(prompt).forEach(([fence, text], seg) => {
    if (fence) {
      nodes.push(text);
      return;
    }
    let cursor = 0;
    for (const match of text.matchAll(INLINE_RE)) {
      const start = match.index ?? 0;
      const [, verbatim, code, leading, rawMention] = match;
      if (verbatim) continue;
      const mention = rawMention?.replace(/[.,;:!?)]+$/, '');
      if (code === undefined && (!mention || mention.length <= 1)) continue;
      const tokenStart = code !== undefined ? start : start + (leading?.length ?? 0);
      if (tokenStart > cursor) nodes.push(text.slice(cursor, tokenStart));
      nodes.push(
        code !== undefined ? (
          <code key={`c-${seg}-${start}`} dir="ltr" className={css.InlineCode}>
            {code}
          </code>
        ) : (
          <bdi key={`m-${seg}-${tokenStart}`} dir="ltr" className={css.PromptMention}>
            {mention}
          </bdi>
        )
      );
      cursor = code !== undefined ? start + match[0].length : tokenStart + mention!.length;
    }
    if (cursor < text.length) nodes.push(text.slice(cursor));
  });
  return nodes.length === 1 ? nodes[0] : nodes;
};
