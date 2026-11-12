import { useCallback, useSyncExternalStore } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import {
  isActiveSubagentStatus,
  type SubagentFrame,
  type SubagentMeta,
} from '../../matrix/protocol/subagentFrame';
import { nextLiveEntry, type LiveReplyEntry } from './liveReplyStore';

/**
 * A working run stays this long after its sub-agent's last frame; MindRoom sends one every 10 s
 * meanwhile. Each frame keeps every turn of its sub-agent, so a finished turn stays while a later
 * one works.
 */
export const SUBAGENT_WORKING_RUN_FRESHNESS_MS = 30_000;
/** A paused or ended run stays this long after its sub-agent's last frame, as a paused run goes quiet. */
export const SUBAGENT_QUIET_RUN_KEPT_MS = 30 * 60 * 1000;

/** A sub-agent run as its frames left it, ordered and checked as a live reply's frames are. */
export type SubagentRun = LiveReplyEntry & {
  roomId: string;
  /** The delegation ID. */
  run: string;
  /** From the latest frame, with the task and result of the latest snapshot that had them. */
  meta: SubagentMeta;
};

const NO_RUNS: readonly SubagentRun[] = [];

/**
 * How many sub-agents are still at it (their newest turn running, waiting for approval or paused):
 * the count the room header's badge and the Sub-agents panel's own header show. A sub-agent takes
 * one turn at a time, so an older turn still at it only missed its last frame.
 */
export const countActiveSubagents = (runs: readonly SubagentRun[]): number => {
  const newest = new Map<string, SubagentRun>();
  runs.forEach((run) => {
    const held = newest.get(run.meta.subagent);
    if (!held || run.meta.startedAt >= held.meta.startedAt) newest.set(run.meta.subagent, run);
  });
  return [...newest.values()].filter(({ meta }) => isActiveSubagentStatus(meta.status)).length;
};

const runKey = (roomId: string, run: string): string => `${roomId}\0${run}`;

const isWorking = ({ status }: SubagentMeta): boolean =>
  status === 'running' || status === 'awaiting_approval';

const nextMeta = (held: SubagentMeta | undefined, latest: SubagentMeta): SubagentMeta => {
  const meta = { ...latest };
  const task = latest.task ?? held?.task;
  const result = latest.result ?? held?.result;
  if (task !== undefined) meta.task = task;
  if (result !== undefined) meta.result = result;
  return meta;
};

/** The sub-agent runs one Matrix client sees, kept per room for as long as they count. */
export class SubagentRunStore {
  private readonly rooms = new Map<string, Map<string, SubagentRun>>();

  /** Each room's runs as one array, made again only after a change, as React's store reads need. */
  private readonly lists = new Map<string, readonly SubagentRun[]>();

  private readonly expiries = new Map<string, ReturnType<typeof setTimeout>>();

  private readonly listeners = new Map<string, Set<() => void>>();

  public ingest(roomId: string, sender: string, frame: SubagentFrame, receivedAt: number): void {
    const runs = this.rooms.get(roomId) ?? new Map<string, SubagentRun>();
    const held = runs.get(frame.run);
    const next = nextLiveEntry(held, sender, frame, receivedAt);
    if (!next) return;
    const run: SubagentRun =
      next.stale && held
        ? { ...held, stale: true }
        : { ...next, roomId, run: frame.run, meta: nextMeta(held?.meta, frame.meta) };
    runs.set(frame.run, run);
    this.rooms.set(roomId, runs);
    // A frame that did not apply is no sign of life: the runs keep their expiry. One that did is
    // the sub-agent's: each of its turns stays as long as its own status says from now.
    if (!run.stale) {
      runs.forEach((turn) => {
        if (turn.meta.subagent === run.meta.subagent) this.expireLater(turn);
      });
    }
    this.changed(roomId);
  }

  /** The room's runs in the order their first frames came; the same array until they change. */
  public runs(roomId: string): readonly SubagentRun[] {
    const runs = this.rooms.get(roomId);
    if (!runs) return NO_RUNS;
    let list = this.lists.get(roomId);
    if (!list) {
      list = [...runs.values()];
      this.lists.set(roomId, list);
    }
    return list;
  }

  public subscribe(roomId: string, listener: () => void): () => void {
    const listeners = this.listeners.get(roomId) ?? new Set();
    listeners.add(listener);
    this.listeners.set(roomId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0 && this.listeners.get(roomId) === listeners) {
        this.listeners.delete(roomId);
      }
    };
  }

  public clear(): void {
    const roomIds = [...this.rooms.keys()];
    this.expiries.forEach((expiry) => clearTimeout(expiry));
    this.expiries.clear();
    this.rooms.clear();
    this.lists.clear();
    roomIds.forEach((roomId) => this.notify(roomId));
  }

  private expireLater({ roomId, run, meta }: SubagentRun): void {
    const key = runKey(roomId, run);
    clearTimeout(this.expiries.get(key));
    const after = isWorking(meta) ? SUBAGENT_WORKING_RUN_FRESHNESS_MS : SUBAGENT_QUIET_RUN_KEPT_MS;
    this.expiries.set(
      key,
      setTimeout(() => this.drop(roomId, run), after)
    );
  }

  private drop(roomId: string, run: string): void {
    this.expiries.delete(runKey(roomId, run));
    const runs = this.rooms.get(roomId);
    if (!runs?.delete(run)) return;
    if (runs.size === 0) this.rooms.delete(roomId);
    this.changed(roomId);
  }

  private changed(roomId: string): void {
    this.lists.delete(roomId);
    this.notify(roomId);
  }

  private notify(roomId: string): void {
    this.listeners.get(roomId)?.forEach((listener) => listener());
  }
}

const stores = new WeakMap<MatrixClient, SubagentRunStore>();

export const getSubagentRunStore = (mx: MatrixClient): SubagentRunStore => {
  let store = stores.get(mx);
  if (!store) {
    store = new SubagentRunStore();
    stores.set(mx, store);
  }
  return store;
};

/** The room's sub-agent runs on the active client, rendered again whenever they change. */
export const useRoomSubagentRuns = (roomId: string): readonly SubagentRun[] => {
  const store = getSubagentRunStore(useMatrixClient());
  const subscribe = useCallback(
    (onChange: () => void) => store.subscribe(roomId, onChange),
    [roomId, store]
  );
  const getRuns = useCallback(() => store.runs(roomId), [roomId, store]);
  return useSyncExternalStore(subscribe, getRuns);
};

/**
 * How many runs the room keeps (`total`) and how many of them are still at it (`active`), rendered
 * again only when either changes: a run's frames, which stream several times a second, change
 * neither. Given `threadId`, only the runs started in that conversation count: the thread by its
 * root's ID, or with `null` the room's own timeline.
 */
export const useRoomSubagentCounts = (
  roomId: string,
  threadId?: string | null
): { total: number; active: number } => {
  const store = getSubagentRunStore(useMatrixClient());
  const subscribe = useCallback(
    (onChange: () => void) => store.subscribe(roomId, onChange),
    [roomId, store]
  );
  const runsIn = useCallback(() => {
    const runs = store.runs(roomId);
    return threadId === undefined ? runs : runs.filter((run) => run.meta.threadId === threadId);
  }, [roomId, store, threadId]);
  const getTotal = useCallback(() => runsIn().length, [runsIn]);
  const getActive = useCallback(() => countActiveSubagents(runsIn()), [runsIn]);
  const total = useSyncExternalStore(subscribe, getTotal);
  const active = useSyncExternalStore(subscribe, getActive);
  return { total, active };
};
