import {
  ClientEvent,
  EventType,
  ReceiptType,
  RoomEvent,
  SyncState,
  type IEvent,
  type MatrixClient,
  type MatrixEvent,
} from 'matrix-js-sdk';
import { isRecord } from '../../lib/isRecord';
import { matchesEnum } from '../../lib/matchesEnum';
import { stripRedactedRelationsFromRawEvent } from '../eventRevision';
import { withoutRedactedThreadPreviews } from '../threadSummaryPreviews';

// The SDK saves its sync store after the first sync of a session and then at most every five
// minutes. A reload or an offline start in between replays the saved sync, so what changed since
// the last save was undone until the next sync brought it again (offline: until the client was
// online again): a message deleted since then came back with its text, a new display name,
// avatar, room state or account setting (such as hiding membership changes) went back to its
// older value, and a room read on another device came back unread. This module saves the store
// after a sync batch that brought such a change; for reads, a batch with one of the account's
// own read receipts, which the server sends to every device of the account.
//
// Each save writes the whole sync accumulator, every room of the account. A lone redaction (an
// agent withdrawing its draft) is saved at once, and redactions that come in a burst (a moderator
// removing several messages) then share one more save, REDACTION_SAVE_GAP_MS after the last one
// ended. Other changes wait CHANGE_SAVE_GAP_MS after the last save, so busy rooms do not save
// with every batch; a page about to be hidden saves what is waiting at once. A batch the SDK
// saves itself holds everything before it, so a save still waiting is dropped then.
//
// The saved sync keeps each event as the server sent it, so a deleted message kept its text there,
// with its edits, for as long as the saved timeline held it. Before each save, the text of every
// message a redaction in the saved timeline removes is dropped (`dropRedactedContent`), also from
// the copies that thread roots carry beside their summary (`threadSummaryPreviews.ts`), and so is
// every bundled edit whose redaction the room took (`eventRevision.ts`).

/** The least time between the end of one save and the start of the next, for a redaction. */
export const REDACTION_SAVE_GAP_MS = 2_000;
/** The same for other changes: state events, account data and the account's read receipts. */
export const CHANGE_SAVE_GAP_MS = 10_000;

// The read marker moves with every room read and is kept by the server; it alone saves nothing.
// The read receipt that comes with it does, as it carries the room's unread counts.
const UNSAVED_ROOM_ACCOUNT_DATA = new Set(['m.fully_read']);

const READ_RECEIPT_TYPES = new Set<string>([ReceiptType.Read, ReceiptType.ReadPrivate]);

/** Whether a synced `m.receipt` event holds a read receipt of `userId`'s, public or private. */
const hasOwnReadReceipt = (event: MatrixEvent, userId: string | null): boolean => {
  const content: unknown = event.getContent();
  if (!userId || !matchesEnum(event.getType(), EventType.Receipt) || !isRecord(content))
    return false;
  return Object.values(content).some(
    (byType) =>
      isRecord(byType) &&
      Object.entries(byType).some(
        ([type, byUser]) => READ_RECEIPT_TYPES.has(type) && isRecord(byUser) && userId in byUser
      )
  );
};

type SyncBatchState = SyncState | null;

type SavedEvent = {
  event_id?: string;
  type?: string;
  state_key?: string;
  redacts?: string;
  content?: Record<string, unknown>;
  unsigned?: Record<string, unknown>;
};

/** The SDK's sync accumulator, the part of it that holds each joined room's saved timeline. */
type SavedSync = {
  joinRooms?: Record<string, { _timeline?: { event: SavedEvent; token: string | null }[] }>;
};

type Relations = { 'm.replace'?: unknown; 'm.thread'?: { latest_event?: SavedEvent } };

const relationsOf = (event: SavedEvent): Relations | undefined =>
  event.unsigned?.['m.relations'] as Relations | undefined;

/**
 * `event` without its text: no content but its relation, and no edit bundled with it. The
 * relation stays, so the redaction replayed after it still finds the event where it was (a
 * thread's reply count drops by it, as it did before).
 */
const withoutText = (event: SavedEvent): SavedEvent => {
  const { 'm.replace': edit, ...relations } = relationsOf(event) ?? {};
  const relation = event.content?.['m.relates_to'];
  const keys = Object.keys(event.content ?? {});
  if (!edit && keys.every((key) => key === 'm.relates_to')) return event;
  return {
    ...event,
    content: relation ? { 'm.relates_to': relation } : {},
    unsigned: {
      ...event.unsigned,
      ...(event.unsigned?.['m.relations'] ? { 'm.relations': relations } : {}),
    },
  };
};

/** `event` with its thread's latest reply, which the server bundles with it, without its text. */
const withLatestReplyWithoutText = (event: SavedEvent, redacted: Set<string>): SavedEvent => {
  const relations = relationsOf(event);
  const thread = relations?.['m.thread'];
  const latest = thread?.latest_event;
  if (!thread || !latest || !redacted.has(latest.event_id ?? '')) return event;
  const latestEvent = withoutText(latest);
  if (latestEvent === latest) return event;
  return {
    ...event,
    unsigned: {
      ...event.unsigned,
      'm.relations': { ...relations, 'm.thread': { ...thread, latest_event: latestEvent } },
    },
  };
};

/**
 * Drops the text of every message that a redaction in the saved timeline removes: its content
 * but its relation, the edit the server bundled with it (also as a thread's latest reply), its
 * copies beside a thread's summary, and its edits. The redaction itself is kept and is replayed as
 * before. State events are left alone. Events are replaced rather than changed: the SDK's own
 * events may share their objects. Every bundled edit in `takenEdits` of its room, which the room
 * took a redaction of as it arrived, is dropped too: the replay decides who may redact it with the
 * room's state after the saved timeline, in which the redaction's sender may have left.
 */
export const dropRedactedContent = (
  sync: SavedSync,
  takenEdits: (roomId: string) => ReadonlySet<string> = () => new Set()
): void => {
  Object.entries(sync.joinRooms ?? {}).forEach(([roomId, room]) => {
    const timeline = room._timeline ?? [];
    const redacted = new Set<string>();
    timeline.forEach(({ event }) => {
      const target = event.redacts ?? event.content?.redacts;
      if (event.type === 'm.room.redaction' && typeof target === 'string') redacted.add(target);
    });
    const taken = takenEdits(roomId);
    if (redacted.size === 0 && taken.size === 0) return;
    // An edit of a redacted message is dropped; the next event kept takes its pagination token.
    let token: string | null = null;
    room._timeline = timeline.flatMap((entry) => {
      const { event } = entry;
      const relation = event.content?.['m.relates_to'] as
        | { rel_type?: string; event_id?: string }
        | undefined;
      if (relation?.rel_type === 'm.replace' && redacted.has(relation.event_id ?? '')) {
        token ??= entry.token;
        return [];
      }
      const isRedacted = redacted.has(event.event_id ?? '') && event.state_key === undefined;
      const kept = stripRedactedRelationsFromRawEvent(
        withoutRedactedThreadPreviews(
          withLatestReplyWithoutText(isRedacted ? withoutText(event) : event, redacted),
          redacted,
          stripRedactedRelationsFromRawEvent
        ) as Partial<IEvent>,
        taken
      ) as SavedEvent;
      const next = kept === event && !token ? entry : { event: kept, token: entry.token ?? token };
      token = null;
      return [next];
    });
  });
};

/** The edits each room took a redaction of as it arrived (eventRevision.ts). */
const takenEditsOf =
  (mx: MatrixClient) =>
  (roomId: string): ReadonlySet<string> =>
    mx.getRoom(roomId)?.redactedBundledEdits ?? new Set();

/** The sync the client's store saves; only the IndexedDB store has one. */
const savedSyncOf = (mx: MatrixClient): SavedSync | undefined =>
  (mx.store as unknown as { backend?: { syncAccumulator?: SavedSync } }).backend?.syncAccumulator;

/**
 * Saves the client's sync store after sync batches that brought a redaction, a state event,
 * account data or the account's own read receipt, unless the SDK saves such a batch itself; call
 * it before the client starts.
 * Returns a function that stops it.
 */
export const keepRedactionsInSavedSync = (mx: MatrixClient): (() => void) => {
  let redactionSinceSave = false;
  let changeSinceSave = false;
  let saving = false;
  // The gap of a save requested while another one was still writing.
  let gapAfterThisOne: number | undefined;
  let lastSaveEndedAt = Number.NEGATIVE_INFINITY;
  let waiting: ReturnType<typeof setTimeout> | undefined;
  let waitingUntil = Number.POSITIVE_INFINITY;
  let stopped = false;

  const dropWaitingSave = () => {
    if (waiting === undefined) return;
    clearTimeout(waiting);
    waiting = undefined;
    waitingUntil = Number.POSITIVE_INFINITY;
  };

  const requestSave = (gap: number) => {
    if (stopped) return;
    if (saving) {
      // The store changed while this save read it; save once more afterwards.
      gapAfterThisOne = Math.min(gapAfterThisOne ?? gap, gap);
      return;
    }
    const due = lastSaveEndedAt + gap;
    const wait = due - Date.now();
    if (wait > 0) {
      if (due >= waitingUntil) return;
      dropWaitingSave();
      waitingUntil = due;
      waiting = setTimeout(() => {
        waiting = undefined;
        waitingUntil = Number.POSITIVE_INFINITY;
        requestSave(0);
      }, wait);
      return;
    }
    dropWaitingSave();
    saving = true;
    const sync = savedSyncOf(mx);
    if (sync) dropRedactedContent(sync, takenEditsOf(mx));
    mx.store
      .save(true)
      .catch((error: unknown) => {
        // eslint-disable-next-line no-console
        console.warn('[savedSyncRedactions] could not save the sync store', error);
      })
      .finally(() => {
        saving = false;
        lastSaveEndedAt = Date.now();
        if (gapAfterThisOne === undefined) return;
        const gap = gapAfterThisOne;
        gapAfterThisOne = undefined;
        requestSave(gap);
      });
  };

  const onEvent = (event: MatrixEvent) => {
    // Synced events only: a local event still being sent has a status.
    if (event.status !== null) return;
    if (event.isRedaction()) redactionSinceSave = true;
    else if (event.isState() || hasOwnReadReceipt(event, mx.getUserId())) changeSinceSave = true;
  };

  const onAccountData = () => {
    changeSinceSave = true;
  };

  const onRoomAccountData = (event: MatrixEvent) => {
    if (!UNSAVED_ROOM_ACCOUNT_DATA.has(event.getType())) changeSinceSave = true;
  };

  // The SDK reports SYNCING once it has processed a batch, just before it decides to save.
  const onSync = (state: SyncBatchState) => {
    if (state !== SyncState.Syncing) return;
    // The session's first batch and the first after five minutes are saved by the SDK, with
    // every batch before them.
    if (mx.store.wantsSave()) {
      const sync = savedSyncOf(mx);
      if (sync) dropRedactedContent(sync, takenEditsOf(mx));
      redactionSinceSave = false;
      changeSinceSave = false;
      dropWaitingSave();
      // The SDK skips its save while one of these still writes, and then waits five minutes more,
      // so that batch is saved once this save is done.
      if (saving) gapAfterThisOne = REDACTION_SAVE_GAP_MS;
      return;
    }
    if (redactionSinceSave) requestSave(REDACTION_SAVE_GAP_MS);
    else if (changeSinceSave) requestSave(CHANGE_SAVE_GAP_MS);
    redactionSinceSave = false;
    changeSinceSave = false;
  };

  // A hidden page may be closed or frozen before its gap ends.
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden' && waiting !== undefined) requestSave(0);
  };

  mx.on(ClientEvent.Event, onEvent);
  mx.on(ClientEvent.AccountData, onAccountData);
  mx.on(RoomEvent.AccountData, onRoomAccountData);
  mx.on(ClientEvent.Sync, onSync);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }
  return () => {
    stopped = true;
    dropWaitingSave();
    mx.removeListener(ClientEvent.Event, onEvent);
    mx.removeListener(ClientEvent.AccountData, onAccountData);
    mx.removeListener(RoomEvent.AccountData, onRoomAccountData);
    mx.removeListener(ClientEvent.Sync, onSync);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
  };
};
