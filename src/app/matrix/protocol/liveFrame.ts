import type { ToolTraceEvent } from './toolTrace';

/** Event type of the ephemeral frames that stream a MindRoom reply. */
export const LIVE_FRAME_EVENT_TYPE = 'io.mindroom.live';

/**
 * Where a reasoning segment starts in the reasoning (UTF-16 units) and how many visible tool calls
 * started before it.
 */
export type LiveReasoningSegment = { start: number; after_tool: number };

/** A reply's live state: what its next durable edit would show. */
export type LiveDocs = {
  md: string;
  reasoning: string;
  tools: ToolTraceEvent[];
  status: string;
  activity: string;
  segments: LiveReasoningSegment[];
  /**
   * The reply's `io.mindroom.compactions` entries as sent; `readReplyCompactions` reads them.
   * Absent when the backend is older than compactions, so the reply's durable list stands.
   */
  compactions?: unknown[];
};

/** Replaces `del` UTF-16 units at `at` with `ins`; `len` is the document length afterwards. */
export type LiveSplice = { at: number; del: number; ins: string; len: number };

/** Truncates or extends the tool list to `len`, then sets each 0-based index. */
export type LiveToolsDelta = { len: number; set: [number, ToolTraceEvent][] };

export type LiveDelta = {
  md?: LiveSplice;
  reasoning?: LiveSplice;
  tools?: LiveToolsDelta;
  status?: string;
  activity?: string;
  segments?: LiveReasoningSegment[];
  /** Replaces the whole compaction list. */
  compactions?: unknown[];
};

export type LiveOrder = { sid: string; seq: number };

export type LiveFrame = { reply: string } & LiveOrder &
  ({ snapshot: LiveDocs } | { delta: LiveDelta });

const LIVE_STATUSES = new Set(['pending', 'streaming']);
// Unix milliseconds at publisher start, then a random suffix, so string order is generation order.
const SID_PATTERN = /^\d{13}-[0-9a-f]{8}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const isStatus = (value: unknown): value is string =>
  typeof value === 'string' && LIVE_STATUSES.has(value);

const parseTools = (value: unknown): ToolTraceEvent[] | null =>
  Array.isArray(value) && value.every(isRecord) ? (value as ToolTraceEvent[]) : null;

const parseSegments = (value: unknown): LiveReasoningSegment[] | null =>
  Array.isArray(value) &&
  value.every((entry) => isRecord(entry) && isCount(entry.start) && isCount(entry.after_tool))
    ? value.map(({ start, after_tool }: LiveReasoningSegment) => ({ start, after_tool }))
    : null;

const parseCompactions = (value: unknown): unknown[] | null =>
  Array.isArray(value) ? (value as unknown[]) : null;

const parseSplice = (value: unknown): LiveSplice | null => {
  if (!isRecord(value)) return null;
  const { at, del, ins, len } = value;
  if (!isCount(at) || !isCount(del) || typeof ins !== 'string' || !isCount(len)) return null;
  // Whatever the document held, the inserted text ends inside the new length.
  if (at + ins.length > len) return null;
  return { at, del, ins, len };
};

const parseToolsDelta = (value: unknown): LiveToolsDelta | null => {
  if (!isRecord(value) || !isCount(value.len) || !Array.isArray(value.set)) return null;
  const { len } = value;
  const set: [number, ToolTraceEvent][] = [];
  for (const item of value.set) {
    if (!Array.isArray(item) || item.length !== 2) return null;
    const [index, entry] = item;
    if (!isCount(index) || index >= len || !isRecord(entry)) return null;
    set.push([index, entry as ToolTraceEvent]);
  }
  return { len, set };
};

const parseSnapshot = (value: unknown): LiveDocs | null => {
  if (!isRecord(value)) return null;
  const { md, reasoning, status, activity } = value;
  const tools = parseTools(value.tools);
  // Older backends send no segments.
  const segments = 'segments' in value ? parseSegments(value.segments) : [];
  // Older backends send no compactions: the frames then say nothing about them.
  const compactions = 'compactions' in value ? parseCompactions(value.compactions) : undefined;
  if (typeof md !== 'string' || typeof reasoning !== 'string' || !tools) return null;
  if (!isStatus(status) || typeof activity !== 'string' || !segments || compactions === null) {
    return null;
  }
  const docs: LiveDocs = { md, reasoning, tools, status, activity, segments };
  if (compactions) docs.compactions = compactions;
  return docs;
};

const parseDelta = (value: unknown): LiveDelta | null => {
  if (!isRecord(value)) return null;
  const delta: LiveDelta = {};
  if ('md' in value) {
    const md = parseSplice(value.md);
    if (!md) return null;
    delta.md = md;
  }
  if ('reasoning' in value) {
    const reasoning = parseSplice(value.reasoning);
    if (!reasoning) return null;
    delta.reasoning = reasoning;
  }
  if ('tools' in value) {
    const tools = parseToolsDelta(value.tools);
    if (!tools) return null;
    delta.tools = tools;
  }
  if ('status' in value) {
    if (!isStatus(value.status)) return null;
    delta.status = value.status;
  }
  if ('activity' in value) {
    if (typeof value.activity !== 'string') return null;
    delta.activity = value.activity;
  }
  if ('segments' in value) {
    const segments = parseSegments(value.segments);
    if (!segments) return null;
    delta.segments = segments;
  }
  if ('compactions' in value) {
    const compactions = parseCompactions(value.compactions);
    if (!compactions) return null;
    delta.compactions = compactions;
  }
  return Object.keys(delta).length > 0 ? delta : null;
};

/** The frame in an `io.mindroom.live` content, or null unless it has exactly the v1 shape. */
export const parseLiveFrame = (content: unknown): LiveFrame | null => {
  if (!isRecord(content) || content.v !== 1) return null;
  const { reply, sid, seq } = content;
  if (typeof reply !== 'string' || reply.length === 0) return null;
  if (typeof sid !== 'string' || !SID_PATTERN.test(sid) || !isCount(seq)) return null;
  const hasSnapshot = 'snapshot' in content;
  if (hasSnapshot === 'delta' in content) return null;
  if (hasSnapshot) {
    const snapshot = parseSnapshot(content.snapshot);
    return snapshot ? { reply, sid, seq, snapshot } : null;
  }
  const delta = parseDelta(content.delta);
  return delta ? { reply, sid, seq, delta } : null;
};

const applySplice = (doc: string, splice: LiveSplice): string | null => {
  if (splice.at + splice.del > doc.length) return null;
  const next = doc.slice(0, splice.at) + splice.ins + doc.slice(splice.at + splice.del);
  return next.length === splice.len ? next : null;
};

const applyToolsDelta = (
  tools: ToolTraceEvent[],
  delta: LiveToolsDelta
): ToolTraceEvent[] | null => {
  const next: (ToolTraceEvent | undefined)[] = tools.slice(0, delta.len);
  next.length = delta.len;
  delta.set.forEach(([index, entry]) => {
    next[index] = entry;
  });
  for (let index = 0; index < next.length; index += 1) {
    if (next[index] === undefined) return null;
  }
  return next as ToolTraceEvent[];
};

/** The documents after a delta, or null when the delta does not fit them (divergence). */
export const applyLiveDelta = (docs: LiveDocs, delta: LiveDelta): LiveDocs | null => {
  const md = delta.md ? applySplice(docs.md, delta.md) : docs.md;
  const reasoning = delta.reasoning ? applySplice(docs.reasoning, delta.reasoning) : docs.reasoning;
  const tools = delta.tools ? applyToolsDelta(docs.tools, delta.tools) : docs.tools;
  if (md === null || reasoning === null || tools === null) return null;
  const after: LiveDocs = {
    md,
    reasoning,
    tools,
    status: delta.status ?? docs.status,
    activity: delta.activity ?? docs.activity,
    segments: delta.segments ?? docs.segments,
  };
  const compactions = delta.compactions ?? docs.compactions;
  if (compactions) after.compactions = compactions;
  return after;
};

/** Orders live state of one reply: by publisher generation (`sid`), then by `seq`. */
export const compareLiveOrder = (a: LiveOrder, b: LiveOrder): number => {
  if (a.sid !== b.sid) return a.sid < b.sid ? -1 : 1;
  return a.seq - b.seq;
};
