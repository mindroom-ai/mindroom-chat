import { MINDROOM_TOOL_TRACE_KEY } from './toolTrace';
import { isRecord } from '../../lib/isRecord';

// A version-3 tool trace's text has none of its calls' markers: each call's `body_line` counts the
// lines of `body` before its marker, and `at` the top-level blocks of `formatted_body`. Putting
// them back gives the version-2 reply byte for byte. The backend shares
// `__fixtures__/tool-positions-v1.json`.

const TAG_REG = /<(\/?)([A-Za-z][A-Za-z0-9-]*)\b[^>]*?(\/?)>/g;
const VOID_TAG_REG = /^(?:area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/i;
const NON_BLANK_REG = /[^ \t\n\r\f]/;

type Call = { at: number; line: string; html: string };

/** Where each top-level element, void element or run of text that is not blank in `html` starts. */
export const htmlBlockStarts = (html: string): number[] => {
  const starts: number[] = [];
  let depth = 0;
  let textStart = 0;
  const readText = (end: number) => {
    const offset = depth === 0 ? html.slice(textStart, end).search(NON_BLANK_REG) : -1;
    if (offset >= 0) starts.push(textStart + offset);
  };
  // No tag ends after the last ">", and before it every tag that opens ends, so no "<" is read twice.
  const tags = html.slice(0, html.lastIndexOf('>') + 1);
  TAG_REG.lastIndex = 0;
  for (let tag = TAG_REG.exec(tags); tag; tag = TAG_REG.exec(tags)) {
    readText(tag.index);
    const [whole, closing, name = '', selfClosing] = tag;
    if (closing) depth = Math.max(0, depth - 1);
    else if (depth === 0) starts.push(tag.index);
    if (!closing && !selfClosing && !VOID_TAG_REG.test(name)) depth += 1;
    textStart = tag.index + whole.length;
  }
  readText(html.length);
  return starts;
};

/** The content's tool trace when it is version 3, whose markers are not in its text. */
const positionsOf = (content: Record<string, unknown>): Record<string, unknown> | undefined => {
  const trace = content[MINDROOM_TOOL_TRACE_KEY];
  return isRecord(trace) && trace.version === 3 ? trace : undefined;
};

/** Whether the content's tool trace is version 3, whose markers are not in its text. */
export const hasToolPositions = (content: Record<string, unknown>): boolean =>
  !!positionsOf(content);

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The markers of the calls with a `key` position, last first, so that each goes in without moving
 * the place of the next. A position that is no integer from the one before it up to `end` is
 * `end`; a call without the key has no marker.
 */
const placed = (events: unknown[], key: 'body_line' | 'at', end: number): Call[] => {
  let previous = 0;
  return events
    .flatMap((event, index): Call[] => {
      if (!isRecord(event) || !(key in event)) return [];
      const { tool_name: name, [key]: value } = event;
      if (typeof name !== 'string' || !name) return [];
      const valid =
        typeof value === 'number' && Number.isInteger(value) && previous <= value && value <= end;
      if (valid) previous = value;
      const tail = ` [${index + 1}]${event.type === 'tool_call_started' ? ' ⏳' : ''}`;
      return [
        {
          at: valid ? value : end,
          line: `🔧 \`${name}\`${tail}`,
          html: `<p>🔧 <code>${escape(name)}</code>${tail}</p>\n`,
        },
      ];
    })
    .sort((a, b) => a.at - b.at)
    .reverse();
};

/**
 * Whether every positioned call in a `placeholder_body: true` trace is a well-formed, paired
 * `(body_line: 0, at: 0)` marker on a named tool, with at least one such call.
 */
const hasValidPlaceholderPositions = (events: unknown[]): boolean => {
  let count = 0;
  for (const event of events) {
    if (!isRecord(event)) continue;
    const hasLine = 'body_line' in event;
    const hasAt = 'at' in event;
    if (!hasLine && !hasAt) continue;
    if (
      typeof event.tool_name !== 'string' ||
      !event.tool_name ||
      event.body_line !== 0 ||
      event.at !== 0
    ) {
      return false;
    }
    count += 1;
  }
  return count > 0;
};

/** One layer as its version-2 reply, with its version-3 trace's markers back in its text. */
const layerWithMarkers = (content: Record<string, unknown>): Record<string, unknown> => {
  const trace = positionsOf(content);
  const events = trace?.events;
  if (!trace || !Array.isArray(events)) return content;
  const { placeholder_body: placeholderBody, ...restTrace } = trace;
  const isPlaceholderBody = placeholderBody === true;
  const { body, formatted_body: html } = content;
  if (
    isPlaceholderBody &&
    (typeof body !== 'string' || typeof html !== 'string' || !hasValidPlaceholderPositions(events))
  ) {
    return content;
  }
  const restored: Record<string, unknown> = {
    ...content,
    [MINDROOM_TOOL_TRACE_KEY]: { ...restTrace, version: 2 },
  };
  if (typeof body === 'string') {
    const baseBody = isPlaceholderBody ? '' : body;
    // Before line `body_line` with a blank line after it, or at the end after one.
    const lines = baseBody ? baseBody.split('\n') : [];
    const end = lines.length;
    placed(events, 'body_line', end).forEach(({ at, line }) =>
      lines.splice(at, 0, ...(at < end ? [line, ''] : ['', line]))
    );
    // No blank line opens a reply that is its markers alone.
    restored.body = lines.join('\n').slice(baseBody ? 0 : 1);
  }
  if (typeof html === 'string') {
    const baseHtml = isPlaceholderBody ? '' : html;
    const starts = htmlBlockStarts(baseHtml);
    let text = baseHtml;
    placed(events, 'at', starts.length).forEach((call) => {
      const offset = starts[call.at] ?? baseHtml.length;
      text = text.slice(0, offset) + call.html + text.slice(offset);
    });
    restored.formatted_body = text;
  }
  return restored;
};

/**
 * `content` as its version-2 reply: its markers back in its text, or in an edit's replacement.
 * An edit's fallback is its replacement again with its text after "* ", where an opening marker
 * is no line of its own, so its markers go back where the replacement's do. A fallback that
 * shows other HTML stays as sent.
 */
export const withToolMarkersRestored = (
  content: Record<string, unknown>
): Record<string, unknown> => {
  const replacement = content['m.new_content'];
  if (!isRecord(replacement)) return layerWithMarkers(content);
  const restored = layerWithMarkers(replacement);
  if (restored === replacement) return layerWithMarkers(content);
  const edit: Record<string, unknown> = { ...content, 'm.new_content': restored };
  const { body } = content;
  const repeats =
    typeof body === 'string' &&
    body.startsWith('* ') &&
    content.formatted_body === replacement.formatted_body;
  if (!repeats) return edit;
  if (MINDROOM_TOOL_TRACE_KEY in content) {
    edit[MINDROOM_TOOL_TRACE_KEY] = restored[MINDROOM_TOOL_TRACE_KEY];
  }
  // The HTML is the replacement's, which has its markers back: only the text differs.
  const fallback = layerWithMarkers({
    body: body.slice(2),
    ...(typeof replacement.formatted_body === 'string'
      ? { formatted_body: replacement.formatted_body }
      : {}),
    [MINDROOM_TOOL_TRACE_KEY]: replacement[MINDROOM_TOOL_TRACE_KEY],
  });
  return { ...edit, body: `* ${String(fallback.body)}`, formatted_body: restored.formatted_body };
};
