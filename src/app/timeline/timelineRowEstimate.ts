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
  readQuestionAnswer,
  type InteractiveQuestion,
} from '../matrix/protocol/interactiveQuestion';
import {
  getCachedLongTextContent,
  getLongTextSource,
  type LongTextSource,
} from '../matrix/protocol/longText';
import { getThreadSummaryInfo, hasThreadSummary } from '../matrix/protocol/threadSummary';
import { sanitizeContent } from '../matrix/protocol/untrustedContent';
import {
  getEditedEvent,
  getEventReactions,
  getLatestMessageContent,
  trimReplyFromBody,
} from '../matrix/room';
import { isRecord } from '../lib/isRecord';
import { matchesEnum } from '../lib/matchesEnum';
import { inSameDay } from '../lib/time';
import { CodeBlockRule } from '../rich-text/markdown/block/rules';
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
import { genuineReplyEventId, startsAuthorGroup } from './timelineRowFold';

/* Pre-mount row height estimates from CSS/component invariants (Folds T400 22 px, MessageBase 8 px,
 * SenderLine 22/44 px, ModelBadge 94/114 px, CodeBlock 16-line collapse, ScrollableTable, folds). */
const COL = { wrap: 48, minWrap: 24, chromePx: 80, charPx: 8, fold: 9, gap: 0.4 } as const;
const CODE = { wrap: 80, collapseLines: 16, collapsedPx: 270, linePx: 19.5 } as const;
const CODE_HEAD = { collapsed: { fine: 36, coarse: 53 }, open: { fine: 52, coarse: 71 } } as const;
const TABLE = { cellWrap: 44, rowPx: 17, narrowWrap: 55, wideCols: 3, ctrlPx: 66 } as const;
const QUESTION = { chromePx: 30, optionPx: 42, fallbackDeltaPx: 20 } as const;
const ROW = { compact: 6, base: 8, work: 28, toolRun: 38, reply: 24 } as const;
const EXTRA = { day: 34, state: 28, badge: 31, file: 56, media: 240 } as const;
const PTR = {
  header: { fine: 38, coarse: 60 },
  authorMin: { fine: 68, coarse: 90 },
  modelMin: { fine: 94, coarse: 114 },
  toolCog: { fine: 26, coarse: 36 },
} as const;

/** Characters per wrapped line for a timeline scroll container width; falls back to 48. */
export const columnWrapCharsForWidth = (w: number | undefined): number =>
  w && w > 0 ? Math.max(COL.minWrap, Math.floor((w - COL.chromePx) / COL.charPx)) : COL.wrap;

const CODE_BLOCK = /<pre\b[^>]*>([\s\S]*?)<\/pre>/gi;
const PRE_OR_TOOL = new RegExp(`(<pre\\b[^>]*>[\\s\\S]*?<\\/pre>)|${TOOL_REF_HTML_G.source}`, 'gi');
const MX_REPLY = /<mx-reply\b[^>]*>[\s\S]*?<\/mx-reply>/gi;
const BLOCK_END = /<\/(p|li|h[1-6]|blockquote|div|dt|dd)>|<br\s*\/?>/gi;
const ANY_TAG = /<[^>]+>/g;

const decodeEntities = (s: string) => s.replace(/&(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);/gi, 'x');
const stripHtml = (s: string) => decodeEntities(s.replace(BLOCK_END, '\n').replace(ANY_TAG, ''));
const hasVisibleHtml = (s: string) =>
  s.replace(ANY_TAG, '').trim() !== '' || /<(?:img|video|audio)\b/i.test(s);
type ContentRecord = Record<string, unknown>;
const recordOf = (v: unknown) => (isRecord(v) ? v : undefined);
const keysOf = (obj: ContentRecord | undefined) => (obj ? Object.keys(obj).length : 0);
const sameItems = (a: readonly unknown[], b: readonly unknown[]) => a.every((v, i) => v === b[i]);

const wrappedLines = (text: string, wrap: number = COL.wrap): number =>
  text.split('\n').reduce((n, r) => (r.trim() ? n + Math.ceil(r.trim().length / wrap) : n), 0);

const blocksPx = (extraPx: number, text: string, blocks: number, wrap: number) =>
  Math.round(extraPx + (wrappedLines(text, wrap) + Math.max(0, blocks - 1) * COL.gap) * LINE_PX);

const countRuns = (n: number, splitAt: (i: number) => boolean): number => {
  let runs = 1;
  for (let i = 1; i < n; i += 1) if (splitAt(i)) runs += 1;
  return runs;
};

const estimateCodeBlockPx = (plainCode: string, wrap: number, coarse: boolean): number => {
  const ptr = coarse ? 'coarse' : 'fine';
  const lines = plainCode.replace(/\n$/, '').split('\n');
  let logical = 0;
  for (const line of lines) {
    logical += Math.max(1, Math.ceil(line.length / CODE.wrap));
    if (logical > CODE.collapseLines) return CODE_HEAD.collapsed[ptr] + CODE.collapsedPx;
  }
  const codeWrap = Math.max(COL.minWrap, wrap - 2);
  const rendered = lines.reduce((n, line) => n + Math.max(1, Math.ceil(line.length / codeWrap)), 0);
  return CODE_HEAD.open[ptr] + rendered * CODE.linePx;
};

const estimateTablePx = (tableHtml: string, wrap: number): number => {
  let px = 0;
  let maxCols = 0;
  for (const row of tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    let cols = 0;
    let rowLines = 1;
    for (const cell of (row[1] ?? '').matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)) {
      cols += 1;
      rowLines = Math.max(rowLines, wrappedLines(stripHtml(cell[1] ?? ''), TABLE.cellWrap));
    }
    maxCols = Math.max(maxCols, cols);
    px += TABLE.rowPx + rowLines * LINE_PX;
  }
  return px + (wrap < TABLE.narrowWrap && maxCols >= TABLE.wideCols ? TABLE.ctrlPx : 0);
};

const estimateRichHtmlPx = (html: string, wrap: number, coarse: boolean, blockOnly = true) => {
  if (blockOnly && !/<(pre|ul|ol|table|blockquote|h[1-6])\b/i.test(html)) return undefined;
  let extraPx = 0;
  let extraBlocks = 0;
  const prose = html
    .replace(CODE_BLOCK, (_m, code: string) => {
      extraPx += estimateCodeBlockPx(decodeEntities(code.replace(ANY_TAG, '')), wrap, coarse);
      extraBlocks += 1;
      return '\n';
    })
    .replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_m, tableHtml: string) => {
      extraPx += estimateTablePx(tableHtml, wrap);
      extraBlocks += 1;
      return '\n';
    });
  const text = stripHtml(prose);
  if (!blockOnly && extraPx === 0 && !text.trim()) return 0;
  const blocks = (prose.match(/<(p|ul|ol|table|blockquote|h[1-6])\b/gi)?.length ?? 0) + extraBlocks;
  return blocksPx(extraPx, text, blocks, wrap);
};

const estimateFencedMarkdownPx = (body: string, wrap: number, coarse: boolean) => {
  if (!body.includes('```')) return undefined;
  const norm = body.replace(/\r\n?/g, '\n');
  const scan = CodeBlockRule.scan!(norm);
  let cursor = 0;
  let codePx = 0;
  let codeBlocks = 0;
  let prose = '';
  for (let m = scan(0); m?.index !== undefined; m = scan(cursor)) {
    prose += `${norm.slice(cursor, m.index)}\n`;
    codePx += estimateCodeBlockPx(m[3] ?? '', wrap, coarse);
    codeBlocks += 1;
    cursor = m.index + m[0].length;
  }
  if (codeBlocks === 0) return undefined;
  const text = `${prose}${norm.slice(cursor)}`.trim();
  return blocksPx(codePx, text, codeBlocks + (text ? text.split(/\n\s*\n/).length : 0), wrap);
};

const customHtml = (c: unknown): string | undefined => {
  if (!isRecord(c) || c.format !== 'org.matrix.custom.html') return undefined;
  const fb = typeof c.formatted_body === 'string' ? c.formatted_body : undefined;
  return fb && /<mx-reply\b/i.test(fb) && /<\/mx-reply>/i.test(fb) ? fb.replace(MX_REPLY, '') : fb;
};

/** Height of block-structured HTML before folding; undefined for plain text and inline-only HTML. */
export const estimateFormattedBodyPx = (c: unknown, wrap: number = COL.wrap, coarse = false) => {
  const html = customHtml(c);
  return html ? estimateRichHtmlPx(html, wrap, coarse) : undefined;
};

const hasLongText = (c?: ContentRecord) => c?.['io.mindroom.long_text'] !== undefined;
const hasLongTextTag = (c?: ContentRecord) =>
  hasLongText(c) || hasLongText(recordOf(c?.['m.new_content']));

const estimateMediaPx = (content: ContentRecord, type: string): number | undefined => {
  const msgtype = type === 'm.sticker' ? 'm.image' : content.msgtype;
  if (msgtype === 'm.file' && hasLongTextTag(content)) return undefined;
  if (msgtype === 'm.file' || msgtype === 'm.audio') return EXTRA.file;
  if (msgtype !== 'm.image' && msgtype !== 'm.video') return undefined;
  const { w, h } = recordOf(content.info) ?? {};
  return typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0
    ? Math.round(h * Math.min(1, MEDIA_MAX_SIZE.width / w, MEDIA_MAX_SIZE.height / h))
    : EXTRA.media;
};

const hasReasoning = (c: ContentRecord) =>
  [c['io.mindroom.live_reasoning'], recordOf(c['io.mindroom.reasoning'])?.text].some(
    (v) => typeof v === 'string' && v.trim() !== ''
  );

type Layout = { compact: boolean; wrapChars: number; coarse: boolean; showToolCalls: boolean };

const estimateToolWorkPx = (
  content: ContentRecord,
  html: string | undefined,
  body: string,
  { wrapChars: wrap, coarse, showToolCalls }: Layout,
  plainPx: (text: string) => number
): number | undefined => {
  const finished = isFinishedAgentReply(content);
  const r = hasReasoning(content);
  const controls = (runs: number) => {
    if (showToolCalls) return (r ? ROW.work : 0) + runs * ROW.toolRun;
    return r ? ROW.work : PTR.toolCog[coarse ? 'coarse' : 'fine'];
  };
  if (html?.includes(TOOL_ICON)) {
    const matches = [...html.matchAll(PRE_OR_TOOL)].filter((m) => !m[1]);
    if (matches.length === 0) return undefined;
    const stripTools = (s: string) => s.replace(PRE_OR_TOOL, (_m, pre?: string) => pre ?? '');
    const fragPx = (s: string) => estimateRichHtmlPx(s, wrap, coarse, false) ?? 0;
    const last = matches.at(-1)!;
    const start = last.index ?? 0;
    const end = start + last[0].length;
    const noCut = /^[\s]*(?:<br\s*\/?>[\s]*)*<\/(?:li|blockquote|h[1-6]|td|th)>/i;
    if (finished && !noCut.test(html.slice(end))) {
      const tail = html.slice(end).replace(/^(?:[\s]+|<br\s*\/?>|<\/p>)+/i, '');
      if (hasVisibleHtml(stripTools(html.slice(0, start))) && hasVisibleHtml(tail)) {
        return ROW.work + fragPx(tail);
      }
    }
    const runs = countRuns(matches.length, (i) => {
      const prevEnd = (matches[i - 1]!.index ?? 0) + matches[i - 1]![0].length;
      return hasVisibleHtml(html.slice(prevEnd, matches[i]!.index ?? prevEnd));
    });
    const cleaned = stripTools(html).replace(/<p\b[^>]*>[\s]*(?:<br\s*\/?>[\s]*)*<\/p>/gi, '');
    return controls(runs) + fragPx(cleaned);
  }
  if (!body.includes(TOOL_ICON)) return undefined;
  const lines = body.split('\n');
  const idxs = lines.flatMap((l, i) => (TOOL_REF_TEXT.test(l) ? [i] : []));
  if (idxs.length === 0) return undefined;
  const lastIdx = idxs.at(-1)!;
  if (finished) {
    const head = lines.slice(0, lastIdx).some((l) => l.trim() !== '' && !TOOL_REF_TEXT.test(l));
    const rest = lines.slice(lastIdx + 1);
    const tail = rest.join('\n').trim();
    if (head && tail) return ROW.work + plainPx(tail);
  }
  const runs = countRuns(idxs.length, (i) =>
    lines.slice(idxs[i - 1]! + 1, idxs[i]).some((l) => l.trim() !== '')
  );
  const cleaned = lines
    .filter((l) => !TOOL_REF_TEXT.test(l))
    .join('\n')
    .trim();
  return controls(runs) + (cleaned ? plainPx(cleaned) : 0);
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
  content: ContentRecord,
  layout: Layout,
  q?: { total: number; shown: number }
): number => {
  const relation = event.getRelation()?.rel_type;
  if (relation === RelationType.Replace || relation === RelationType.Annotation) return 0;
  const { compact, wrapChars: wrap, coarse } = layout;
  const base = compact ? ROW.compact : ROW.base;
  if (getThreadSummaryInfo(content)?.summaryText) return base + LINE_PX;
  const mediaPx = estimateMediaPx(content, event.getType());
  const textH = (src: ContentRecord, showsInFull?: boolean) =>
    estimateThreadEventRowHeight(event, { compact, wrapChars: wrap, content: src, showsInFull });
  if (mediaPx !== undefined) return Math.max(textH(content), base + mediaPx);
  const isAgent = isMindroomAgentUserId(event.getSender() ?? undefined);
  const inFull = isAgent || hasThreadSummary(content);
  const html = customHtml(content);
  const body = typeof content.body === 'string' ? trimReplyFromBody(content.body) : '';
  const plainPx = (text: string, src?: ContentRecord) =>
    (isAgent ? estimateFencedMarkdownPx(text, wrap, coarse) : undefined) ??
    Math.max(0, textH(src ?? { msgtype: 'm.text', body: text }, inFull) - base);

  let innerPx =
    (isAgent ? estimateToolWorkPx(content, html, body, layout, plainPx) : undefined) ??
    (isAgent && hasReasoning(content) ? ROW.work : 0) +
      ((html ? estimateRichHtmlPx(html, wrap, coarse) : undefined) ?? plainPx(body, content));

  if (q) {
    const hasFb =
      body.includes(INTERACTIVE_INSTRUCTION_TEXT) || !!html?.includes(INTERACTIVE_INSTRUCTION_TEXT);
    const minCard = QUESTION.chromePx + q.shown * QUESTION.optionPx;
    innerPx = hasFb
      ? Math.max(
          minCard,
          innerPx + q.shown * QUESTION.fallbackDeltaPx - (q.total - q.shown) * LINE_PX
        )
      : innerPx + minCard;
  }
  return base + Math.min(innerPx, (inFull ? MAX_LINES : COL.fold) * LINE_PX);
};

type RowEstimate = {
  key: readonly unknown[];
  resolvedEdit?: MatrixEvent;
  editSnap?: readonly [unknown, number, unknown, number];
  longTextSource?: LongTextSource;
  hydratedContent?: object;
  question?: InteractiveQuestion;
  questionAnswered?: boolean;
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
  const { compact, wrapChars = COL.wrap, timelineSet, longTextCacheOwner } = opts;
  const coarse = opts.coarsePointer ?? false;
  const showToolCalls = opts.showToolCalls ?? false;
  const layout: Layout = { compact, wrapChars, coarse, showToolCalls };
  const raw = recordOf(event.getContent()) ?? {};
  const repl = event.replacingEvent?.() ?? undefined;
  const replContent = recordOf(repl?.getContent());
  const id = event.getId?.();
  const syncedEdit = id ? getSyncedEdit(id) : undefined;
  const rels = id ? timelineSet?.relations : undefined;
  const msgRel = rels?.getChildEventsForEvent(id!, RelationType.Replace, EventType.RoomMessage);
  const type = event.getType();
  const typeRel = !matchesEnum(type, EventType.RoomMessage)
    ? rels?.getChildEventsForEvent(id!, RelationType.Replace, type)
    : undefined;
  const msgRelCount = msgRel?.getRelations().length ?? 0;
  const typeRelCount = typeRel?.getRelations().length ?? 0;
  const bundledEdit = recordOf(event.getUnsigned?.()?.['m.relations'])?.[RelationType.Replace];
  const k1 = [raw, keysOf(raw), repl, replContent, keysOf(replContent), syncedEdit];
  const k2 = [syncedEdit?.getContent(), msgRel, msgRelCount, typeRel, typeRelCount, bundledEdit];
  const key: readonly unknown[] = [...k1, ...k2, compact, wrapChars, coarse, showToolCalls];
  const sender = event.getSender() ?? undefined;
  const cachedSidecar = (src: LongTextSource | undefined) =>
    src && longTextCacheOwner ? getCachedLongTextContent(src, longTextCacheOwner) : undefined;
  const isAnswered = (iq: InteractiveQuestion) => {
    const list = id && timelineSet ? getEventReactions(timelineSet, id)?.getRelations() : undefined;
    return !!list?.length && !!readQuestionAnswer(list, iq, sender);
  };

  const known = rowEstimates.get(event);
  if (
    known &&
    sameItems(known.key, key) &&
    (!known.resolvedEdit ||
      (!known.resolvedEdit.isRedacted?.() &&
        sameItems(known.editSnap!, snapshotEdit(known.resolvedEdit)))) &&
    (!known.longTextSource || cachedSidecar(known.longTextSource) === known.hydratedContent) &&
    (!known.question || isAnswered(known.question) === known.questionAnswered)
  ) {
    return known;
  }

  const hasEdit =
    !!repl || msgRelCount > 0 || typeRelCount > 0 || !!syncedEdit || bundledEdit !== undefined;
  const resolvedEdit = hasEdit ? getEditedEvent(id ?? '', event, timelineSet) : undefined;
  const base = (resolvedEdit ? getLatestMessageContent(event, resolvedEdit) : raw) as Record<
    string,
    unknown
  >;
  const longTextSource = hasLongTextTag(base) ? getLongTextSource(base) : undefined;
  const hydratedContent = cachedSidecar(longTextSource);
  const isAgent = isMindroomAgentUserId(sender);
  const content: ContentRecord = hydratedContent
    ? {
        ...base,
        format: undefined,
        formatted_body: undefined,
        ...sanitizeContent(hydratedContent, isAgent),
      }
    : base;

  const q = isAgent ? readInteractiveQuestion(content, event.getOriginalContent?.()) : undefined;
  const answered = !!q && isAnswered(q);
  const qCounts = q && { total: q.options.length, shown: answered ? 1 : q.options.length };
  const px = priceMessageRow(event, content, layout, qCounts);
  const aiRun = getAiRunInfo(content);
  const entry: RowEstimate = {
    key,
    resolvedEdit,
    editSnap: resolvedEdit ? snapshotEdit(resolvedEdit) : undefined,
    longTextSource,
    hydratedContent,
    question: q,
    questionAnswered: q ? answered : undefined,
    px,
    ownRun: !!aiRun || (isAgent && !!getStreamStatusFromContent(content)),
    hasModelBadge: !!aiRun && !!getAiRunCompactModelLabel(aiRun),
    isSummaryMarker: !!getThreadSummaryInfo(content)?.summaryText,
  };
  rowEstimates.set(event, entry);
  return entry;
};

/** A message row's height without an author header; edits and reactions stay at zero. */
export const estimateMessageRowHeight = (event: MatrixEvent, opts: MessageRowEstimateOptions) =>
  resolveRowEstimate(event, opts).px;

/** A thread row: body height plus reply quote, non-compact author header, ModelBadge floor, and day divider. */
export const estimateThreadRowHeight = (
  event: MatrixEvent,
  above: MatrixEvent | undefined,
  opts: MessageRowEstimateOptions
): number => {
  const entry = resolveRowEstimate(event, opts);
  if (entry.px === 0) return 0;
  const replyId = event.getType() !== 'm.sticker' ? genuineReplyEventId(event) : undefined;
  const bodyPx = entry.px + (replyId && replyId !== above?.getId() ? ROW.reply : 0);
  const dayPx = above && !inSameDay(above.getTs(), event.getTs()) ? EXTRA.day : 0;
  if (opts.compact || entry.isSummaryMarker || (!startsAuthorGroup(above, event) && !entry.ownRun))
    return bodyPx + dayPx;
  const ptr = opts.coarsePointer ? 'coarse' : 'fine';
  const minPx = (entry.hasModelBadge ? PTR.modelMin : PTR.authorMin)[ptr];
  return Math.max(minPx, bodyPx + PTR.header[ptr]) + dayPx;
};

/** A room row in Modern/Bubble layout: state notices, messages with header/ModelBadge/badge/day divider. */
export const estimateRoomRowHeight = (
  event: MatrixEvent,
  above: MatrixEvent | undefined,
  opts: Omit<MessageRowEstimateOptions, 'compact'> & { threadBadge?: boolean } = {}
): number => {
  const type = event.getType();
  if (event.getStateKey() !== undefined)
    return NOTICE_STATE_EVENT_TYPES.has(type) ? EXTRA.state : 0;
  if (!getTimelineMessageKind(type)) return 0;
  const rowPx = estimateThreadRowHeight(event, above, { ...opts, compact: false });
  return rowPx === 0 ? 0 : rowPx + (opts.threadBadge ? EXTRA.badge : 0);
};
