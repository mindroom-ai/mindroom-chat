import { EventType, RelationType, type EventTimelineSet, type MatrixEvent } from 'matrix-js-sdk';
import { getSyncedEdit } from '../matrix/client/syncedEdits';
import { isMindroomAgentUserId } from '../matrix/protocol/agentIdentity';
import {
  getAiRunInfo,
  getStreamStatusFromContent,
  isFinishedAgentReply,
} from '../matrix/protocol/aiRun';
import { getAiRunCompactModelLabel } from '../matrix/protocol/aiRunModelLabel';
import {
  INTERACTIVE_INSTRUCTION_TEXT,
  readInteractiveQuestion,
  type InteractiveQuestion,
} from '../matrix/protocol/interactiveQuestion';
import { getCachedLongTextContent, getLongTextSource } from '../matrix/protocol/longText';
import { getThreadSummaryInfo, hasThreadSummary } from '../matrix/protocol/threadSummary';
import { getEditedEvent, getLatestMessageContent } from '../matrix/room';
import { matchesEnum } from '../lib/matchesEnum';
import { inSameDay } from '../lib/time';
import { estimateThreadEventRowHeight } from '../event-store/threads/threadRenderUtils';
import { startsAuthorGroup } from './timelineRowFold';
import {
  getTimelineMessageKind,
  MEDIA_MAX_SIZE,
  NOTICE_STATE_EVENT_TYPES,
} from '../event-store/timeline/timelineRowTypes';

/*
 * Pre-mount timeline row height estimates derived from CSS / component invariants:
 * Folds T400 (22 px), MessageBase (8 px padding + 16 px group margin), SenderLine (22/44 px),
 * ModelBadge column (94/114 px), CodeBlock (16-line/80-char collapse to 18em = 270 px),
 * ScrollableTable (17 px row chrome + wrapped cells + 66 px narrow wide-table controls),
 * Reasoning / FinishedWorkFold (28 px), ToolCallsFold cog (26/36 px), QuestionCard, DayDivider (34 px).
 */
const LINE_PX = 22;
const ROW_BASE_PX = { compact: 6, comfortable: 8 } as const;
const FOLDED_LINES = 9;
const MAX_LINES = 240;
const WRAP_CHARS = 48;
const MIN_WRAP_CHARS = 24;
const COLUMN_CHROME_WIDTH_PX = 80; // padding 32 + avatar 36 + gap 12
const CHAR_WIDTH_PX = 8;

/** Characters per wrapped line for a timeline scroll container width; falls back to `WRAP_CHARS`. */
export const columnWrapCharsForWidth = (widthPx: number | undefined): number =>
  widthPx && widthPx > 0
    ? Math.max(MIN_WRAP_CHARS, Math.floor((widthPx - COLUMN_CHROME_WIDTH_PX) / CHAR_WIDTH_PX))
    : WRAP_CHARS;
export const roomWrapCharsForWidth = columnWrapCharsForWidth;

const CODE_COLLAPSE_LINES = 16;
const CODE_COLLAPSE_WRAP = 80;
const CODE_COLLAPSED_BODY_PX = 270; // 18em at 15 px T400
const CODE_LINE_PX = 19.5; // 13 px * 1.5 line-height
const TABLE_ROW_CHROME_PX = 17; // 8 px top + 8 px bottom padding + 1 px border
const TABLE_CELL_WRAP_CHARS = 44; // max-width: 24rem minus horizontal padding
const BLOCK_GAP_LINES = 0.4; // MarginSpaced S200 (8 px)
const HEADER_EXTRA_PX = { fine: 38, coarse: 60 } as const; // 16 px marginTop + 22/44 px SenderLine
const AUTHOR_MIN_PX = { fine: 68, coarse: 90 } as const;
const MODEL_BADGE_MIN_PX = { fine: 94, coarse: 114 } as const;
const REASONING_OR_WORK_PX = 28;
const TOOL_COG_PX = { fine: 26, coarse: 36 } as const;
const TOOL_ROW_PX = 38;
const STATE_ROW_PX = 28;
const DAY_DIVIDER_PX = 34;
const THREAD_BADGE_PX = 31;
const MEDIA_FALLBACK_PX = 240;
const FILE_CARD_PX = 56;

const BLOCK_MARKUP = /<(pre|ul|ol|table|blockquote|h[1-6])\b/i;
const CODE_BLOCK = /<pre\b[^>]*>([\s\S]*?)<\/pre>/gi;
const TABLE_BLOCK = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
const TABLE_ROW_BLOCK = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
const TABLE_CELL = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
const BLOCK_END = /<\/(p|li|h[1-6]|blockquote|div|dt|dd)>|<br\s*\/?>/gi;
const BLOCK_START = /<(p|ul|ol|table|blockquote|h[1-6])\b/gi;
const PARAGRAPH_START = /<p\b/gi;
const ANY_TAG = /<[^>]+>/g;
const HTML_ENTITY = /&(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);/gi;
const TOOL_REF_HTML_G = /🔧 <code>[^<]+<\/code> \[\d+\](?: ⏳)?/g;
const TOOL_REF_TEXT_LINE = /^\s*🔧\s+`[^`]+`\s+\[\d+\](?:\s+⏳)?\s*$/u;
const MEDIA_TAG = /<(?:img|video|audio)\b/i;
const EMPTY_PARAGRAPH = /<p\b[^>]*>[\s]*(?:<br\s*\/?>[\s]*)*<\/p>/gi;
const LEADING_TAIL_TRIVIA = /^(?:[\s]+|<br\s*\/?>|<\/p>)+/i;
const NON_CUTTABLE_CLOSE = /^[\s]*(?:<br\s*\/?>[\s]*)*<\/(?:li|blockquote|h[1-6]|td|th)>/i;

const decodeEntityLen = (text: string): string => text.replace(HTML_ENTITY, 'x');
const hasVisibleHtml = (html: string): boolean =>
  html.replace(ANY_TAG, '').trim() !== '' || MEDIA_TAG.test(html);

const wrappedLines = (text: string, wrapChars = WRAP_CHARS): number =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .reduce((lines, line) => lines + Math.ceil(line.length / wrapChars), 0);

const estimateCodeBlockPx = (rawCode: string, wrapChars: number, coarse: boolean): number => {
  const lines = decodeEntityLen(rawCode.replace(ANY_TAG, '')).replace(/\n$/, '').split('\n');
  let logical = 0;
  for (const line of lines) {
    logical += Math.max(1, Math.ceil(line.length / CODE_COLLAPSE_WRAP));
    if (logical > CODE_COLLAPSE_LINES) return (coarse ? 53 : 36) + CODE_COLLAPSED_BODY_PX;
  }
  const codeWrap = Math.max(MIN_WRAP_CHARS, wrapChars - 2);
  const rendered = lines.reduce((n, line) => n + Math.max(1, Math.ceil(line.length / codeWrap)), 0);
  return (coarse ? 71 : 52) + rendered * CODE_LINE_PX;
};

const estimateTablePx = (tableHtml: string, wrapChars: number): number => {
  let px = 0;
  let maxCols = 0;
  for (const rowMatch of tableHtml.matchAll(TABLE_ROW_BLOCK)) {
    let cols = 0;
    let rowLines = 1;
    for (const cellMatch of (rowMatch[1] ?? '').matchAll(TABLE_CELL)) {
      cols += 1;
      const cellText = decodeEntityLen((cellMatch[1] ?? '').replace(BLOCK_END, '\n').replace(ANY_TAG, ''));
      rowLines = Math.max(rowLines, wrappedLines(cellText, TABLE_CELL_WRAP_CHARS));
    }
    maxCols = Math.max(maxCols, cols);
    px += TABLE_ROW_CHROME_PX + rowLines * LINE_PX;
  }
  return px + (wrapChars < 55 && maxCols >= 3 ? 66 : 0);
};

const estimateRichHtmlPx = (html: string, wrapChars: number, coarse: boolean): number | undefined => {
  if (!BLOCK_MARKUP.test(html)) return undefined;
  let codePx = 0;
  let tablePx = 0;
  let extraBlocks = 0;
  const prose = html
    .replace(CODE_BLOCK, (_m, code: string) => {
      codePx += estimateCodeBlockPx(code, wrapChars, coarse);
      extraBlocks += 1;
      return '\n';
    })
    .replace(TABLE_BLOCK, (_m, tableHtml: string) => {
      tablePx += estimateTablePx(tableHtml, wrapChars);
      extraBlocks += 1;
      return '\n';
    });
  const blocks = (prose.match(BLOCK_START)?.length ?? 0) + extraBlocks;
  const textLines = wrappedLines(decodeEntityLen(prose.replace(BLOCK_END, '\n').replace(ANY_TAG, '')), wrapChars);
  return Math.round(codePx + tablePx + (textLines + Math.max(0, blocks - 1) * BLOCK_GAP_LINES) * LINE_PX);
};

const estimateHtmlFragmentPx = (html: string, wrapChars: number, coarse: boolean): number => {
  const rich = estimateRichHtmlPx(html, wrapChars, coarse);
  if (rich !== undefined) return rich;
  const lines = wrappedLines(decodeEntityLen(html.replace(BLOCK_END, '\n').replace(ANY_TAG, '')), wrapChars);
  if (lines === 0) return 0;
  const blocks = html.match(PARAGRAPH_START)?.length ?? 0;
  return Math.round((lines + Math.max(0, blocks - 1) * BLOCK_GAP_LINES) * LINE_PX);
};

const richHeights = new WeakMap<object, { wrapChars: number; coarse: boolean; height: number | undefined }>();

/**
 * Height of a message's HTML when it has block structure (code, lists, tables, quotes, headings),
 * before any folding; undefined for plain text and inline-only HTML.
 */
export const estimateFormattedBodyPx = (
  content: unknown,
  wrapChars = WRAP_CHARS,
  coarsePointer = false
): number | undefined => {
  if (!content || typeof content !== 'object') return undefined;
  const cached = richHeights.get(content);
  if (cached && cached.wrapChars === wrapChars && cached.coarse === coarsePointer) return cached.height;
  const fields = content as Record<string, unknown>;
  const html = fields.format === 'org.matrix.custom.html' ? fields.formatted_body : undefined;
  const height = typeof html === 'string' ? estimateRichHtmlPx(html, wrapChars, coarsePointer) : undefined;
  richHeights.set(content, { wrapChars, coarse: coarsePointer, height });
  return height;
};

const hasLongTextTag = (content: Record<string, unknown> | undefined): boolean => {
  if (!content) return false;
  if (content['io.mindroom.long_text'] !== undefined) return true;
  const nc = content['m.new_content'];
  return !!nc && typeof nc === 'object' && (nc as Record<string, unknown>)['io.mindroom.long_text'] !== undefined;
};

const estimateMediaPx = (content: Record<string, unknown>, type: string): number | undefined => {
  const msgtype = type === 'm.sticker' ? 'm.image' : content.msgtype;
  if (msgtype === 'm.file' && hasLongTextTag(content)) return undefined;
  if (msgtype === 'm.file' || msgtype === 'm.audio') return FILE_CARD_PX;
  if (msgtype !== 'm.image' && msgtype !== 'm.video') return undefined;
  const info = content.info as { w?: unknown; h?: unknown } | undefined;
  const w = typeof info?.w === 'number' && info.w > 0 ? info.w : undefined;
  const h = typeof info?.h === 'number' && info.h > 0 ? info.h : undefined;
  if (!w || !h) return MEDIA_FALLBACK_PX;
  return Math.round(h * Math.min(1, MEDIA_MAX_SIZE.width / w, MEDIA_MAX_SIZE.height / h));
};

const hasReasoning = (content: Record<string, unknown>): boolean => {
  const live = content['io.mindroom.live_reasoning'];
  if (typeof live === 'string' && live.trim() !== '') return true;
  const final = content['io.mindroom.reasoning'] as { text?: unknown } | undefined;
  return typeof final?.text === 'string' && final.text.trim() !== '';
};

type ToolWorkSplit =
  | { kind: 'none' }
  | { kind: 'folded'; tailHtml?: string; tailBody?: string }
  | { kind: 'markers'; toolCount: number; cleanedHtml?: string; cleanedBody: string };

const analyzeAgentToolWork = (
  html: string | undefined,
  body: string,
  finished: boolean
): ToolWorkSplit => {
  if (html !== undefined && html.includes('🔧')) {
    const searchable = html.includes('<pre') ? html.replace(CODE_BLOCK, (m) => ' '.repeat(m.length)) : html;
    let toolCount = 0;
    let lastStart = -1;
    let lastEnd = -1;
    TOOL_REF_HTML_G.lastIndex = 0;
    for (let m = TOOL_REF_HTML_G.exec(searchable); m; m = TOOL_REF_HTML_G.exec(searchable)) {
      toolCount += 1;
      lastStart = m.index;
      lastEnd = m.index + m[0].length;
    }
    if (toolCount === 0) return { kind: 'none' };
    if (finished && !NON_CUTTABLE_CLOSE.test(html.slice(lastEnd))) {
      const tailHtml = html.slice(lastEnd).replace(LEADING_TAIL_TRIVIA, '');
      if (hasVisibleHtml(html.slice(0, lastStart).replace(TOOL_REF_HTML_G, '')) && hasVisibleHtml(tailHtml)) {
        return { kind: 'folded', tailHtml };
      }
    }
    const cleanedHtml = (
      html.includes('<pre')
        ? html
            .split(/(<pre\b[^>]*>[\s\S]*?<\/pre>)/gi)
            .map((part, idx) => (idx % 2 === 1 ? part : part.replace(TOOL_REF_HTML_G, '')))
            .join('')
        : html.replace(TOOL_REF_HTML_G, '')
    ).replace(EMPTY_PARAGRAPH, '');
    return { kind: 'markers', toolCount, cleanedHtml, cleanedBody: body };
  }
  if (!body.includes('🔧')) return { kind: 'none' };
  const lines = body.split('\n');
  let toolCount = 0;
  let lastIdx = -1;
  lines.forEach((line, idx) => {
    if (TOOL_REF_TEXT_LINE.test(line)) {
      toolCount += 1;
      lastIdx = idx;
    }
  });
  if (toolCount === 0) return { kind: 'none' };
  if (finished) {
    const headVisible = lines.slice(0, lastIdx).some((l) => l.trim() !== '' && !TOOL_REF_TEXT_LINE.test(l));
    const tailBody = lines.slice(lastIdx + 1).join('\n').trim();
    if (headVisible && tailBody !== '') return { kind: 'folded', tailBody };
  }
  return { kind: 'markers', toolCount, cleanedBody: lines.filter((l) => !TOOL_REF_TEXT_LINE.test(l)).join('\n') };
};

const estimateQuestionCardDeltaPx = (
  question: InteractiveQuestion,
  body: string,
  html: string | undefined,
  wrapChars: number
): number => {
  const optWrap = Math.max(20, wrapChars - 8);
  let optionsPx = 0;
  let fallbackOptLines = 0;
  for (const opt of question.options) {
    optionsPx += 20 + Math.max(1, wrappedLines(opt.label, optWrap)) * 21;
    fallbackOptLines += Math.max(1, wrappedLines(`${opt.key} ${opt.label}`, wrapChars));
  }
  if (!body.includes(INTERACTIVE_INSTRUCTION_TEXT) && !html?.includes(INTERACTIVE_INSTRUCTION_TEXT)) {
    return 30 + optionsPx;
  }
  const qLines = Math.max(1, wrappedLines(question.text, Math.max(20, wrapChars - 6)));
  const fallbackLines =
    Math.max(1, wrappedLines(question.text, wrapChars)) +
    fallbackOptLines +
    Math.max(1, wrappedLines(INTERACTIVE_INSTRUCTION_TEXT, wrapChars));
  const fallbackPx = fallbackLines * LINE_PX + Math.round(2 * BLOCK_GAP_LINES * LINE_PX);
  return Math.max(0, 34 + qLines * LINE_PX + optionsPx - fallbackPx);
};

export type MessageRowEstimateOptions = {
  compact: boolean;
  wrapChars?: number;
  coarsePointer?: boolean;
  showToolCalls?: boolean;
  timelineSet?: Pick<EventTimelineSet, 'relations'>;
  editedEvent?: MatrixEvent;
  longTextCacheOwner?: object;
};

const priceMessageRow = (
  event: MatrixEvent,
  content: Record<string, unknown>,
  compact: boolean,
  wrapChars: number,
  coarse: boolean,
  showToolCalls: boolean
): number => {
  const relation = event.getRelation()?.rel_type;
  if (relation === RelationType.Replace || relation === RelationType.Annotation) return 0;
  const base = compact ? ROW_BASE_PX.compact : ROW_BASE_PX.comfortable;
  if (getThreadSummaryInfo(content)?.summaryText) return base + LINE_PX;
  const mediaPx = estimateMediaPx(content, event.getType());
  if (mediaPx !== undefined) return base + mediaPx;

  const isAgent = isMindroomAgentUserId(event.getSender() ?? undefined);
  const inFull = isAgent || hasThreadSummary(content);
  const html =
    content.format === 'org.matrix.custom.html' && typeof content.formatted_body === 'string'
      ? content.formatted_body
      : undefined;
  const body = typeof content.body === 'string' ? content.body : '';
  const textPx = (src: Record<string, unknown>) =>
    Math.max(0, estimateThreadEventRowHeight(event, { compact, wrapChars, content: src, showsInFull: inFull }) - base);

  let innerPx: number;
  const work = isAgent
    ? analyzeAgentToolWork(html, body, isFinishedAgentReply(content))
    : ({ kind: 'none' } as const);
  if (work.kind === 'folded') {
    const tailPx =
      work.tailHtml !== undefined
        ? estimateHtmlFragmentPx(work.tailHtml, wrapChars, coarse)
        : work.tailBody
          ? textPx({ msgtype: 'm.text', body: work.tailBody })
          : 0;
    innerPx = REASONING_OR_WORK_PX + tailPx;
  } else if (work.kind === 'markers') {
    const reasoning = hasReasoning(content);
    const cleanedPx =
      work.cleanedHtml !== undefined
        ? estimateHtmlFragmentPx(work.cleanedHtml, wrapChars, coarse)
        : work.cleanedBody.trim()
          ? textPx({ msgtype: 'm.text', body: work.cleanedBody })
          : 0;
    const controlsPx = showToolCalls
      ? (reasoning ? REASONING_OR_WORK_PX : 0) + work.toolCount * TOOL_ROW_PX
      : reasoning
        ? REASONING_OR_WORK_PX
        : coarse
          ? TOOL_COG_PX.coarse
          : TOOL_COG_PX.fine;
    innerPx = controlsPx + cleanedPx;
  } else {
    const bodyPx = estimateFormattedBodyPx(content, wrapChars, coarse) ?? textPx(content);
    innerPx = (isAgent && hasReasoning(content) ? REASONING_OR_WORK_PX : 0) + bodyPx;
  }

  const question = isAgent
    ? readInteractiveQuestion(content, event.getOriginalContent?.<Record<string, unknown>>())
    : undefined;
  if (question) innerPx += estimateQuestionCardDeltaPx(question, body, html, wrapChars);

  return base + Math.min(innerPx, (inFull ? MAX_LINES : FOLDED_LINES) * LINE_PX);
};

type RowEstimate = {
  rawContent: object;
  keyCount: number;
  editedEvent: MatrixEvent | undefined;
  editContent: object | undefined;
  editKeyCount: number;
  bundledEdit: unknown;
  hydratedContent: object | undefined;
  compact: boolean;
  wrapChars: number;
  coarse: boolean;
  showToolCalls: boolean;
  px: number;
  ownRun: boolean;
  hasModelBadge: boolean;
  isSummaryMarker: boolean;
};

/** Checked before `getLatestMessageContent` / regex work so unchanged renders do zero allocation. */
const rowEstimates = new WeakMap<MatrixEvent, RowEstimate>();

const hasRelationEdits = (
  eventId: string | undefined,
  event: MatrixEvent,
  timelineSet: Pick<EventTimelineSet, 'relations'> | undefined
): boolean => {
  if (!eventId || !timelineSet?.relations) return false;
  if (timelineSet.relations.getChildEventsForEvent(eventId, RelationType.Replace, EventType.RoomMessage)) {
    return true;
  }
  const type = event.getType();
  return (
    !matchesEnum(type, EventType.RoomMessage) &&
    !!timelineSet.relations.getChildEventsForEvent(eventId, RelationType.Replace, type)
  );
};

const resolveRowEstimate = (
  event: MatrixEvent,
  {
    compact,
    wrapChars = WRAP_CHARS,
    coarsePointer: coarse = false,
    showToolCalls = false,
    timelineSet,
    editedEvent: explicitEdit,
    longTextCacheOwner,
  }: MessageRowEstimateOptions
): RowEstimate => {
  const raw = event.getContent<Record<string, unknown>>();
  const rawContent = raw && typeof raw === 'object' ? raw : {};
  const keyCount = Object.keys(rawContent).length;

  let editedEvent: MatrixEvent | undefined = explicitEdit;
  let bundledEdit: unknown;
  if (explicitEdit === undefined) {
    const eventId = event.getId();
    if (event.replacingEvent?.() || hasRelationEdits(eventId, event, timelineSet) || (eventId && getSyncedEdit(eventId))) {
      editedEvent = getEditedEvent(eventId ?? '', event, timelineSet);
    } else {
      const rels = event.getUnsigned?.()?.['m.relations'];
      bundledEdit = rels && typeof rels === 'object' ? (rels as Record<string, unknown>)[RelationType.Replace] : undefined;
    }
  }

  const rawEdit = editedEvent?.getContent<Record<string, unknown>>();
  const editContent = rawEdit && typeof rawEdit === 'object' ? rawEdit : undefined;
  const editKeyCount = editContent ? Object.keys(editContent).length : 0;
  let hydratedContent: Record<string, unknown> | undefined;
  if (longTextCacheOwner && (hasLongTextTag(rawContent) || hasLongTextTag(editContent))) {
    const source = getLongTextSource(editContent ?? rawContent);
    if (source) hydratedContent = getCachedLongTextContent(source, longTextCacheOwner);
  }

  const known = rowEstimates.get(event);
  if (
    known &&
    known.rawContent === rawContent &&
    known.keyCount === keyCount &&
    known.editedEvent === editedEvent &&
    known.editContent === editContent &&
    known.editKeyCount === editKeyCount &&
    known.bundledEdit === bundledEdit &&
    known.hydratedContent === hydratedContent &&
    known.compact === compact &&
    known.wrapChars === wrapChars &&
    known.coarse === coarse &&
    known.showToolCalls === showToolCalls
  ) {
    return known;
  }

  const effectiveEdit =
    editedEvent ?? (bundledEdit !== undefined ? getEditedEvent(event.getId() ?? '', event, timelineSet) : undefined);
  const baseContent = effectiveEdit
    ? (getLatestMessageContent(event, effectiveEdit) as Record<string, unknown>)
    : rawContent;
  const content = hydratedContent ? { ...baseContent, ...hydratedContent } : baseContent;
  const px = priceMessageRow(event, content, compact, wrapChars, coarse, showToolCalls);
  const aiRun = getAiRunInfo(content);
  const entry: RowEstimate = {
    rawContent,
    keyCount,
    editedEvent,
    editContent,
    editKeyCount,
    bundledEdit,
    hydratedContent,
    compact,
    wrapChars,
    coarse,
    showToolCalls,
    px,
    ownRun: !!aiRun || (isMindroomAgentUserId(event.getSender()) && !!getStreamStatusFromContent(content)),
    hasModelBadge: !!aiRun && !!getAiRunCompactModelLabel(aiRun),
    isSummaryMarker: !!getThreadSummaryInfo(content)?.summaryText,
  };
  rowEstimates.set(event, entry);
  return entry;
};

const addRowChrome = (
  entry: RowEstimate,
  event: MatrixEvent,
  above: MatrixEvent | undefined,
  compact: boolean,
  coarse: boolean
): number => {
  const dayPx = above && !inSameDay(above.getTs(), event.getTs()) ? DAY_DIVIDER_PX : 0;
  if (compact || entry.isSummaryMarker || (!startsAuthorGroup(above, event) && !entry.ownRun)) {
    return entry.px + dayPx;
  }
  const minPx = entry.hasModelBadge
    ? coarse
      ? MODEL_BADGE_MIN_PX.coarse
      : MODEL_BADGE_MIN_PX.fine
    : coarse
      ? AUTHOR_MIN_PX.coarse
      : AUTHOR_MIN_PX.fine;
  return Math.max(minPx, entry.px + (coarse ? HEADER_EXTRA_PX.coarse : HEADER_EXTRA_PX.fine)) + dayPx;
};

/** A message row's height without an author header; edits and reactions stay at zero. */
export const estimateMessageRowHeight = (event: MatrixEvent, options: MessageRowEstimateOptions): number =>
  resolveRowEstimate(event, options).px;

/** A thread row: body height plus non-compact author header, ModelBadge floor, and day divider. */
export const estimateThreadRowHeight = (
  event: MatrixEvent,
  above: MatrixEvent | undefined,
  options: MessageRowEstimateOptions
): number => {
  const entry = resolveRowEstimate(event, options);
  return entry.px === 0 ? 0 : addRowChrome(entry, event, above, options.compact, options.coarsePointer ?? false);
};

/** A room row in Modern/Bubble layout: state notices, messages with header/ModelBadge/badge/day divider. */
export const estimateRoomRowHeight = (
  event: MatrixEvent,
  above: MatrixEvent | undefined,
  { threadBadge = false, ...rest }: Omit<MessageRowEstimateOptions, 'compact'> & { threadBadge?: boolean } = {}
): number => {
  const type = event.getType();
  if (event.getStateKey() !== undefined) return NOTICE_STATE_EVENT_TYPES.has(type) ? STATE_ROW_PX : 0;
  if (!getTimelineMessageKind(type)) return 0;
  const entry = resolveRowEstimate(event, { ...rest, compact: false });
  if (entry.px === 0) return 0;
  return addRowChrome(entry, event, above, false, rest.coarsePointer ?? false) + (threadBadge ? THREAD_BADGE_PX : 0);
};
