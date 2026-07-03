import { MsgType } from 'matrix-js-sdk';
import { trimReplyFromBody } from '../../utils/room';
import { isVoiceMessageContent } from '../../utils/voiceMessage';
import { hasLikelyIncompleteStreamingBody } from './threadEditBackfill';

export const VOICE_MESSAGE_PREVIEW_TEXT = 'Voice message';

// MindRoom serializes each tool call into the plain-text body as
// "🔨 `tool_name` [n]" (the [n] references io.mindroom.tool_trace events).
const TOOL_CALL_MARKER_REGEX = /🔨\s*`[^`\n]+`(?:\s*\[\d+\])?/gu;

const ORPHAN_SEPARATOR_EDGE_REGEX = /^[\s,;:·|]+|[\s,;:·|]+$/gu;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const formatToolCallSummary = (count: number): string =>
  `🔧 ${count} ${count === 1 ? 'tool' : 'tools'}`;

// One-line previews render markdown source as-is, so strip the syntax down to
// its text. Underscore emphasis (_x_, __x__) is intentionally left alone: in
// agent chat bare underscores are far more likely to be identifiers like
// snake_case or __init__ than emphasis, and LLM output uses asterisks.
export const stripPreviewMarkdown = (value: string): string =>
  value
    .replace(/^```.*$/gm, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^\n]+?)\*\*/g, '$1')
    .replace(/(^|[^\w*])\*([^\s*](?:[^*\n]*?[^\s*])?)\*(?![\w*])/g, '$1$2')
    .replace(/~~([^~\n]+)~~/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*(?:>\s?)+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d{1,3}[.)]\s+/gm, '')
    .replace(/^\s*(?:[-*_]\s*){3,}\s*$/gm, ' ');

const normalizeBodyPreview = (body: unknown): string | undefined => {
  if (typeof body !== 'string') return undefined;

  const withoutReply = trimReplyFromBody(body);
  const toolCallCount = withoutReply.match(TOOL_CALL_MARKER_REGEX)?.length ?? 0;
  const withoutToolMarkers =
    toolCallCount > 0 ? withoutReply.replace(TOOL_CALL_MARKER_REGEX, ' ') : withoutReply;
  const prose = stripPreviewMarkdown(withoutToolMarkers).replace(/\s+/g, ' ').trim();

  if (toolCallCount > 0) {
    const cleanedProse = prose.replace(ORPHAN_SEPARATOR_EDGE_REGEX, '');
    // Downstream streaming-repair checks (compactThreadRootData,
    // threadOverviewCacheHydration) run hasLikelyIncompleteStreamingBody on
    // this preview text; prefixing the badge would hide the "Thinking" prefix
    // they match on, so pass the placeholder through unbadged.
    if (hasLikelyIncompleteStreamingBody(cleanedProse)) return cleanedProse;
    return /[\p{L}\p{N}]/u.test(cleanedProse)
      ? `${formatToolCallSummary(toolCallCount)} · ${cleanedProse}`
      : formatToolCallSummary(toolCallCount);
  }

  return prose.length > 0 ? prose : undefined;
};

const getMediaFallbackPreviewText = (content: Record<string, unknown>): string | undefined => {
  switch (content.msgtype) {
    case MsgType.Audio:
      return isVoiceMessageContent(content) ? VOICE_MESSAGE_PREVIEW_TEXT : 'Audio';
    case MsgType.Image:
      return 'Image';
    case MsgType.Video:
      return 'Video';
    case MsgType.File:
      return 'File';
    default:
      return undefined;
  }
};

export const getThreadMessagePreviewText = (
  content: Record<string, unknown> | null | undefined
): string | undefined => {
  if (!content || !isRecord(content)) return undefined;

  const newContent = isRecord(content['m.new_content'])
    ? (content['m.new_content'] as Record<string, unknown>)
    : undefined;
  const previewContent = newContent ? { ...content, ...newContent } : content;

  if (previewContent.msgtype === MsgType.Audio && isVoiceMessageContent(previewContent)) {
    return VOICE_MESSAGE_PREVIEW_TEXT;
  }

  const bodyPreview = normalizeBodyPreview(previewContent.body);
  if (bodyPreview) return bodyPreview;

  return getMediaFallbackPreviewText(previewContent);
};
