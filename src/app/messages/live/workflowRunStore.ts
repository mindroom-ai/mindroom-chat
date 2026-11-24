import { useCallback, useSyncExternalStore } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { compareLiveOrder } from '../../matrix/protocol/liveFrame';
import {
  applyWorkflowRunDelta,
  isLiveWorkflowRunStatus,
  type WorkflowFrame,
  type WorkflowRunGraph,
  type WorkflowRunMeta,
} from '../../matrix/protocol/workflowFrame';
import type { WorkflowRunCard } from '../../matrix/protocol/workflowRunContent';

/** A live run without a frame for this long reads stale until the next snapshot arrives. */
export const WORKFLOW_RUN_FRESHNESS_MS = 30_000;

/** Ended or stale runs are kept in memory for this long so cards and panels can inspect them. */
export const WORKFLOW_RUN_KEPT_MS = 30 * 60 * 1000;

export type WorkflowRunEntry = {
  roomId: string;
  sender: string;
  run: string;
  sid: string;
  seq: number;
  meta: WorkflowRunMeta;
  graph: WorkflowRunGraph;
  lastFrameAt: number;
  stale: boolean;
  /** True when populated from a durable card message rather than live ephemeral frames. */
  fromCard?: boolean;
};

const NO_RUNS: readonly WorkflowRunEntry[] = [];

const runKey = (roomId: string, run: string): string => `${roomId}\0${run}`;

const agentNameFromSender = (sender: string): string => {
  const localpart = sender.startsWith('@') ? sender.slice(1).split(':')[0] ?? sender : sender;
  return localpart.startsWith('mindroom_') ? localpart.slice('mindroom_'.length) : localpart;
};

/** Workflow runs observed on one Matrix client, kept per room by run ID. */
export class WorkflowRunStore {
  private readonly rooms = new Map<string, Map<string, WorkflowRunEntry>>();

  private readonly lists = new Map<string, readonly WorkflowRunEntry[]>();

  private readonly freshnessTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private readonly expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private readonly listeners = new Map<string, Set<() => void>>();

  public ingest(roomId: string, sender: string, frame: WorkflowFrame, receivedAt: number): void {
    const runs = this.rooms.get(roomId) ?? new Map<string, WorkflowRunEntry>();
    const held = runs.get(frame.run);
    if (held && !held.fromCard) {
      if (held.sender !== sender || compareLiveOrder(frame, held) <= 0) return;
    }

    if ('snapshot' in frame) {
      const entry: WorkflowRunEntry = {
        roomId,
        sender,
        run: frame.run,
        sid: frame.sid,
        seq: frame.seq,
        meta: frame.meta,
        graph: frame.snapshot,
        lastFrameAt: receivedAt,
        stale: false,
      };
      runs.set(frame.run, entry);
      this.rooms.set(roomId, runs);
      this.scheduleTimers(entry);
      this.changed(roomId);
      return;
    }

    // Delta: requires a non-card held entry from the same stream at the exact preceding sequence.
    if (!held || held.fromCard) return;
    if (held.stale || frame.sid !== held.sid || frame.seq !== held.seq + 1) {
      if (held.stale) return;
      const staleEntry: WorkflowRunEntry = { ...held, stale: true };
      runs.set(frame.run, staleEntry);
      this.rooms.set(roomId, runs);
      this.clearFreshness(roomId, frame.run);
      this.scheduleDrop(roomId, frame.run, WORKFLOW_RUN_KEPT_MS);
      this.changed(roomId);
      return;
    }

    const entry: WorkflowRunEntry = {
      roomId,
      sender,
      run: frame.run,
      sid: frame.sid,
      seq: frame.seq,
      meta: frame.meta,
      graph: applyWorkflowRunDelta(held.graph, frame.delta),
      lastFrameAt: receivedAt,
      stale: false,
    };
    runs.set(frame.run, entry);
    this.rooms.set(roomId, runs);
    this.scheduleTimers(entry);
    this.changed(roomId);
  }

  /**
   * Seeds a run's graph from its durable card message when the store holds nothing newer for that
   * run (for example after a reload with no ephemeral history).
   */
  public showCard(
    roomId: string,
    sender: string,
    card: WorkflowRunCard,
    receivedAt: number,
    threadId: string | null = null
  ): void {
    if (!card.graph) return;
    const runs = this.rooms.get(roomId) ?? new Map<string, WorkflowRunEntry>();
    const held = runs.get(card.run);
    if (held) {
      if (!held.fromCard) {
        if (held.meta.attempt > card.attempt) return;
        if (
          held.meta.attempt === card.attempt &&
          (!isLiveWorkflowRunStatus(held.meta.status) || isLiveWorkflowRunStatus(card.status))
        ) {
          return;
        }
      } else if (held.meta.attempt > card.attempt) {
        return;
      }
    }
    const entry: WorkflowRunEntry = {
      roomId,
      sender,
      run: card.run,
      sid: '',
      seq: -1,
      meta: {
        agent: agentNameFromSender(sender),
        threadId,
        title: card.title,
        ...(card.name ? { name: card.name } : {}),
        status: card.status,
        attempt: card.attempt,
        startedAt: card.startedAt ?? Math.floor(receivedAt / 1000),
        endedAt: card.endedAt,
        maxConcurrent: 0,
        maxCostUsd: null,
        large: card.large,
        counts: card.counts,
        usage: card.usage,
      },
      graph: card.graph,
      lastFrameAt: receivedAt,
      stale: false,
      fromCard: true,
    };
    runs.set(card.run, entry);
    this.rooms.set(roomId, runs);
    this.clearFreshness(roomId, card.run);
    this.scheduleDrop(roomId, card.run, WORKFLOW_RUN_KEPT_MS);
    this.changed(roomId);
  }

  public get(roomId: string, run: string): WorkflowRunEntry | undefined {
    return this.rooms.get(roomId)?.get(run);
  }

  public runs(roomId: string): readonly WorkflowRunEntry[] {
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
    this.freshnessTimers.forEach((timer) => clearTimeout(timer));
    this.freshnessTimers.clear();
    this.expiryTimers.forEach((timer) => clearTimeout(timer));
    this.expiryTimers.clear();
    this.rooms.clear();
    this.lists.clear();
    roomIds.forEach((roomId) => this.notify(roomId));
  }

  private scheduleTimers(entry: WorkflowRunEntry): void {
    const { roomId, run, meta } = entry;
    this.clearFreshness(roomId, run);
    if (isLiveWorkflowRunStatus(meta.status)) {
      const key = runKey(roomId, run);
      this.freshnessTimers.set(
        key,
        setTimeout(() => this.markStale(roomId, run), WORKFLOW_RUN_FRESHNESS_MS)
      );
      this.scheduleDrop(roomId, run, WORKFLOW_RUN_FRESHNESS_MS + WORKFLOW_RUN_KEPT_MS);
    } else {
      this.scheduleDrop(roomId, run, WORKFLOW_RUN_KEPT_MS);
    }
  }

  private clearFreshness(roomId: string, run: string): void {
    const key = runKey(roomId, run);
    clearTimeout(this.freshnessTimers.get(key));
    this.freshnessTimers.delete(key);
  }

  private scheduleDrop(roomId: string, run: string, delayMs: number): void {
    const key = runKey(roomId, run);
    clearTimeout(this.expiryTimers.get(key));
    this.expiryTimers.set(
      key,
      setTimeout(() => this.drop(roomId, run), delayMs)
    );
  }

  private markStale(roomId: string, run: string): void {
    this.freshnessTimers.delete(runKey(roomId, run));
    const runs = this.rooms.get(roomId);
    const held = runs?.get(run);
    if (!held || held.stale || !isLiveWorkflowRunStatus(held.meta.status)) return;
    runs?.set(run, { ...held, stale: true });
    this.scheduleDrop(roomId, run, WORKFLOW_RUN_KEPT_MS);
    this.changed(roomId);
  }

  private drop(roomId: string, run: string): void {
    const key = runKey(roomId, run);
    this.clearFreshness(roomId, run);
    this.expiryTimers.delete(key);
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

const stores = new WeakMap<MatrixClient, WorkflowRunStore>();

export const getWorkflowRunStore = (mx: MatrixClient): WorkflowRunStore => {
  let store = stores.get(mx);
  if (!store) {
    store = new WorkflowRunStore();
    stores.set(mx, store);
  }
  return store;
};

/** Every workflow run held for `roomId` on the active client, re-rendering on changes. */
export const useRoomWorkflowRuns = (roomId: string): readonly WorkflowRunEntry[] => {
  const store = getWorkflowRunStore(useMatrixClient());
  const subscribe = useCallback(
    (onChange: () => void) => store.subscribe(roomId, onChange),
    [roomId, store]
  );
  const getRuns = useCallback(() => store.runs(roomId), [roomId, store]);
  return useSyncExternalStore(subscribe, getRuns);
};

/** One workflow run held for `roomId` and `run` on the active client. */
export const useWorkflowRun = (roomId: string, run: string): WorkflowRunEntry | undefined => {
  const store = getWorkflowRunStore(useMatrixClient());
  const subscribe = useCallback(
    (onChange: () => void) => store.subscribe(roomId, onChange),
    [roomId, store]
  );
  const getRun = useCallback(() => store.get(roomId, run), [roomId, run, store]);
  return useSyncExternalStore(subscribe, getRun);
};
