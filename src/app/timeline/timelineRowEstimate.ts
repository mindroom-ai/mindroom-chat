import { RelationType, type MatrixEvent } from 'matrix-js-sdk';
import { isMindroomAgentUserId } from '../matrix/protocol/agentIdentity';
import { hasMessageExtras } from '../matrix/protocol/messageExtrasData';
import { hasThreadSummary } from '../matrix/protocol/threadSummary';
import { inSameDay } from '../lib/time';
import { estimateThreadEventRowHeight } from '../event-store/threads/threadRenderUtils';
import { startsAuthorGroup } from './timelineRowFold';
import {
  getTimelineMessageKind,
  MEDIA_MAX_SIZE,
  NOTICE_STATE_EVENT_TYPES,
} from '../event-store/timeline/timelineRowTypes';

/*
 * Heights a timeline row is given before it is measured. A row priced far from its real height
 * moves the rows around it when it mounts, so the estimates follow what the row will show: the
 * text estimate of threadRenderUtils, rich HTML (code blocks, lists, tables) and media sized by
 * their content, and in the room the author line that starts each group of messages.
 */

/** One line of message text; the text estimate counts lines of this height. */
const LINE_PX = 20;
/** Room for padding above and below a row's text (thread text estimate, Modern layout). */
const ROW_BASE_PX = { compact: 6, comfortable: 10 } as const;
/** A folding message shows this many lines until it is expanded (11em). */
const FOLDED_LINES = 9;
/** No estimate grows past this many lines, however long the content. */
const MAX_LINES = 48;
/** Characters per wrapped line, as the text estimate counts them. */
const WRAP_CHARS = 48;
/** A code block's language bar and padding around its lines. */
const CODE_BLOCK_CHROME_PX = 50;
/** A table row's cell padding, in lines. */
const TABLE_ROW_LINES = 1.6;
/** The gap between two blocks of rich text, in lines. */
const BLOCK_GAP_LINES = 0.4;

/** The room's first message of a group: the avatar beside the author line sets its least height. */
const AUTHOR_ROW_MIN_PX = 68;
/** The author line above a group's first message. */
const AUTHOR_LINE_PX = 22;
/** A membership, name, topic or avatar change: one line of text. */
const STATE_ROW_PX = 28;
/** A date separator above the first message of a day. */
const DAY_DIVIDER_PX = 34;
/** The thread badge under a message of the threaded room view. */
const THREAD_BADGE_PX = 31;
/** Media without size information, and file or audio cards. */
const MEDIA_FALLBACK_PX = 240;
const FILE_CARD_PX = 56;
const BLOCK_MARKUP = /<(pre|ul|ol|table|blockquote|h[1-6])\b/i;
const CODE_BLOCK = /<pre\b[^>]*>([\s\S]*?)<\/pre>/gi;
const BLOCK_END = /<\/(p|li|h[1-6]|blockquote|div|dt|dd)>|<br\s*\/?>/gi;
const TABLE_ROW = /<tr\b/gi;
const BLOCK_START = /<(p|ul|ol|table|blockquote|h[1-6])\b/gi;
const ANY_TAG = /<[^>]+>/g;

const wrappedLines = (text: string): number =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .reduce((lines, line) => lines + Math.ceil(line.length / WRAP_CHARS), 0);

const richHeights = new WeakMap<object, number | undefined>();

/**
 * The height of a message's HTML when it has block structure (code, lists, tables, quotes,
 * headings), before any folding; undefined for plain text and inline-only HTML, which the text
 * estimate prices well.
 */
export const estimateFormattedBodyPx = (content: Record<string, unknown>): number | undefined => {
  if (richHeights.has(content)) return richHeights.get(content);
  const html = content.format === 'org.matrix.custom.html' ? content.formatted_body : undefined;
  let height: number | undefined;
  if (typeof html === 'string' && BLOCK_MARKUP.test(html)) {
    let codePx = 0;
    let codeBlocks = 0;
    const prose = html.replace(CODE_BLOCK, (_block, code: string) => {
      const codeLines = code.replace(ANY_TAG, '').replace(/\n$/, '').split('\n').length;
      codePx += CODE_BLOCK_CHROME_PX + codeLines * LINE_PX;
      codeBlocks += 1;
      return '\n';
    });
    const tableRows = prose.match(TABLE_ROW)?.length ?? 0;
    const blocks = (prose.match(BLOCK_START)?.length ?? 0) + codeBlocks;
    const text = prose.replace(/<\/(td|th)>/gi, ' ').replace(BLOCK_END, '\n');
    // Table cells share a line per row; the rest wraps like plain text.
    const textLines = wrappedLines(
      text.replace(/<tr\b[\s\S]*?<\/tr>/gi, '\n').replace(ANY_TAG, '')
    );
    const lines =
      textLines + tableRows * TABLE_ROW_LINES + Math.max(0, blocks - 1) * BLOCK_GAP_LINES;
    height = Math.round(codePx + lines * LINE_PX);
  }
  richHeights.set(content, height);
  return height;
};

/** Images and videos by their stated size, file and audio as a card; undefined for text. */
const estimateMediaPx = (content: Record<string, unknown>, type: string): number | undefined => {
  const msgtype = type === 'm.sticker' ? 'm.image' : content.msgtype;
  if (msgtype === 'm.file' || msgtype === 'm.audio') return FILE_CARD_PX;
  if (msgtype !== 'm.image' && msgtype !== 'm.video') return undefined;
  const info = content.info as { w?: unknown; h?: unknown } | undefined;
  const width = typeof info?.w === 'number' && info.w > 0 ? info.w : undefined;
  const height = typeof info?.h === 'number' && info.h > 0 ? info.h : undefined;
  if (!width || !height) return MEDIA_FALLBACK_PX;
  const scale = Math.min(1, MEDIA_MAX_SIZE.width / width, MEDIA_MAX_SIZE.height / height);
  return Math.round(height * scale);
};

/** Whether the message always shows in full: agent replies, summaries and tool traces. */
const showsInFull = (event: MatrixEvent, content: Record<string, unknown>): boolean =>
  isMindroomAgentUserId(event.getSender() ?? undefined) ||
  hasThreadSummary(content) ||
  hasMessageExtras(content);

/**
 * A message row's height without an author line: the text estimate, or the rich HTML or media
 * it shows when those are taller. Edits and reactions have no row and stay at zero.
 */
export const estimateMessageRowHeight = (
  event: MatrixEvent,
  { compact }: { compact: boolean }
): number => {
  const textPx = estimateThreadEventRowHeight(event, { compact });
  if (textPx === 0) return 0;
  const relation = event.getRelation()?.rel_type;
  if (relation === RelationType.Replace || relation === RelationType.Annotation) return 0;
  const content = event.getContent<Record<string, unknown>>();
  const base = compact ? ROW_BASE_PX.compact : ROW_BASE_PX.comfortable;
  const mediaPx = estimateMediaPx(content, event.getType());
  if (mediaPx !== undefined) return Math.max(textPx, base + mediaPx);
  const richPx = estimateFormattedBodyPx(content);
  if (richPx === undefined) return textPx;
  const capLines = showsInFull(event, content) ? MAX_LINES : FOLDED_LINES;
  return Math.max(textPx, base + Math.min(richPx, capLines * LINE_PX));
};

/**
 * A room row in the Modern or Bubble layout: state changes as a line or nothing, messages with
 * the author line that starts a group and the thread badge the threaded view puts under them,
 * and the date separator above a new day.
 */
export const estimateRoomRowHeight = (
  event: MatrixEvent,
  above: MatrixEvent | undefined,
  { threadBadge = false }: { threadBadge?: boolean } = {}
): number => {
  const type = event.getType();
  if (event.getStateKey() !== undefined)
    return NOTICE_STATE_EVENT_TYPES.has(type) ? STATE_ROW_PX : 0;
  if (!getTimelineMessageKind(type)) return 0;
  const bodyPx = estimateMessageRowHeight(event, { compact: false });
  if (bodyPx === 0) return 0;
  const rowPx = startsAuthorGroup(above, event)
    ? Math.max(AUTHOR_ROW_MIN_PX, bodyPx + AUTHOR_LINE_PX)
    : bodyPx;
  const newDay = !!above && !inSameDay(above.getTs(), event.getTs());
  return rowPx + (threadBadge ? THREAD_BADGE_PX : 0) + (newDay ? DAY_DIVIDER_PX : 0);
};
