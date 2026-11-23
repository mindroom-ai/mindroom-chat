import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { agentRoomState } from './agentRoomState';

/**
 * Per-agent room state listing threads (or room timeline when `thread_id` is `null`) with active
 * reply runs. Enabled in encrypted rooms too (opaque IDs only; the homeserver can correlate agent,
 * thread, and run duration).
 */
export const MINDROOM_ACTIVE_RUNS_EVENT = 'io.mindroom.active_runs';

export type ActiveRun = { agentId: string; threadId: string | null };
export type RoomActiveRuns = { runs: ActiveRun[]; threads: ReadonlySet<string> };
export type ActiveRunsSnapshot = RoomActiveRuns & { nextExpiryTs: number | undefined };

const EMPTY_SNAPSHOT: ActiveRunsSnapshot = {
  runs: [],
  threads: new Set(),
  nextExpiryTs: undefined,
};
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size === b.size && Array.from(a).every((id) => b.has(id));
const sameRuns = (a: readonly ActiveRun[], b: readonly ActiveRun[]) =>
  a.length === b.length &&
  a.every((r, i) => r.agentId === b[i]?.agentId && r.threadId === b[i]?.threadId);

/** Parse one vetted agent state event, or `undefined` when malformed or expired at `now`. */
export const parseActiveRunsStateEvent = (
  event: MatrixEvent,
  now: number
): { runs: ActiveRun[]; expiresAt: number } | undefined => {
  const agentId = event.getStateKey();
  const content = event.getContent();
  const ts = event.getTs();
  if (
    !agentId ||
    !isRecord(content) ||
    content.version !== 1 ||
    typeof content.updated_at !== 'number' ||
    !Number.isFinite(content.updated_at) ||
    !Array.isArray(content.threads) ||
    !Number.isFinite(ts) ||
    ts <= 0
  )
    return undefined;
  const rawTtl = content.ttl_ms;
  if (rawTtl !== undefined && (typeof rawTtl !== 'number' || !Number.isFinite(rawTtl)))
    return undefined;
  const ttlMs = rawTtl === undefined ? 180_000 : Math.min(600_000, Math.max(30_000, rawTtl));
  const expiresAt = ts + ttlMs;
  // Compares local clock to origin_server_ts; bounded clock skew shifts expiry by the skew.
  if (now > expiresAt) return undefined;
  const seen = new Set<string | null>();
  const runs: ActiveRun[] = [];
  for (const entry of content.threads) {
    if (!isRecord(entry)) continue;
    const { thread_id: threadId } = entry;
    if (threadId !== null && (typeof threadId !== 'string' || !threadId)) continue;
    if (seen.has(threadId)) continue;
    seen.add(threadId);
    runs.push({ agentId, threadId });
  }
  return { runs, expiresAt };
};

/** Fresh active runs across vetted agent state events at `now`, with earliest expiry wake time. */
export const selectActiveRuns = (events: MatrixEvent[], now = Date.now()): ActiveRunsSnapshot => {
  const runs: ActiveRun[] = [];
  const threads = new Set<string>();
  let nextExpiryTs: number | undefined;
  for (const event of events) {
    const parsed = parseActiveRunsStateEvent(event, now);
    if (!parsed || parsed.runs.length === 0) continue;
    parsed.runs.forEach((run) => {
      runs.push(run);
      if (run.threadId !== null) threads.add(run.threadId);
    });
    const wakeAt = parsed.expiresAt + 1;
    if (nextExpiryTs === undefined || wakeAt < nextExpiryTs) nextExpiryTs = wakeAt;
  }
  return runs.length === 0 ? EMPTY_SNAPSHOT : { runs, threads, nextExpiryTs };
};

const cache = new WeakMap<
  Room,
  { events: MatrixEvent[]; contents: unknown[]; validFrom: number; snapshot: ActiveRunsSnapshot }
>();

/** Active-runs state events from agents in `room` (`agentRoomState`), excluding redacted ones. */
const activeRunsRoomState = (room: Room): MatrixEvent[] =>
  agentRoomState(room, MINDROOM_ACTIVE_RUNS_EVENT).filter((event) => !event.isRedacted?.());

/** Cached per-room active runs snapshot; recomputes on state/redaction change or once `nextExpiryTs` passes. */
export const roomActiveRuns = (room: Room | null, now = Date.now()): ActiveRunsSnapshot => {
  if (!room) return EMPTY_SNAPSHOT;
  const events = activeRunsRoomState(room);
  const contents = events.map((e) => e.getContent());
  const prev = cache.get(room);
  if (
    prev &&
    now >= prev.validFrom &&
    (prev.snapshot.nextExpiryTs === undefined || now < prev.snapshot.nextExpiryTs) &&
    prev.events.length === events.length &&
    events.every((e, i) => e === prev.events[i] && contents[i] === prev.contents[i])
  )
    return prev.snapshot;
  const next = selectActiveRuns(events, now);
  const sameThreads = !!prev && sameSet(prev.snapshot.threads, next.threads);
  const sameRunList = sameThreads && sameRuns(prev.snapshot.runs, next.runs);
  const snapshot =
    sameRunList && prev.snapshot.nextExpiryTs === next.nextExpiryTs
      ? prev.snapshot
      : sameThreads
      ? {
          runs: sameRunList ? prev.snapshot.runs : next.runs,
          threads: prev.snapshot.threads,
          nextExpiryTs: next.nextExpiryTs,
        }
      : next;
  cache.set(room, { events, contents, validFrom: now, snapshot });
  return snapshot;
};
