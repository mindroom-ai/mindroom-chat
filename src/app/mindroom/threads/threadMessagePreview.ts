import { MsgType } from 'matrix-js-sdk';
import type { TFunction } from 'i18next';
import { trimReplyFromBody } from '../../utils/room';
import { isVoiceMessageContent } from '../../utils/voiceMessage';
import { hasLikelyIncompleteStreamingBody } from './threadEditBackfill';

export const VOICE_MESSAGE_PREVIEW_TEXT = 'Voice message';

// MindRoom serializes each tool call into the plain-text body as a
// standalone "🔧 `tool_name` [n]" line, with a trailing ⏳ while the call is
// still running (mindroom tool_system/events.py). Mirror the whole-line,
// index-required shape of MINDROOM_TOOL_REF_TEXT_REG in ../messages/blocks.ts
// so the badge only collapses what the timeline renders as a tool ref — a
// wrench + code span in ordinary prose stays prose.
const TOOL_CALL_MARKER_REGEX =
  /^[^\S\n]*🔧[^\S\n]*`[^`\n]+`[^\S\n]*\[\d+\](?:[^\S\n]*⏳)?[^\S\n]*$/gmu;

// Bound the text fed to the regex pipeline below: previews render as a single
// truncated line, and unbounded pathological bodies (e.g. tens of KB of "[")
// make the label/emphasis passes quadratic. Markers are counted and removed
// on the full body first (that regex is line-anchored and linear).
const PREVIEW_SOURCE_MAX_LENGTH = 2000;

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
    // Destinations may contain one level of balanced parens, e.g.
    // https://en.wikipedia.org/wiki/Foo_(bar). The inner alternation consumes
    // one char or one balanced group per step (no ambiguity, no exponential
    // backtracking); PREVIEW_SOURCE_MAX_LENGTH bounds the quadratic worst
    // case of the label scans.
    .replace(/!\[([^\]]*)\]\((?:[^()\n]|\([^()\n]*\))*\)/g, '$1')
    .replace(/\[([^\]]+)\]\((?:[^()\n]|\([^()\n]*\))*\)/g, '$1')
    // Like the italic rule below, require non-word flanking so ** operators in
    // code (x**2 + y**2) are never paired as bold.
    .replace(/(^|[^\w*])\*\*([^\s*](?:[^\n]*?[^\s*])?)\*\*(?![\w*])/g, '$1$2')
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
  const boundedSource =
    withoutToolMarkers.length > PREVIEW_SOURCE_MAX_LENGTH
      ? // Drop a split-off lone high surrogate at the cut point.
        withoutToolMarkers.slice(0, PREVIEW_SOURCE_MAX_LENGTH).replace(/[\uD800-\uDBFF]$/, '')
      : withoutToolMarkers;
  const prose = stripPreviewMarkdown(boundedSource).replace(/\s+/g, ' ').trim();

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

export type ThreadPreviewLocalization =
  | { kind: 'voice' | 'audio' | 'image' | 'video' | 'file' }
  | { kind: 'tools'; count: number; prose: string };

/** Carry the origin of generated copy to the UI without translating user text or cached data. */
export const getThreadPreviewLocalization = (
  content: Record<string, unknown> | null | undefined,
  previewText: string | undefined
): ThreadPreviewLocalization | undefined => {
  if (!content || !previewText || getThreadMessagePreviewText(content) !== previewText)
    return undefined;
  const current = isRecord(content['m.new_content'])
    ? { ...content, ...content['m.new_content'] }
    : content;
  if (current.msgtype === MsgType.Audio && isVoiceMessageContent(current)) return { kind: 'voice' };
  const body = normalizeBodyPreview(current.body);
  if (!body) {
    switch (current.msgtype) {
      case MsgType.Audio:
        return { kind: 'audio' };
      case MsgType.Image:
        return { kind: 'image' };
      case MsgType.Video:
        return { kind: 'video' };
      case MsgType.File:
        return { kind: 'file' };
      default:
        return undefined;
    }
  }
  const count =
    typeof current.body === 'string'
      ? trimReplyFromBody(current.body).match(TOOL_CALL_MARKER_REGEX)?.length ?? 0
      : 0;
  const prefix = formatToolCallSummary(count);
  if (count > 0 && (body === prefix || body.startsWith(`${prefix} · `))) {
    return { kind: 'tools', count, prose: body.slice(prefix.length + 3) };
  }
  return undefined;
};

export const localizeThreadPreview = (
  text: string | undefined,
  localization: ThreadPreviewLocalization | undefined,
  t?: TFunction
): string | undefined => {
  if (!localization || !t) return text;
  switch (localization.kind) {
    case 'voice':
      return t('sharedUi.threadPreviews.voiceMessage');
    case 'audio':
      return t('mindroomUi.message-search.searchResultPreview.audio');
    case 'image':
      return t('mindroomUi.message-search.searchResultPreview.image');
    case 'video':
      return t('mindroomUi.message-search.searchResultPreview.video');
    case 'file':
      return t('mindroomUi.message-search.searchResultPreview.file');
    case 'tools': {
      const badge = `🔧 ${t('sharedUi.threadPreviews.tools', { count: localization.count })}`;
      return localization.prose ? `${badge} · ${localization.prose}` : badge;
    }
    default:
      return text;
  }
};
