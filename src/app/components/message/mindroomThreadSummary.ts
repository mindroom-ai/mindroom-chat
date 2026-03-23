import { trimReplyFromBody } from '../../utils/room';

const THREAD_SUMMARY_METADATA_KEY = 'io.mindroom.thread_summary';

// ── Shared helper ──────────────────────────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

// ── Original: content-level helpers (used by RenderMessageContent / MsgTypeRenderers) ──

type MindroomThreadSummaryMetadata = {
  version?: unknown;
  generated_at?: unknown;
  message_count?: unknown;
  summary?: unknown;
};

export type MindroomThreadSummaryInfo = {
  summaryText?: string;
  generatedTs?: number;
  messageCount?: number;
};

const asNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const asSummaryBody = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;

  const trimmed = trimReplyFromBody(value).trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const asTimestamp = (value: unknown): number | undefined => {
  if (typeof value !== 'string') return undefined;

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const asMessageCount = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  return Math.round(value);
};

const getThreadSummaryCandidates = (
  content: Record<string, unknown>
): Record<string, unknown>[] => {
  const newContent = isRecord(content['m.new_content'])
    ? (content['m.new_content'] as Record<string, unknown>)
    : undefined;

  return newContent ? [newContent, content] : [content];
};

const getThreadSummaryMetadataFromCandidate = (
  content: Record<string, unknown>
): MindroomThreadSummaryMetadata | undefined => {
  const metadata = content[THREAD_SUMMARY_METADATA_KEY];
  if (!isRecord(metadata) || metadata.version !== 1) return undefined;
  return metadata as MindroomThreadSummaryMetadata;
};

const getMindroomThreadSummaryMetadata = (
  content: Record<string, unknown>
): MindroomThreadSummaryMetadata | undefined =>
  getThreadSummaryCandidates(content)
    .map(getThreadSummaryMetadataFromCandidate)
    .find((metadata): metadata is MindroomThreadSummaryMetadata => metadata !== undefined);

const getThreadSummaryBody = (content: Record<string, unknown>): string | undefined =>
  getThreadSummaryCandidates(content)
    .map((candidate) => asSummaryBody(candidate.body))
    .find((body): body is string => body !== undefined);

export const hasMindroomThreadSummary = (content: Record<string, unknown>): boolean =>
  !!getMindroomThreadSummaryMetadata(content);

export const getMindroomThreadSummaryInfo = (
  content: Record<string, unknown>
): MindroomThreadSummaryInfo | undefined => {
  const metadata = getMindroomThreadSummaryMetadata(content);
  if (!metadata) return undefined;

  const hasNewContent = isRecord(content['m.new_content']);
  const summaryBody = getThreadSummaryBody(content);
  const summaryText =
    (hasNewContent ? summaryBody ?? asNonEmptyString(metadata.summary) : undefined) ??
    (!hasNewContent ? asNonEmptyString(metadata.summary) ?? summaryBody : undefined);

  return {
    summaryText,
    generatedTs: asTimestamp(metadata.generated_at),
    messageCount: asMessageCount(metadata.message_count),
  };
};

export const formatMindroomThreadSummaryMessageCount = (count: number): string =>
  `${new Intl.NumberFormat().format(count)} ${count === 1 ? 'message' : 'messages'}`;

// ── CINNY-003b: event-level helpers (used by RoomTimeline) ─────────

type ThreadSummaryEventLike = {
  getContent(): Record<string, unknown>;
};

export const isMindroomThreadSummaryEvent = (event: ThreadSummaryEventLike): boolean => {
  const content = event.getContent();
  const msgtype = content.msgtype;
  if (msgtype !== 'm.notice') return false;
  return !!content[THREAD_SUMMARY_METADATA_KEY];
};

export const findLatestThreadSummaryEvent = <T extends ThreadSummaryEventLike>(
  events: T[]
): T | undefined => {
  for (let i = events.length - 1; i >= 0; i--) {
    if (isMindroomThreadSummaryEvent(events[i])) return events[i];
  }
  return undefined;
};

export const getThreadSummaryPreviewText = (event: ThreadSummaryEventLike): string | undefined => {
  const content = event.getContent();

  const newContent = isRecord(content['m.new_content'])
    ? (content['m.new_content'] as Record<string, unknown>)
    : undefined;

  const body = newContent?.body ?? content.body;
  if (typeof body === 'string' && body.length > 0) return body;
  return undefined;
};

type ThreadSummaryBuildEventLike = ThreadSummaryEventLike & {
  getId(): string | undefined;
  threadRootId?: string;
};

export const getThreadSummaryEventInfo = (
  event: ThreadSummaryEventLike
): MindroomThreadSummaryInfo | undefined => {
  const content = event.getContent();
  const info = getMindroomThreadSummaryInfo(content);
  if (info) return info;

  // Fall back to body extraction for simple boolean flag format
  const text = getThreadSummaryPreviewText(event);
  if (text) return { summaryText: text };
  return undefined;
};

export const buildThreadSummaryMap = (
  events: ThreadSummaryBuildEventLike[]
): Map<string, MindroomThreadSummaryInfo> => {
  const summaries = new Map<string, MindroomThreadSummaryInfo>();

  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    const { threadRootId } = event;
    const eventId = event.getId();
    if (!eventId || !threadRootId || eventId === threadRootId) continue;
    if (summaries.has(threadRootId)) continue;
    if (!isMindroomThreadSummaryEvent(event)) continue;

    const info = getThreadSummaryEventInfo(event);
    if (info?.summaryText) summaries.set(threadRootId, info);
  }

  return summaries;
};

export { THREAD_SUMMARY_METADATA_KEY };
