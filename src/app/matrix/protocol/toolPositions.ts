import { MINDROOM_TOOL_TRACE_KEY } from './toolTrace';
import { isRecord } from '../../lib/isRecord';

// A version-3 tool trace's text has none of its calls' markers: each call's `body_line` counts the
// lines of `body` before its marker, and `at` the top-level blocks of `formatted_body`. Putting
// them back gives the version-2 reply byte for byte. The backend shares
// `__fixtures__/tool-positions-v1.json`.

const TAG_REG = /<(\/?)([A-Za-z][A-Za-z0-9-]*)\b[^>]*?(\/?)>/g;
const VOID_TAG_REG = /^(?:area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/i;

type PlacedCall = { at: number; text: string };

/** Where each top-level element, void element or run of text that is not blank in `html` starts. */
export const htmlBlockStarts = (html: string): number[] => {
  const starts: number[] = [];
  let depth = 0;
  let textStart = 0;
  const readText = (end: number) => {
    if (depth !== 0) return;
    for (let index = textStart; index < end; index += 1) {
      const code = html.charCodeAt(index);
      if (code !== 32 && code !== 9 && code !== 10 && code !== 13 && code !== 12) {
        starts.push(index);
        return;
      }
    }
  };
  const lastGt = html.lastIndexOf('>');
  if (lastGt >= 0) {
    // No tag ends after the last ">", and every tag before it closes, so no "<" is read twice.
    const tags = lastGt === html.length - 1 ? html : html.slice(0, lastGt + 1);
    TAG_REG.lastIndex = 0;
    for (let tag = TAG_REG.exec(tags); tag; tag = TAG_REG.exec(tags)) {
      readText(tag.index);
      const [whole, closing, name = '', selfClosing] = tag;
      if (closing) depth = Math.max(0, depth - 1);
      else if (depth === 0) starts.push(tag.index);
      if (!closing && !selfClosing && !VOID_TAG_REG.test(name)) depth += 1;
      textStart = tag.index + whole.length;
    }
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
 * The markers of the calls with a `key` position, in ascending placement order (preserving
 * original event order on ties). A position that is no integer from the one before it up to
 * `end` is `end`; a call without the key has no marker.
 */
const placed = (events: unknown[], key: 'body_line' | 'at', end: number): PlacedCall[] => {
  let previous = 0;
  let sorted = true;
  let lastAt = -1;
  const calls: PlacedCall[] = [];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!isRecord(event) || !(key in event)) continue;
    const { tool_name: name, [key]: value } = event;
    if (typeof name !== 'string' || !name) continue;
    const valid =
      typeof value === 'number' && Number.isInteger(value) && previous <= value && value <= end;
    if (valid) previous = value;
    const at = valid ? value : end;
    if (at < lastAt) sorted = false;
    lastAt = at;
    const tail = ` [${index + 1}]${event.type === 'tool_call_started' ? ' ⏳' : ''}`;
    calls.push({
      at,
      text:
        key === 'body_line'
          ? `🔧 \`${name}\`${tail}`
          : `<p>🔧 <code>${escape(name)}</code>${tail}</p>\n`,
    });
  }
  if (!sorted) calls.sort((a, b) => a.at - b.at);
  return calls;
};

/**
 * Whether a `placeholder_body` trace is sound. Its text stands in for a reply that is its markers
 * alone, so the trace says all of the reply: every entry is a named call, at least one has a
 * position, and each position is `body_line` 0 with `at` 0. The backend's `_placeholder_calls`
 * holds a trace to the same rule, so both discard the same texts.
 */
const isPlaceholderTrace = (events: unknown[]): boolean => {
  const calls = events.filter(isRecord);
  const placedCalls = calls.filter((call) => 'body_line' in call || 'at' in call);
  return (
    calls.length === events.length &&
    calls.every((call) => typeof call.tool_name === 'string' && call.tool_name !== '') &&
    placedCalls.length > 0 &&
    placedCalls.every((call) => call.body_line === 0 && call.at === 0)
  );
};

/** One layer as its version-2 reply, with its version-3 trace's markers back in its text. */
const layerWithMarkers = (
  content: Record<string, unknown>,
  includeHtml = true
): Record<string, unknown> => {
  const trace = positionsOf(content);
  const events = trace?.events;
  if (!trace || !Array.isArray(events)) return content;
  const placeholder = trace.placeholder_body === true;
  const hasText = typeof content.body === 'string' && typeof content.formatted_body === 'string';
  if (placeholder && !(hasText && isPlaceholderTrace(events))) return content;
  const { placeholder_body: _placeholder, ...marked } = trace;
  const restored: Record<string, unknown> = {
    ...content,
    [MINDROOM_TOOL_TRACE_KEY]: { ...(placeholder ? marked : trace), version: 2 },
  };
  // The markers go back in place of a placeholder's text, which a reader that puts none back shows.
  const { body, formatted_body: html } = placeholder ? { body: '', formatted_body: '' } : content;
  if (typeof body === 'string') {
    // Before line `body_line` with a blank line after it, or at the end after one.
    const lines = body ? body.split('\n') : [];
    const end = lines.length;
    const calls = placed(events, 'body_line', end);
    if (calls.length === 0) {
      restored.body = body;
    } else {
      const output: string[] = [];
      let cursor = 0;
      for (const { at, text } of calls) {
        while (cursor < at) {
          output.push(lines[cursor] ?? '');
          cursor += 1;
        }
        if (at < end) output.push(text, '');
        else output.push('', text);
      }
      while (cursor < end) {
        output.push(lines[cursor] ?? '');
        cursor += 1;
      }
      // No blank line opens a reply that is its markers alone.
      restored.body = output.join('\n').slice(body ? 0 : 1);
    }
  }
  if (includeHtml && typeof html === 'string') {
    const starts = htmlBlockStarts(html);
    const calls = placed(events, 'at', starts.length);
    if (calls.length === 0) {
      restored.formatted_body = html;
    } else {
      const chunks: string[] = [];
      let cursor = 0;
      for (const { at, text } of calls) {
        const offset = starts[at] ?? html.length;
        if (offset > cursor) chunks.push(html.slice(cursor, offset));
        chunks.push(text);
        cursor = offset;
      }
      if (cursor < html.length) chunks.push(html.slice(cursor));
      restored.formatted_body = chunks.join('');
    }
  }
  return restored;
};

const sameJsonValue = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, index) => sameJsonValue(value, b[index]))
    );
  }
  if (!isRecord(a) || !isRecord(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every(
      (key) => Object.prototype.hasOwnProperty.call(b, key) && sameJsonValue(a[key], b[key])
    )
  );
};

/**
 * `content` as its version-2 reply: its markers back in its text, or in an edit's replacement.
 * An edit's fallback is its replacement again with its text after "* ", where an opening marker
 * is no line of its own, so its markers go back where the replacement's do. A fallback that
 * shows other HTML or its own tool trace stays as sent, and so does one with other text than a
 * `placeholder_body` replacement, whose markers go back in place of its text. The backend's
 * `_each_layer` keeps the same fallbacks.
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
  const placeholder = positionsOf(replacement)?.placeholder_body === true;
  const repeats =
    typeof body === 'string' &&
    body.startsWith('* ') &&
    content.formatted_body === replacement.formatted_body &&
    (!(MINDROOM_TOOL_TRACE_KEY in content) ||
      sameJsonValue(content[MINDROOM_TOOL_TRACE_KEY], replacement[MINDROOM_TOOL_TRACE_KEY])) &&
    (!placeholder || body === `* ${String(replacement.body)}`);
  if (!repeats) return edit;
  if (MINDROOM_TOOL_TRACE_KEY in content) {
    edit[MINDROOM_TOOL_TRACE_KEY] = restored[MINDROOM_TOOL_TRACE_KEY];
  }
  // The HTML is the replacement's, which has its markers back: only the text differs.
  const fallback = layerWithMarkers(
    {
      body: body.slice(2),
      formatted_body: replacement.formatted_body,
      [MINDROOM_TOOL_TRACE_KEY]: replacement[MINDROOM_TOOL_TRACE_KEY],
    },
    false
  );
  return { ...edit, body: `* ${String(fallback.body)}`, formatted_body: restored.formatted_body };
};
