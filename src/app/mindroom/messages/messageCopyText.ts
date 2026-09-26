import { parseMindroomToolRefText, type MindroomToolRefParseResult } from './blocks';
import {
  getMindroomToolTraceEvents,
  isMindroomToolTraceV2,
  type MindroomToolTraceEvent,
} from './toolTrace';

const COPY_TEXT_MSGTYPES = new Set(['m.text', 'm.notice', 'm.emote']);
const TOOL_TRACE_KEY = 'io.mindroom.tool_trace';
const TOOL_MARKER_ICON = '🔧';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const asNonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const asTraceText = (value: unknown): string | undefined =>
  typeof value === 'string' ? value.trim() || undefined : undefined;

export const isCopyTextMessageContent = (content: Record<string, unknown>): boolean =>
  typeof content.msgtype === 'string' && COPY_TEXT_MSGTYPES.has(content.msgtype);

export type MessageCopyTextSource = {
  body: string;
  toolTraceEvents?: MindroomToolTraceEvent[];
};

const getNewContent = (
  content: Record<string, unknown> | undefined
): Record<string, unknown> | undefined =>
  isRecord(content?.['m.new_content'])
    ? (content?.['m.new_content'] as Record<string, unknown>)
    : undefined;

export const getMessageCopyTextSource = (
  content: Record<string, unknown>,
  originalContent: Record<string, unknown>,
  resolvedLongTextContent?: Record<string, unknown>
): MessageCopyTextSource | undefined => {
  // Ordered by preference: hydrated long text first, then the latest edit,
  // then the original event. Like the renderer, hydrated long text keeps its
  // own trace instead of borrowing the envelope's.
  const families = [
    [resolvedLongTextContent, getNewContent(resolvedLongTextContent)].filter(isRecord),
    [content, getNewContent(content), originalContent].filter(isRecord),
  ];
  const family = families.find((candidates) =>
    candidates.some((candidate) => asNonEmptyString(candidate.body))
  );
  const bodySource = family?.find((candidate) => asNonEmptyString(candidate.body));
  if (!family || !bodySource) return undefined;

  const traceSource = [bodySource, ...family].find(
    (candidate) => candidate[TOOL_TRACE_KEY] !== undefined
  );

  return {
    body: bodySource.body as string,
    toolTraceEvents:
      traceSource && isMindroomToolTraceV2(traceSource)
        ? getMindroomToolTraceEvents(traceSource)
        : undefined,
  };
};

type CodeFence = {
  marker: string;
  length: number;
};

// Fences may open inside list items or block quotes; drop those container
// prefixes before looking for the fence itself.
const FENCE_CONTAINER_PREFIX_REG = /^(?:[ \t]*(?:>|[-*+]|\d{1,9}[.)])(?=[ \t]|$)[ \t]?)*/;
const CODE_FENCE_REG = /^[ \t]*(`{3,}|~{3,})(.*)$/;
const INDENTED_CODE_REG = /^(?: {0,3}\t| {4})/;

const readCodeFence = (line: string): (CodeFence & { info: string }) | undefined => {
  const match = CODE_FENCE_REG.exec(line.replace(FENCE_CONTAINER_PREFIX_REG, ''));
  if (!match) return undefined;

  const [, fence, info] = match;
  // Backtick fence info strings cannot contain backticks (CommonMark).
  if (fence[0] === '`' && info.includes('`')) return undefined;
  return { marker: fence[0], length: fence.length, info };
};

const closesCodeFence = (line: string, fence: CodeFence): boolean => {
  const candidate = readCodeFence(line);
  return (
    !!candidate &&
    candidate.marker === fence.marker &&
    candidate.length >= fence.length &&
    candidate.info.trim() === ''
  );
};

const parseToolMarkerLine = (line: string): MindroomToolRefParseResult | undefined =>
  line.includes(TOOL_MARKER_ICON) && !INDENTED_CODE_REG.test(line)
    ? parseMindroomToolRefText(line)
    : undefined;

type ToolMarkerLineVisitor = (toolRef: MindroomToolRefParseResult) => string[];

const splitLines = (text: string): string[] => text.replace(/\r\n?/g, '\n').split('\n');

/**
 * Call `onLine` for every line, passing MindRoom's standalone
 * `🔧 `tool` [N]` marker when the line is one outside fenced code. Stops as
 * soon as `onLine` returns false.
 */
const scanToolMarkerLines = (
  lines: string[],
  onLine: (line: string, toolRef: MindroomToolRefParseResult | undefined) => boolean | void
): void => {
  let openFence: CodeFence | undefined;

  lines.every((line) => {
    if (openFence) {
      if (closesCodeFence(line, openFence)) openFence = undefined;
      return onLine(line, undefined) !== false;
    }

    const toolRef = parseToolMarkerLine(line);
    if (!toolRef) openFence = readCodeFence(line);
    return onLine(line, toolRef) !== false;
  });
};

/**
 * Replace marker lines with `visit`'s lines. Blank lines around a marker
 * collapse so it never leaves a gap wider than one blank line, and a marker
 * between two text lines still separates them. Returns the body unchanged when
 * it contains no markers.
 */
const replaceToolMarkerLines = (body: string, visit: ToolMarkerLineVisitor): string => {
  if (!body.includes(TOOL_MARKER_ICON)) return body;

  const output: string[] = [];
  let replaced = false;
  let separateNextBlock = false;
  const lastLineIsBlank = () => output.length === 0 || output[output.length - 1].trim() === '';

  scanToolMarkerLines(splitLines(body), (line, toolRef) => {
    if (toolRef) {
      replaced = true;
      const replacement = visit(toolRef);
      if (replacement.length > 0) {
        if (!lastLineIsBlank()) output.push('');
        output.push(...replacement);
      }
      separateNextBlock = true;
      return;
    }

    if (separateNextBlock) {
      if (line.trim() === '') return;
      if (!lastLineIsBlank()) output.push('');
      separateNextBlock = false;
    }

    output.push(line);
  });

  if (!replaced) return body;

  while (output.length > 0 && output[0].trim() === '') output.shift();
  while (output.length > 0 && output[output.length - 1].trim() === '') output.pop();
  return output.join('\n');
};

export const hasMindroomToolMarkerLines = (body: string): boolean => {
  if (!body.includes(TOOL_MARKER_ICON)) return false;

  let found = false;
  scanToolMarkerLines(splitLines(body), (_line, toolRef) => {
    found = !!toolRef;
    return !found;
  });
  return found;
};

export const stripMindroomToolMarkerLines = (body: string): string =>
  replaceToolMarkerLines(body, () => []);

// Keep indentation inside previews; only drop surrounding blank lines.
const asTraceCodeText = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const lines = splitLines(value);
  while (lines[0].trim() === '') lines.shift();
  while (lines[lines.length - 1].trim() === '') lines.pop();
  return lines.map((line) => line.trimEnd()).join('\n');
};

const toFencedCodeBlock = (text: string): string[] => {
  const longestBacktickRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(Math.max(3, longestBacktickRun + 1));
  return [fence, ...text.split('\n'), fence];
};

// The copied Markdown stays English so pasted transcripts read the same
// regardless of the copier's interface language.
const formatToolCallMarkdown = (
  toolRef: MindroomToolRefParseResult,
  event: MindroomToolTraceEvent | undefined
): string[] => {
  const toolName = asTraceText(event?.tool_name) ?? toolRef.toolName;
  const argsPreview = asTraceCodeText(event?.args_preview);
  const resultPreview = asTraceCodeText(event?.result_preview);
  const traceType = asTraceText(event?.type);

  const notes: string[] = [];
  if (
    traceType === 'tool_call_started' ||
    (traceType !== 'tool_call_completed' && toolRef.pending)
  ) {
    notes.push('running');
  }
  if (!event) notes.push('details unavailable');
  if (event?.truncated === true) notes.push('preview truncated');

  const heading = `**${TOOL_MARKER_ICON} Tool call ${toolRef.index}${
    notes.length > 0 ? ` (${notes.join(', ')})` : ''
  }**`;
  const command = argsPreview ? `${toolName}(${argsPreview})` : toolName;
  const lines = [heading, '', ...toFencedCodeBlock(command)];
  if (resultPreview) lines.push('', 'Result:', '', ...toFencedCodeBlock(resultPreview));
  return lines;
};

export const expandMindroomToolMarkerLines = (
  body: string,
  toolTraceEvents: MindroomToolTraceEvent[] | undefined
): string =>
  replaceToolMarkerLines(body, (toolRef) =>
    formatToolCallMarkdown(toolRef, toolTraceEvents?.[toolRef.index - 1])
  );
