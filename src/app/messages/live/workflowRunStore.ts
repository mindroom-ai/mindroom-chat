import { useCallback, useSyncExternalStore } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import {
  applyWorkflowRunDelta,
  isLiveWorkflowRunStatus,
  type WorkflowFrame,
  type WorkflowRunGraph,
  type WorkflowRunMeta,
  type WorkflowRunSummaryFields,
} from '../../matrix/protocol/workflowFrame';
import type { WorkflowRunCard } from '../../matrix/protocol/workflowRunContent';
import { nextStreamEntry } from './liveReplyStore';

/** A live run without a frame for this long reads stale until the next snapshot arrives. */
export const WORKFLOW_RUN_FRESHNESS_MS = 30_000;
/** Ended or stale live runs stay in memory this long for cards and the graph panel. */
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
};

export type WorkflowCardRecord = {
  sender: string;
  card: WorkflowRunCard;
  receivedAt: number;
  threadId: string | null;
};

export type WorkflowRunView = WorkflowRunSummaryFields & {
  run: string;
  agent: string;
  threadId: string | null;
  error: string | null;
  requester: string | null | undefined;
  graph: WorkflowRunGraph | undefined;
  stale: boolean;
  lastFrameAt: number;
  live?: WorkflowRunEntry;
};

const runKey = (roomId: string, run: string): string => `${roomId}\0${run}`;

const agentFromSender = (sender: string): string => {
  const local = sender.startsWith('@') ? sender.slice(1).split(':')[0] ?? sender : sender;
  return local.startsWith('mindroom_') ? local.slice('mindroom_'.length) : local;
};

/**
 * Single freshness rule combining live ephemeral state with a durable run card: higher attempt
 * wins, then terminal over live, then fresh live over live card (a stale live frame yields to a
 * durable card while retaining its last known graph).
 */
export const selectWorkflowRun = (
  live: WorkflowRunEntry | undefined,
  record: WorkflowCardRecord | undefined
): WorkflowRunView | undefined => {
  if (!live && !record) return undefined;
  if (!record && live) {
    return {
      ...live.meta,
      run: live.run,
      error: null,
      requester: live.meta.requester,
      graph: live.graph,
      stale: live.stale,
      lastFrameAt: live.lastFrameAt,
      live,
    };
  }
  const { card, sender, receivedAt, threadId } = record!;
  if (!live) {
    return {
      ...card,
      agent: agentFromSender(sender),
      threadId,
      requester: card.requester,
      graph: card.graph,
      stale: false,
      lastFrameAt: receivedAt,
    };
  }
  const liveActive = isLiveWorkflowRunStatus(live.meta.status);
  const cardActive = isLiveWorkflowRunStatus(card.status);
  let liveWins: boolean;
  if (live.meta.attempt !== card.attempt) liveWins = live.meta.attempt > card.attempt;
  else if (liveActive !== cardActive) liveWins = !liveActive;
  else if (liveActive) liveWins = !live.stale;
  else
    liveWins =
      live.meta.endedAt !== null && (card.endedAt === null || live.meta.endedAt > card.endedAt);

  const summary = liveWins ? live.meta : card;
  return {
    ...summary,
    run: card.run,
    agent: live.meta.agent || agentFromSender(sender),
    threadId: live.meta.threadId ?? threadId,
    error: liveWins ? null : card.error,
    requester: card.requester ?? live.meta.requester,
    graph: liveWins ? live.graph : card.graph ?? live.graph,
    stale: live.stale && isLiveWorkflowRunStatus(summary.status),
    lastFrameAt: live.lastFrameAt,
    live,
  };
};

/** Live frames and observed durable run cards on one Matrix client, keyed by room and run ID. */
export class WorkflowRunStore {
  private readonly live = new Map<string, Map<string, WorkflowRunEntry>>();

  private readonly cards = new Map<string, Map<string, WorkflowCardRecord>>();

  private readonly views = new Map<string, WorkflowRunView | undefined>();

  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  private readonly listeners = new Map<string, Set<() => void>>();

  public ingest(roomId: string, sender: string, frame: WorkflowFrame, receivedAt: number): void {
    const runs = this.live.get(roomId) ?? new Map<string, WorkflowRunEntry>();
    const held = runs.get(frame.run);
    const stream = nextStreamEntry(
      held ? { ...held, docs: held.graph } : undefined,
      sender,
      frame,
      receivedAt,
      applyWorkflowRunDelta
    );
    if (!stream) return;
    const entry: WorkflowRunEntry = {
      roomId,
      sender: stream.sender,
      run: frame.run,
      sid: stream.sid,
      seq: stream.seq,
      meta: stream.stale && held ? held.meta : frame.meta,
      graph: stream.docs,
      lastFrameAt: stream.lastFrameAt,
      stale: stream.stale,
    };
    runs.set(frame.run, entry);
    this.live.set(roomId, runs);
    this.scheduleTimer(entry);
    this.changed(roomId, frame.run);
  }

  /** Records a durable run card so requester, status, error, and graph stay available to the panel. */
  public showCard(
    roomId: string,
    sender: string,
    card: WorkflowRunCard,
    receivedAt: number,
    threadId: string | null = null
  ): void {
    const byRun = this.cards.get(roomId) ?? new Map<string, WorkflowCardRecord>();
    const held = byRun.get(card.run);
    if (held && held.card.attempt > card.attempt) return;
    if (held && held.card === card && held.sender === sender && held.threadId === threadId) return;
    byRun.set(card.run, { sender, card, receivedAt, threadId });
    this.cards.set(roomId, byRun);
    this.changed(roomId, card.run);
  }

  public get(roomId: string, run: string): WorkflowRunEntry | undefined {
    return this.live.get(roomId)?.get(run);
  }

  public getView(roomId: string, run: string): WorkflowRunView | undefined {
    const key = runKey(roomId, run);
    if (this.views.has(key)) return this.views.get(key);
    const view = selectWorkflowRun(
      this.live.get(roomId)?.get(run),
      this.cards.get(roomId)?.get(run)
    );
    this.views.set(key, view);
    return view;
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
    const roomIds = new Set([...this.live.keys(), ...this.cards.keys()]);
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers.clear();
    this.live.clear();
    this.cards.clear();
    this.views.clear();
    roomIds.forEach((roomId) => this.listeners.get(roomId)?.forEach((fn) => fn()));
  }

  private scheduleTimer(entry: WorkflowRunEntry): void {
    const key = runKey(entry.roomId, entry.run);
    clearTimeout(this.timers.get(key));
    const delay =
      !entry.stale && isLiveWorkflowRunStatus(entry.meta.status)
        ? WORKFLOW_RUN_FRESHNESS_MS
        : WORKFLOW_RUN_KEPT_MS;
    this.timers.set(
      key,
      setTimeout(() => this.onTimer(entry.roomId, entry.run), delay)
    );
  }

  private onTimer(roomId: string, run: string): void {
    this.timers.delete(runKey(roomId, run));
    const runs = this.live.get(roomId);
    const held = runs?.get(run);
    if (!held) return;
    if (!held.stale && isLiveWorkflowRunStatus(held.meta.status)) {
      const staleEntry: WorkflowRunEntry = { ...held, stale: true };
      runs?.set(run, staleEntry);
      this.scheduleTimer(staleEntry);
      this.changed(roomId, run);
      return;
    }
    runs?.delete(run);
    if (runs && runs.size === 0) this.live.delete(roomId);
    this.changed(roomId, run);
  }

  private changed(roomId: string, run: string): void {
    this.views.delete(runKey(roomId, run));
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

/** Unified live + durable view for one workflow run on the active client. */
export const useWorkflowRun = (roomId: string, run: string): WorkflowRunView | undefined => {
  const store = getWorkflowRunStore(useMatrixClient());
  const subscribe = useCallback((fn: () => void) => store.subscribe(roomId, fn), [roomId, store]);
  const get = useCallback(() => store.getView(roomId, run), [roomId, run, store]);
  return useSyncExternalStore(subscribe, get);
};
