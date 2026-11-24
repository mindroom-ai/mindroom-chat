import { useCallback, useSyncExternalStore } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import {
  applyWorkflowRunDelta,
  isLiveWorkflowRunStatus,
  type WorkflowFrame,
  type WorkflowRunGraph,
  type WorkflowRunMeta,
} from '../../matrix/protocol/workflowFrame';
import type { WorkflowRunCard } from '../../matrix/protocol/workflowRunContent';
import { nextStreamEntry } from './liveReplyStore';

export const WORKFLOW_RUN_FRESHNESS_MS = 30_000;
export const WORKFLOW_RUN_KEPT_MS = 30 * 60 * 1000;
const MAX_CACHED_CARDS = 24;

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

const runKey = (roomId: string, run: string) => `${roomId}\0${run}`;
const agentFromSender = (sender: string) => {
  const local = sender.startsWith('@') ? sender.slice(1).split(':')[0] ?? sender : sender;
  return local.startsWith('mindroom_') ? local.slice('mindroom_'.length) : local;
};

/** Single freshness rule combining live ephemeral state with a durable run card. */
export const selectWorkflowRun = (
  live: WorkflowRunEntry | undefined,
  record: WorkflowCardRecord | undefined
) => {
  if (!live && !record) return undefined;
  const liveActive = live ? isLiveWorkflowRunStatus(live.meta.status) : false;
  const cardActive = record ? isLiveWorkflowRunStatus(record.card.status) : false;
  const sameAttempt = !!live && !!record && live.meta.attempt === record.card.attempt;
  const liveWins =
    !record ||
    (!!live &&
      (live.meta.attempt !== record.card.attempt
        ? live.meta.attempt > record.card.attempt
        : liveActive !== cardActive
        ? !liveActive
        : liveActive
        ? !live.stale || record.receivedAt <= live.lastFrameAt
        : live.meta.endedAt !== null &&
          (record.card.endedAt === null || live.meta.endedAt > record.card.endedAt)));
  const summary = liveWins ? live!.meta : record.card;
  const sameTerminal =
    sameAttempt &&
    !liveActive &&
    !cardActive &&
    live.meta.status === record.card.status &&
    live.meta.endedAt === record.card.endedAt;
  const graph = liveWins
    ? live!.graph
    : sameTerminal && live.graph.nodes.length >= (record.card.graph?.nodes.length ?? 0)
    ? live.graph
    : sameAttempt
    ? record.card.graph ?? live?.graph
    : record.card.graph;
  return {
    ...summary,
    run: record?.card.run ?? live!.run,
    agent: live?.meta.agent || (record ? agentFromSender(record.sender) : ''),
    threadId: live ? live.meta.threadId : record!.threadId,
    error: liveWins ? null : record.card.error,
    requester: record?.card.requester ?? live?.meta.requester,
    graph,
    stale: !!live?.stale && isLiveWorkflowRunStatus(summary.status),
    lastFrameAt: live?.lastFrameAt ?? record!.receivedAt,
    live,
  };
};
export type WorkflowRunView = NonNullable<ReturnType<typeof selectWorkflowRun>>;

type RunSlot = {
  live?: WorkflowRunEntry;
  card?: WorkflowCardRecord;
  view?: WorkflowRunView;
  dirty?: boolean;
};

/** Live frames and observed durable run cards on one Matrix client, keyed by room and run ID. */
export class WorkflowRunStore {
  private readonly rooms = new Map<string, Map<string, RunSlot>>();

  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  private readonly listeners = new Map<string, Set<() => void>>();

  private readonly cardOrder = new Set<string>();

  private readonly pins = new Map<string, number>();

  private slot(roomId: string, run: string): RunSlot {
    let runs = this.rooms.get(roomId);
    if (!runs) this.rooms.set(roomId, (runs = new Map()));
    let s = runs.get(run);
    if (!s) runs.set(run, (s = {}));
    return s;
  }

  public ingest(roomId: string, sender: string, frame: WorkflowFrame, receivedAt: number): void {
    const held = this.rooms.get(roomId)?.get(frame.run)?.live;
    const stream = nextStreamEntry(
      held ? { ...held, docs: held.graph } : undefined,
      sender,
      frame,
      receivedAt,
      applyWorkflowRunDelta
    );
    if (!stream) return;
    const { docs: graph, ...rest } = stream;
    const entry: WorkflowRunEntry = {
      ...rest,
      roomId,
      run: frame.run,
      meta: stream.stale && held ? held.meta : frame.meta,
      graph,
    };
    const s = this.slot(roomId, frame.run);
    s.live = entry;
    this.scheduleTimer(entry);
    this.changed(roomId, s);
  }

  public showCard(
    roomId: string,
    sender: string,
    card: WorkflowRunCard,
    receivedAt: number,
    threadId: string | null = null
  ): void {
    const held = this.rooms.get(roomId)?.get(card.run)?.card;
    if (
      held &&
      (held.card.attempt > card.attempt ||
        (held.card.attempt === card.attempt && held.receivedAt > receivedAt) ||
        (held.card === card && held.sender === sender && held.threadId === threadId))
    )
      return;
    const s = this.slot(roomId, card.run);
    s.card = { sender, card, receivedAt, threadId };
    const key = runKey(roomId, card.run);
    this.cardOrder.delete(key);
    this.cardOrder.add(key);
    if (!s.live) this.scheduleExpiry(roomId, card.run, WORKFLOW_RUN_KEPT_MS);
    this.evictCards();
    this.changed(roomId, s);
  }

  /** Keeps a run's card graph retained while an inspector/panel is open on it. */
  public pin(roomId: string, run: string): () => void {
    const key = runKey(roomId, run);
    this.pins.set(key, (this.pins.get(key) ?? 0) + 1);
    return () => {
      const next = (this.pins.get(key) ?? 1) - 1;
      if (next > 0) this.pins.set(key, next);
      else {
        this.pins.delete(key);
        const s = this.rooms.get(roomId)?.get(run);
        if (s?.card && !s.live) this.scheduleExpiry(roomId, run, WORKFLOW_RUN_KEPT_MS);
        this.evictCards();
      }
    };
  }

  public get(roomId: string, run: string) {
    return this.rooms.get(roomId)?.get(run)?.live;
  }

  public getView(roomId: string, run: string): WorkflowRunView | undefined {
    const s = this.rooms.get(roomId)?.get(run);
    if (!s) return undefined;
    if (s.dirty || !s.view) {
      s.view = selectWorkflowRun(s.live, s.card);
      s.dirty = false;
    }
    return s.view;
  }

  public subscribe(roomId: string, listener: () => void): () => void {
    const set = this.listeners.get(roomId) ?? new Set();
    set.add(listener);
    this.listeners.set(roomId, set);
    return () => {
      set.delete(listener);
      if (set.size === 0 && this.listeners.get(roomId) === set) {
        this.listeners.delete(roomId);
        this.releaseRoomCards(roomId);
      }
    };
  }

  public clear(): void {
    const roomIds = [...this.rooms.keys()];
    this.timers.forEach((t) => clearTimeout(t));
    this.timers.clear();
    this.rooms.clear();
    this.cardOrder.clear();
    this.pins.clear();
    roomIds.forEach((id) => this.listeners.get(id)?.forEach((fn) => fn()));
  }

  private scheduleExpiry(roomId: string, run: string, delay: number): void {
    const key = runKey(roomId, run);
    clearTimeout(this.timers.get(key));
    this.timers.set(
      key,
      setTimeout(() => this.onTimer(roomId, run), delay)
    );
  }

  private scheduleTimer(entry: WorkflowRunEntry): void {
    const delay =
      !entry.stale && isLiveWorkflowRunStatus(entry.meta.status)
        ? WORKFLOW_RUN_FRESHNESS_MS
        : WORKFLOW_RUN_KEPT_MS;
    this.scheduleExpiry(entry.roomId, entry.run, delay);
  }

  private dropCard(roomId: string, run: string): void {
    const key = runKey(roomId, run);
    this.cardOrder.delete(key);
    const runs = this.rooms.get(roomId);
    const s = runs?.get(run);
    if (!s?.card) return;
    s.card = undefined;
    if (!s.live) {
      clearTimeout(this.timers.get(key));
      this.timers.delete(key);
      runs?.delete(run);
      if (runs && !runs.size) this.rooms.delete(roomId);
    }
    this.changed(roomId, s);
  }

  private releaseRoomCards(roomId: string): void {
    const runs = this.rooms.get(roomId);
    if (!runs) return;
    for (const [run, s] of [...runs]) {
      if (s.card && !s.live && !this.pins.has(runKey(roomId, run))) this.dropCard(roomId, run);
    }
  }

  private evictCards(): void {
    for (const key of this.cardOrder) {
      if (this.cardOrder.size <= MAX_CACHED_CARDS) break;
      if (this.pins.has(key)) continue;
      const sep = key.indexOf('\0');
      if (sep > 0) this.dropCard(key.slice(0, sep), key.slice(sep + 1));
    }
  }

  private onTimer(roomId: string, run: string): void {
    const key = runKey(roomId, run);
    this.timers.delete(key);
    const runs = this.rooms.get(roomId);
    const s = runs?.get(run);
    if (!s) return;
    if (s.live && !s.live.stale && isLiveWorkflowRunStatus(s.live.meta.status)) {
      s.live = { ...s.live, stale: true };
      this.scheduleTimer(s.live);
      this.changed(roomId, s);
      return;
    }
    s.live = undefined;
    if (s.card && !this.pins.has(key)) {
      s.card = undefined;
      this.cardOrder.delete(key);
    }
    if (!s.card) {
      runs?.delete(run);
      if (runs && !runs.size) this.rooms.delete(roomId);
    }
    this.changed(roomId, s);
  }

  private changed(roomId: string, slot: RunSlot): void {
    slot.dirty = true;
    this.listeners.get(roomId)?.forEach((fn) => fn());
  }
}

const stores = new WeakMap<MatrixClient, WorkflowRunStore>();
export const getWorkflowRunStore = (mx: MatrixClient) => {
  let store = stores.get(mx);
  if (!store) stores.set(mx, (store = new WorkflowRunStore()));
  return store;
};

export const useWorkflowRun = (roomId: string, run: string): WorkflowRunView | undefined => {
  const store = getWorkflowRunStore(useMatrixClient());
  const subscribe = useCallback((fn: () => void) => store.subscribe(roomId, fn), [roomId, store]);
  const get = useCallback(() => store.getView(roomId, run), [roomId, run, store]);
  return useSyncExternalStore(subscribe, get);
};
