import type { MatrixClient } from 'matrix-js-sdk';
import {
  applyLiveDelta,
  compareLiveOrder,
  type LiveDelta,
  type LiveDocs,
  type LiveFrame,
  type LiveOrder,
} from '../../matrix/protocol/liveFrame';

/** A live entry counts for this long after the last frame that changed it. */
export const LIVE_REPLY_FRESHNESS_MS = 12_000;
/** The longest live text document, in UTF-16 code units. */
export const LIVE_DOCUMENT_CAP = 1_000_000;

export type LiveReplyEntry = {
  sender: string;
  sid: string;
  seq: number;
  docs: LiveDocs;
  lastFrameAt: number;
  /** A frame did not apply; the documents stay at their last valid state until a snapshot. */
  stale: boolean;
};

const entryKey = (roomId: string, replyId: string): string => `${roomId}\0${replyId}`;

/** How many dropped entries the store keeps for their replies to hold (`getHeld`). */
const HELD_ENTRIES = 8;

const fitsCap = ({ md, reasoning, activity }: LiveDocs): boolean =>
  md.length <= LIVE_DOCUMENT_CAP &&
  reasoning.length <= LIVE_DOCUMENT_CAP &&
  activity.length <= LIVE_DOCUMENT_CAP;

/**
 * The entry after a frame: a new entry when the frame applies, a stale copy of `entry` when it
 * does not, or undefined when the frame changes nothing. Sub-agent runs follow it too.
 */
export const nextLiveEntry = (
  entry: LiveReplyEntry | undefined,
  sender: string,
  frame: LiveOrder & ({ snapshot: LiveDocs } | { delta: LiveDelta }),
  receivedAt: number
): LiveReplyEntry | undefined => {
  if (entry && (entry.sender !== sender || compareLiveOrder(frame, entry) <= 0)) return undefined;
  const fresh = (docs: LiveDocs): LiveReplyEntry => ({
    sender,
    sid: frame.sid,
    seq: frame.seq,
    docs,
    lastFrameAt: receivedAt,
    stale: false,
  });
  const markStale = () => (entry && !entry.stale ? { ...entry, stale: true } : undefined);
  if ('snapshot' in frame) return fitsCap(frame.snapshot) ? fresh(frame.snapshot) : markStale();
  if (!entry) return undefined;
  if (entry.stale || frame.sid !== entry.sid || frame.seq !== entry.seq + 1) return markStale();
  const docs = applyLiveDelta(entry.docs, frame.delta);
  return docs && fitsCap(docs) ? fresh(docs) : markStale();
};

/** Live state of the replies one Matrix client streams, keyed by room and reply event. */
export class LiveReplyStore {
  private readonly entries = new Map<string, LiveReplyEntry>();

  private readonly expiries = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * The last entry of each reply whose entry went (it expired, or a reader dropped it), newest
   * last: a reply whose durable edits stopped at an earlier state of it keeps showing its text
   * (useLiveReplyContent), in every view that draws the reply.
   */
  private readonly held = new Map<string, LiveReplyEntry>();

  private readonly listeners = new Map<string, Set<() => void>>();

  private readonly roomListeners = new Map<string, Set<() => void>>();

  private readonly roomFrames = new Map<string, number>();

  public ingest(roomId: string, sender: string, frame: LiveFrame, receivedAt: number): void {
    const key = entryKey(roomId, frame.reply);
    const entry = this.entries.get(key);
    const next = nextLiveEntry(entry, sender, frame, receivedAt);
    if (!next) return;
    this.entries.set(key, next);
    this.held.delete(key);
    if (!next.stale) this.roomFrames.set(roomId, this.frameCount(roomId) + 1);
    if (next.lastFrameAt !== entry?.lastFrameAt) {
      clearTimeout(this.expiries.get(key));
      this.expiries.set(
        key,
        setTimeout(() => this.drop(roomId, frame.reply), LIVE_REPLY_FRESHNESS_MS)
      );
    }
    this.notify(key);
  }

  /** How many frames have applied in the room, so a reader can tell whether one applied since. */
  public frameCount(roomId: string): number {
    return this.roomFrames.get(roomId) ?? 0;
  }

  public get(roomId: string, replyId: string): LiveReplyEntry | undefined {
    return this.entries.get(entryKey(roomId, replyId));
  }

  /** The last entry of a reply whose entry went, while the store keeps it. */
  public getHeld(roomId: string, replyId: string): LiveReplyEntry | undefined {
    return this.held.get(entryKey(roomId, replyId));
  }

  /** Drops the reply's entry; `hold` keeps it for `getHeld`, else the store forgets it. */
  public drop(roomId: string, replyId: string, hold = true): void {
    const key = entryKey(roomId, replyId);
    clearTimeout(this.expiries.get(key));
    this.expiries.delete(key);
    const entry = this.entries.get(key);
    const held = this.held.delete(key);
    if (entry && hold) {
      this.held.set(key, entry);
      const [oldest] = this.held.keys();
      if (this.held.size > HELD_ENTRIES && oldest !== undefined) this.held.delete(oldest);
    }
    if (this.entries.delete(key) || held) this.notify(key);
  }

  public subscribe(roomId: string, replyId: string, listener: () => void): () => void {
    const key = entryKey(roomId, replyId);
    const listeners = this.listeners.get(key) ?? new Set();
    listeners.add(listener);
    this.listeners.set(key, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0 && this.listeners.get(key) === listeners) this.listeners.delete(key);
    };
  }

  /** Tells `listener` of every change to the room's replies. */
  public subscribeRoom(roomId: string, listener: () => void): () => void {
    const listeners = this.roomListeners.get(roomId) ?? new Set();
    listeners.add(listener);
    this.roomListeners.set(roomId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0 && this.roomListeners.get(roomId) === listeners) {
        this.roomListeners.delete(roomId);
      }
    };
  }

  public clear(): void {
    const keys = new Set([...this.entries.keys(), ...this.held.keys()]);
    this.expiries.forEach((expiry) => clearTimeout(expiry));
    this.expiries.clear();
    this.entries.clear();
    this.held.clear();
    keys.forEach((key) => this.notify(key));
  }

  private notify(key: string): void {
    this.listeners.get(key)?.forEach((listener) => listener());
    this.roomListeners.get(key.slice(0, key.indexOf('\0')))?.forEach((listener) => listener());
  }
}

const stores = new WeakMap<MatrixClient, LiveReplyStore>();

export const getLiveReplyStore = (mx: MatrixClient): LiveReplyStore => {
  let store = stores.get(mx);
  if (!store) {
    store = new LiveReplyStore();
    stores.set(mx, store);
  }
  return store;
};
