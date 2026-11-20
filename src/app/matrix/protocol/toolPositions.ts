import { MINDROOM_TOOL_TRACE_KEY } from './toolTrace';
import { isRecord } from '../../lib/isRecord';

// A version-3 tool trace's text has none of its calls' markers: each call's `body_line` counts the
// lines of `body` before its marker, and `at` the top-level blocks of `formatted_body`. Putting
// them back gives the version-2 reply byte for byte. The backend shares
// `__fixtures__/tool-positions-v1.json`.

const TAG_REG = /<(\/?)([A-Za-z][A-Za-z0-9-]*)\b[^>]*?(\/?)>/g;
const VOID_TAG_REG = /^(?:area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/i;
const NON_BLANK_REG = /[^ \t\n\r\f]/;

type Call = { at: number; name: string; index: number; pending: boolean };

/** Where each top-level element, void element or run of text that is not blank in `html` starts. */
export const htmlBlockStarts = (html: string): number[] => {
  const starts: number[] = [];
  let depth = 0;
  let textStart = 0;
  const readText = (end: number) => {
    const offset = depth === 0 ? html.slice(textStart, end).search(NON_BLANK_REG) : -1;
    if (offset >= 0) starts.push(textStart + offset);
  };
  TAG_REG.lastIndex = 0;
  for (let tag = TAG_REG.exec(html); tag; tag = TAG_REG.exec(html)) {
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

/** Whether the content's tool trace is version 3, whose markers are not in its text. */
export const hasToolPositions = (content: Record<string, unknown>): boolean => {
  const trace = content[MINDROOM_TOOL_TRACE_KEY];
  return isRecord(trace) && trace.version === 3;
};

/**
 * The calls with a `key` position, in order of it. A position that is no integer from the one
 * before it up to `end` is `end`; a call without the key has no marker.
 */
const placed = (events: unknown[], key: 'body_line' | 'at', end: number): Call[] => {
  let previous = 0;
  return events
    .flatMap((event, index): Call[] => {
      if (!isRecord(event) || typeof event.tool_name !== 'string' || !event.tool_name) return [];
      if (!(key in event)) return [];
      const value = event[key];
      const valid =
        typeof value === 'number' && Number.isInteger(value) && previous <= value && value <= end;
      if (valid) previous = value;
      const at = valid ? value : end;
      const pending = event.type === 'tool_call_started';
      return [{ at, name: event.tool_name, index: index + 1, pending }];
    })
    .sort((a, b) => a.at - b.at);
};

/** `content` as its version-2 reply, with its version-3 trace's markers back in its text. */
export const withToolMarkersRestored = (
  content: Record<string, unknown>
): Record<string, unknown> => {
  const trace = content[MINDROOM_TOOL_TRACE_KEY];
  if (!isRecord(trace) || trace.version !== 3 || !Array.isArray(trace.events)) return content;
  const { events } = trace;
  const suffix = ({ index, pending }: Call) => ` [${index}]${pending ? ' ⏳' : ''}`;
  const escape = (text: string) =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const restored: Record<string, unknown> = {
    ...content,
    [MINDROOM_TOOL_TRACE_KEY]: { ...trace, version: 2 },
  };
  if (typeof content.body === 'string') {
    // Before line `body_line` with a blank line after it, or at the end after one.
    const lines = content.body ? content.body.split('\n') : [];
    const kept: string[] = [];
    let cursor = 0;
    placed(events, 'body_line', lines.length).forEach((call) => {
      kept.push(...lines.slice(cursor, call.at));
      cursor = call.at;
      const line = `🔧 \`${call.name}\`${suffix(call)}`;
      if (call.at < lines.length) kept.push(line, '');
      else kept.push(...(kept.length > 0 ? [''] : []), line);
    });
    restored.body = [...kept, ...lines.slice(cursor)].join('\n');
  }
  if (typeof content.formatted_body === 'string') {
    const html = content.formatted_body;
    const starts = htmlBlockStarts(html);
    let text = '';
    let cursor = 0;
    placed(events, 'at', starts.length).forEach((call) => {
      const offset = starts[call.at] ?? html.length;
      text += `${html.slice(cursor, offset)}<p>🔧 <code>${escape(call.name)}</code>${suffix(
        call
      )}</p>\n`;
      cursor = offset;
    });
    restored.formatted_body = `${text}${html.slice(cursor)}`;
  }
  return restored;
};
