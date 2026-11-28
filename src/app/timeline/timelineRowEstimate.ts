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
} from '../matrix/protocol/interactiveQuestion';
import {
  getCachedLongTextContent,
  getLongTextSource,
  type LongTextSource,
} from '../matrix/protocol/longText';
import { getThreadSummaryInfo, hasThreadSummary } from '../matrix/protocol/threadSummary';
import { sanitizeContent } from '../matrix/protocol/untrustedContent';
import { getEditedEvent, getLatestMessageContent } from '../matrix/room';
import { isRecord } from '../lib/isRecord';
import { matchesEnum } from '../lib/matchesEnum';
import { inSameDay } from '../lib/time';
import {
  estimateThreadEventRowHeight,
  THREAD_ROW_LINE_PX as LINE_PX,
  THREAD_ROW_MAX_ESTIMATED_LINES as MAX_LINES,
} from '../event-store/threads/threadRenderUtils';
import {
  getTimelineMessageKind,
  MEDIA_MAX_SIZE,
  NOTICE_STATE_EVENT_TYPES,
} from '../event-store/timeline/timelineRowTypes';
import {
  MINDROOM_TOOL_REF_HTML_REG_G as TOOL_REF_HTML_G,
  MINDROOM_TOOL_REF_ICON as TOOL_ICON,
  MINDROOM_TOOL_REF_TEXT_REG as TOOL_REF_TEXT,
} from '../messages/html/blocks';
import { startsAuthorGroup } from './timelineRowFold';

/* Pre-mount row height estimates from CSS/component invariants (Folds T400 22 px, MessageBase 8 px,
 * SenderLine 22/44 px, ModelBadge 94/114 px, CodeBlock 16-line collapse, ScrollableTable, folds). */
const WRAP_CHARS = 48;
const MIN_WRAP_CHARS = 24;
const BLOCK_GAP_LINES = 0.4;
const WORK_BAR_PX = 28;
const HEADER_EXTRA_PX = { fine: 38, coarse: 60 } as const;
const AUTHOR_MIN_PX = { fine: 68, coarse: 90 } as const;
const MODEL_BADGE_MIN_PX = { fine: 94, coarse: 114 } as const;

/** Characters per wrapped line for a timeline scroll container width; falls back to 48. */
export const columnWrapCharsForWidth = (widthPx: number | undefined): number =>
  widthPx && widthPx > 0 ? Math.max(MIN_WRAP_CHARS, Math.floor((widthPx - 80) / 8)) : WRAP_CHARS;

const CODE_BLOCK = /<pre\b[^>]*>([\s\S]*?)<\/pre>/gi;
const PRE_OR_TOOL = new RegExp(`(<pre\\b[^>]*>[\\s\\S]*?<\\/pre>)|${TOOL_REF_HTML_G.source}`, 'gi');
const FENCED_CODE = /^[ \t]{0,3}(`{3,}|~{3,})[^`\n]*\n([\s\S]*?)^[ \t]{0,3}\1[ \t]*$/gm;
const BLOCK_END = /<\/(p|li|h[1-6]|blockquote|div|dt|dd)>|<br\s*\/?>/gi;
const ANY_TAG = /<[^>]+>/g;

const decodeEntities = (s: string) => s.replace(/&(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);/gi, 'x');
const stripHtml = (s: string) => decodeEntities(s.replace(BLOCK_END, '\n').replace(ANY_TAG, ''));
const hasVisibleHtml = (s: string) =>
  s.replace(ANY_TAG, '').trim() !== '' || /<(?:img|video|audio)\b/i.test(s);
const recordOf = (v: unknown) => (isRecord(v) ? v : undefined);
const keysOf = (obj: Record<string, unknown> | undefined) => (obj ? Object.keys(obj).length : 0);
const sameItems = (a: readonly unknown[], b: readonly unknown[]) => a.every((v, i) => v === b[i]);

const wrappedLines = (text: string, wrapChars = WRAP_CHARS): number =>
  text.split('\n').reduce((n, raw) => {
    const len = raw.trim().length;
    return len > 0 ? n + Math.ceil(len / wrapChars) : n;
  }, 0);

const blocksPx = (extraPx: number, text: string, blocks: number, wrapChars: number) =>
  Math.round(
    extraPx + (wrappedLines(text, wrapChars) + Math.max(0, blocks - 1) * BLOCK_GAP_LINES) * LINE_PX
  );

const estimateCodeBlockPx = (plainCode: string, wrapChars: number, coarse: boolean): number => {
  const lines = plainCode.replace(/\n$/, '').split('\n');
  let logical = 0;
  for (const line of lines) {
    logical += Math.max(1, Math.ceil(line.length / 80));
    if (logical > 16) return (coarse ? 53 : 36) + 270;
  }
  const codeWrap = Math.max(MIN_WRAP_CHARS, wrapChars - 2);
  const rendered = lines.reduce((n, line) => n + Math.max(1, Math.ceil(line.length / codeWrap)), 0);
  return (coarse ? 71 : 52) + rendered * 19.5;
};

const estimateTablePx = (tableHtml: string, wrapChars: number): number => {
  let px = 0;
  let maxCols = 0;
  for (const row of tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    let cols = 0;
    let rowLines = 1;
    for (const cell of (row[1] ?? '').matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)) {
      cols += 1;
      rowLines = Math.max(rowLines, wrappedLines(stripHtml(cell[1] ?? ''), 44));
    }
    maxCols = Math.max(maxCols, cols);
    px += 17 + rowLines * LINE_PX;
  }
  return px + (wrapChars < 55 && maxCols >= 3 ? 66 : 0);
};

const estimateRichHtmlPx = (
  html: string,
  wrapChars: number,
  coarse: boolean,
  requireBlock = true
) => {
  if (requireBlock && !/<(pre|ul|ol|table|blockquote|h[1-6])\b/i.test(html)) return undefined;
  let extraPx = 0;
  let extraBlocks = 0;
  const prose = html
    .replace(CODE_BLOCK, (_m, code: string) => {
      extraPx += estimateCodeBlockPx(decodeEntities(code.replace(ANY_TAG, '')), wrapChars, coarse);
      extraBlocks += 1;
      return '\n';
    })
    .replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_m, tableHtml: string) => {
      extraPx += estimateTablePx(tableHtml, wrapChars);
      extraBlocks += 1;
      return '\n';
    });
  const text = stripHtml(prose);
  if (!requireBlock && extraPx === 0 && !text.trim()) return 0;
  const blocks = (prose.match(/<(p|ul|ol|table|blockquote|h[1-6])\b/gi)?.length ?? 0) + extraBlocks;
  return blocksPx(extraPx, text, blocks, wrapChars);
};

const estimateFencedMarkdownPx = (body: string, wrapChars: number, coarse: boolean) => {
  if (!body.includes('```') && !body.includes('~~~')) return undefined;
  let codePx = 0;
  let codeBlocks = 0;
  const prose = body.replace(/\r\n?/g, '\n').replace(FENCED_CODE, (_m, _f, code: string) => {
    codePx += estimateCodeBlockPx(code, wrapChars, coarse);
    codeBlocks += 1;
    return '\n';
  });
  if (codeBlocks === 0) return undefined;
  const text = prose.trim();
  return blocksPx(codePx, text, codeBlocks + (text ? text.split(/\n\s*\n/).length : 0), wrapChars);
};

const customHtml = (c: unknown) =>
  isRecord(c) && c.format === 'org.matrix.custom.html' && typeof c.formatted_body === 'string'
    ? c.formatted_body
    : undefined;

/** Height of block-structured HTML before folding; undefined for plain text and inline-only HTML. */
export const estimateFormattedBodyPx = (
  content: unknown,
  wrapChars = WRAP_CHARS,
  coarse = false
) => {
  const html = customHtml(content);
  return html ? estimateRichHtmlPx(html, wrapChars, coarse) : undefined;
};

const hasLongTextTag = (c: Record<string, unknown> | undefined) =>
  !!c &&
  (c['io.mindroom.long_text'] !== undefined ||
    recordOf(c['m.new_content'])?.['io.mindroom.long_text'] !== undefined);

const estimateMediaPx = (content: Record<string, unknown>, type: string): number | undefined => {
  const msgtype = type === 'm.sticker' ? 'm.image' : content.msgtype;
  if (msgtype === 'm.file' && hasLongTextTag(content)) return undefined;
  if (msgtype === 'm.file' || msgtype === 'm.audio') return 56;
  if (msgtype !== 'm.image' && msgtype !== 'm.video') return undefined;
  const { w, h } = recordOf(content.info) ?? {};
  return typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0
    ? Math.round(h * Math.min(1, MEDIA_MAX_SIZE.width / w, MEDIA_MAX_SIZE.height / h))
    : 240;
};

const hasReasoning = (c: Record<string, unknown>) =>
  [c['io.mindroom.live_reasoning'], recordOf(c['io.mindroom.reasoning'])?.text].some(
    (v) => typeof v === 'string' && v.trim() !== ''
  );

type Layout = { compact: boolean; wrapChars: number; coarse: boolean; showToolCalls: boolean };

const estimateToolWorkPx = (
  content: Record<string, unknown>,
  html: string | undefined,
  body: string,
  { wrapChars, coarse, showToolCalls }: Layout,
  plainPx: (text: string) => number
): number | undefined => {
  const finished = isFinishedAgentReply(content);
  const controls = (count: number) => {
    const r = hasReasoning(content);
    return showToolCalls ? (r ? WORK_BAR_PX : 0) + count * 38 : r ? WORK_BAR_PX : coarse ? 36 : 26;
  };
  if (html?.includes(TOOL_ICON)) {
    const matches = [...html.matchAll(PRE_OR_TOOL)].filter((m) => !m[1]);
    if (matches.length === 0) return undefined;
    const stripTools = (s: string) => s.replace(PRE_OR_TOOL, (_m, pre?: string) => pre ?? '');
    const last = matches[matches.length - 1]!;
    const start = last.index ?? 0;
    const end = start + last[0].length;
    if (
      finished &&
      !/^[\s]*(?:<br\s*\/?>[\s]*)*<\/(?:li|blockquote|h[1-6]|td|th)>/i.test(html.slice(end))
    ) {
      const tail = html.slice(end).replace(/^(?:[\s]+|<br\s*\/?>|<\/p>)+/i, '');
      if (hasVisibleHtml(stripTools(html.slice(0, start))) && hasVisibleHtml(tail)) {
        return WORK_BAR_PX + (estimateRichHtmlPx(tail, wrapChars, coarse, false) ?? 0);
      }
    }
    const cleaned = stripTools(html).replace(/<p\b[^>]*>[\s]*(?:<br\s*\/?>[\s]*)*<\/p>/gi, '');
    return controls(matches.length) + (estimateRichHtmlPx(cleaned, wrapChars, coarse, false) ?? 0);
  }
  if (!body.includes(TOOL_ICON)) return undefined;
  const lines = body.split('\n');
  const toolIdxs = lines.flatMap((l, i) => (TOOL_REF_TEXT.test(l) ? [i] : []));
  if (toolIdxs.length === 0) return undefined;
  const lastIdx = toolIdxs[toolIdxs.length - 1]!;
  if (finished) {
    const head = lines.slice(0, lastIdx).some((l) => l.trim() !== '' && !TOOL_REF_TEXT.test(l));
    const tail = lines
      .slice(lastIdx + 1)
      .join('\n')
      .trim();
    if (head && tail) return WORK_BAR_PX + plainPx(tail);
  }
  const cleaned = lines.filter((l) => !TOOL_REF_TEXT.test(l)).join('\n');
  return controls(toolIdxs.length) + (cleaned.trim() ? plainPx(cleaned) : 0);
};

export type MessageRowEstimateOptions = {
  compact: boolean;
  wrapChars?: number;
  coarsePointer?: boolean;
  showToolCalls?: boolean;
  timelineSet?: Pick<EventTimelineSet, 'relations'>;
  longTextCacheOwner?: object;
};

const priceMessageRow = (
  event: MatrixEvent,
  content: Record<string, unknown>,
  layout: Layout
): number => {
  const relation = event.getRelation()?.rel_type;
  if (relation === RelationType.Replace || relation === RelationType.Annotation) return 0;
  const { compact, wrapChars, coarse } = layout;
  const base = compact ? 6 : 8;
  if (getThreadSummaryInfo(content)?.summaryText) return base + LINE_PX;
  const mediaPx = estimateMediaPx(content, event.getType());
  if (mediaPx !== undefined) {
    return Math.max(
      estimateThreadEventRowHeight(event, { compact, wrapChars, content }),
      base + mediaPx
    );
  }
  const isAgent = isMindroomAgentUserId(event.getSender() ?? undefined);
  const inFull = isAgent || hasThreadSummary(content);
  const html = customHtml(content);
  const body = typeof content.body === 'string' ? content.body : '';
  const textOpts = { compact, wrapChars, showsInFull: inFull };
  const plainPx = (
    text: string,
    src: Record<string, unknown> = { msgtype: 'm.text', body: text }
  ) =>
    (isAgent ? estimateFencedMarkdownPx(text, wrapChars, coarse) : undefined) ??
    Math.max(0, estimateThreadEventRowHeight(event, { ...textOpts, content: src }) - base);

  let innerPx =
    (isAgent ? estimateToolWorkPx(content, html, body, layout, plainPx) : undefined) ??
    (isAgent && hasReasoning(content) ? WORK_BAR_PX : 0) +
      ((html ? estimateRichHtmlPx(html, wrapChars, coarse) : undefined) ?? plainPx(body, content));

  const question = isAgent
    ? readInteractiveQuestion(content, event.getOriginalContent?.<Record<string, unknown>>())
    : undefined;
  if (question) {
    const hasFallback =
      body.includes(INTERACTIVE_INSTRUCTION_TEXT) || !!html?.includes(INTERACTIVE_INSTRUCTION_TEXT);
    innerPx += hasFallback ? question.options.length * 20 : 30 + question.options.length * 42;
  }
  return base + Math.min(innerPx, (inFull ? MAX_LINES : 9) * LINE_PX);
};

type RowEstimate = {
  key: readonly unknown[];
  resolvedEdit?: MatrixEvent;
  editSnap?: readonly [unknown, number, unknown, number];
  longTextSource?: LongTextSource;
  hydratedContent?: object;
  px: number;
  ownRun: boolean;
  hasModelBadge: boolean;
  isSummaryMarker: boolean;
};

/** Checked before `getEditedEvent` / `getLatestMessageContent` / regex work for O(1) cache hits. */
const rowEstimates = new WeakMap<MatrixEvent, RowEstimate>();

const snapshotEdit = (edit: MatrixEvent): readonly [unknown, number, unknown, number] => {
  const content = recordOf(edit.getContent());
  const nc = recordOf(content?.['m.new_content']);
  return [content, keysOf(content), nc, keysOf(nc)];
};

const resolveRowEstimate = (event: MatrixEvent, opts: MessageRowEstimateOptions): RowEstimate => {
  const {
    compact,
    wrapChars = WRAP_CHARS,
    coarsePointer: coarse = false,
    showToolCalls = false,
    timelineSet,
    longTextCacheOwner,
  } = opts;
  const rawContent = recordOf(event.getContent()) ?? {};
  const replacing = event.replacingEvent?.() ?? undefined;
  const replacingContent = recordOf(replacing?.getContent());
  const id = event.getId?.();
  const syncedEdit = id ? getSyncedEdit(id) : undefined;
  const rels = id ? timelineSet?.relations : undefined;
  const msgRel = rels?.getChildEventsForEvent(id!, RelationType.Replace, EventType.RoomMessage);
  const type = event.getType();
  const typeRel =
    rels && !matchesEnum(type, EventType.RoomMessage)
      ? rels.getChildEventsForEvent(id!, RelationType.Replace, type)
      : undefined;
  const msgRelCount = msgRel?.getRelations().length ?? 0;
  const typeRelCount = typeRel?.getRelations().length ?? 0;
  const bundledEdit = recordOf(event.getUnsigned?.()?.['m.relations'])?.[RelationType.Replace];
  const key: readonly unknown[] = [
    rawContent,
    keysOf(rawContent),
    replacing,
    replacingContent,
    keysOf(replacingContent),
    syncedEdit,
    syncedEdit?.getContent(),
    msgRel,
    msgRelCount,
    typeRel,
    typeRelCount,
    bundledEdit,
    compact,
    wrapChars,
    coarse,
    showToolCalls,
  ];

  const cachedSidecar = (src: LongTextSource | undefined) =>
    src && longTextCacheOwner ? getCachedLongTextContent(src, longTextCacheOwner) : undefined;
  const known = rowEstimates.get(event);
  if (
    known &&
    sameItems(known.key, key) &&
    (!known.resolvedEdit ||
      (!known.resolvedEdit.isRedacted?.() &&
        sameItems(known.editSnap!, snapshotEdit(known.resolvedEdit)))) &&
    (!known.longTextSource || cachedSidecar(known.longTextSource) === known.hydratedContent)
  ) {
    return known;
  }

  const hasEdit =
    !!replacing || msgRelCount > 0 || typeRelCount > 0 || !!syncedEdit || bundledEdit !== undefined;
  const resolvedEdit = hasEdit ? getEditedEvent(id ?? '', event, timelineSet) : undefined;
  const baseContent = resolvedEdit
    ? (getLatestMessageContent(event, resolvedEdit) as Record<string, unknown>)
    : rawContent;
  const longTextSource = hasLongTextTag(baseContent) ? getLongTextSource(baseContent) : undefined;
  const hydratedContent = cachedSidecar(longTextSource);
  const isAgent = isMindroomAgentUserId(event.getSender() ?? undefined);
  const content = hydratedContent
    ? {
        ...baseContent,
        format: undefined,
        formatted_body: undefined,
        ...(sanitizeContent(hydratedContent, isAgent) as Record<string, unknown>),
      }
    : baseContent;

  const px = priceMessageRow(event, content, { compact, wrapChars, coarse, showToolCalls });
  const aiRun = getAiRunInfo(content);
  const entry: RowEstimate = {
    key,
    resolvedEdit,
    editSnap: resolvedEdit ? snapshotEdit(resolvedEdit) : undefined,
    longTextSource,
    hydratedContent,
    px,
    ownRun: !!aiRun || (isAgent && !!getStreamStatusFromContent(content)),
    hasModelBadge: !!aiRun && !!getAiRunCompactModelLabel(aiRun),
    isSummaryMarker: !!getThreadSummaryInfo(content)?.summaryText,
  };
  rowEstimates.set(event, entry);
  return entry;
};

/** A message row's height without an author header; edits and reactions stay at zero. */
export const estimateMessageRowHeight = (
  event: MatrixEvent,
  options: MessageRowEstimateOptions
): number => resolveRowEstimate(event, options).px;

/** A thread row: body height plus non-compact author header, ModelBadge floor, and day divider. */
export const estimateThreadRowHeight = (
  event: MatrixEvent,
  above: MatrixEvent | undefined,
  options: MessageRowEstimateOptions
): number => {
  const entry = resolveRowEstimate(event, options);
  if (entry.px === 0) return 0;
  const dayPx = above && !inSameDay(above.getTs(), event.getTs()) ? 34 : 0;
  if (
    options.compact ||
    entry.isSummaryMarker ||
    (!startsAuthorGroup(above, event) && !entry.ownRun)
  ) {
    return entry.px + dayPx;
  }
  const ptr = options.coarsePointer ? 'coarse' : 'fine';
  const minPx = (entry.hasModelBadge ? MODEL_BADGE_MIN_PX : AUTHOR_MIN_PX)[ptr];
  return Math.max(minPx, entry.px + HEADER_EXTRA_PX[ptr]) + dayPx;
};

/** A room row in Modern/Bubble layout: state notices, messages with header/ModelBadge/badge/day divider. */
export const estimateRoomRowHeight = (
  event: MatrixEvent,
  above: MatrixEvent | undefined,
  opts: Omit<MessageRowEstimateOptions, 'compact'> & { threadBadge?: boolean } = {}
): number => {
  const type = event.getType();
  if (event.getStateKey() !== undefined) return NOTICE_STATE_EVENT_TYPES.has(type) ? 28 : 0;
  if (!getTimelineMessageKind(type)) return 0;
  const rowPx = estimateThreadRowHeight(event, above, { ...opts, compact: false });
  return rowPx === 0 ? 0 : rowPx + (opts.threadBadge ? 31 : 0);
};
