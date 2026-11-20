import { MINDROOM_TOOL_TRACE_KEY } from './toolTrace';
import { isRecord } from '../../lib/isRecord';

// A version-3 tool trace's text has no marker lines: each call's `at` counts the top-level blocks of
// `formatted_body` before it. The backend shares `__fixtures__/tool-positions-v1.json`.

const TAG_REG = /<(\/?)([A-Za-z][A-Za-z0-9-]*)\b[^>]*?(\/?)>/g;
const VOID_TAG_REG = /^(?:area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/i;
const NON_BLANK_REG = /[^ \t\n\r\f]/;
const FENCE_REG = /^ {0,3}(`{3,}|~{3,})/;

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

/** Where each block of a Markdown body starts: a run of lines not blank, a fenced code block whole. */
const bodyBlockStarts = (body: string): number[] => {
  const starts: number[] = [];
  let fence: string | undefined;
  let inBlock = false;
  let offset = 0;
  body.split('\n').forEach((line) => {
    const opener = FENCE_REG.exec(line)?.[1]?.[0];
    if (fence !== undefined) {
      if (opener === fence) fence = undefined;
    } else if (!NON_BLANK_REG.test(line)) inBlock = false;
    else {
      if (!inBlock) starts.push(offset);
      inBlock = true;
      fence = opener;
    }
    offset += line.length + 1;
  });
  return starts;
};

/** `text` with each call, in order of position, written before the block it names or at the end. */
const withCalls = (text: string, starts: number[], calls: Call[], put: (call: Call) => string) => {
  let restored = '';
  let cursor = 0;
  calls.forEach((call) => {
    const offset = starts[call.at] ?? text.length;
    restored += `${text.slice(cursor, offset)}${put(call)}`;
    cursor = offset;
  });
  return `${restored}${text.slice(cursor)}`;
};

/** Whether the content's tool trace is version 3 or later, whose markers are not in its text. */
export const hasToolPositions = (content: Record<string, unknown>): boolean => {
  const trace = content[MINDROOM_TOOL_TRACE_KEY];
  return isRecord(trace) && typeof trace.version === 'number' && trace.version >= 3;
};

/** `content` as a version-2 reply, with its version-3 trace's markers back in its text. */
export const withToolMarkersRestored = (
  content: Record<string, unknown>
): Record<string, unknown> => {
  const trace = content[MINDROOM_TOOL_TRACE_KEY];
  if (!isRecord(trace) || !hasToolPositions(content)) return content;
  const body = typeof content.body === 'string' ? content.body : '';
  const html = typeof content.formatted_body === 'string' ? content.formatted_body : undefined;
  const bodyStarts = bodyBlockStarts(body);
  const htmlStarts = html === undefined ? bodyStarts : htmlBlockStarts(html);
  // A position that is no block of the text, or before an earlier call's, puts its call at the end.
  let previous = 0;
  const calls = (Array.isArray(trace.events) ? trace.events : [])
    .flatMap((event: unknown, index): Call[] => {
      // A call without a position had no line in the text, as a version-2 call without a marker.
      if (!isRecord(event) || typeof event.tool_name !== 'string' || !event.tool_name) return [];
      if (!('at' in event)) return [];
      const { at } = event;
      const valid = typeof at === 'number' && Number.isInteger(at) && at >= previous;
      if (valid && at <= htmlStarts.length) previous = at;
      const position = valid && at <= htmlStarts.length ? at : htmlStarts.length;
      const pending = event.type === 'tool_call_started';
      return [{ at: position, name: event.tool_name, index: index + 1, pending }];
    })
    .sort((a, b) => a.at - b.at);
  const suffix = ({ index, pending }: Call) => ` [${index}]${pending ? ' ⏳' : ''}`;
  const escape = (text: string) =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const restoredBody = withCalls(body, bodyStarts, calls, (call) => {
    const line = `🔧 \`${call.name}\`${suffix(call)}`;
    return call.at < bodyStarts.length ? `${line}\n\n` : `\n\n${line}`;
  });
  const writeHtml = (call: Call) => `<p>🔧 <code>${escape(call.name)}</code>${suffix(call)}</p>\n`;
  return {
    ...content,
    body: body ? restoredBody : restoredBody.replace(/^\n\n/, ''),
    ...(html === undefined
      ? {}
      : { formatted_body: withCalls(html, htmlStarts, calls, writeHtml) }),
    [MINDROOM_TOOL_TRACE_KEY]: { ...trace, version: 2 },
  };
};
