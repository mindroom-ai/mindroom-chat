import { useEffect, useState } from 'react';
import { Icon, Icons, Text } from 'folds';
import {
  type EventTimeline,
  type MatrixEvent,
  type Room,
  RoomEvent,
  type RoomEventHandlerMap,
  RoomStateEvent,
  type Thread,
  ThreadEvent,
} from 'matrix-js-sdk';
import { MAIN_ROOM_TIMELINE } from 'matrix-js-sdk/lib/@types/read_receipts';
import { EventReaders } from '../messages/EventReaders';
import { Modal500 } from '../ui/Modal500';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useSetting } from '../preferences/useSetting';
import { settingsAtom } from '../preferences/settings';
import { getMemberDisplayName } from '../matrix/room';
import { getMxIdLocalPart } from '../matrix/matrix';
import * as css from './RoomViewFollowing.css';
import { NamesSentence } from './typing/NamesSentence';

/** The live timeline the row follows: the open thread's, else the room's. */
const shownTimeline = (room: Room, threadId?: string): EventTimeline | undefined =>
  threadId ? room.getThread(threadId)?.liveTimeline : room.getLiveTimeline();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object';

/**
 * Whether a receipt event holds a receipt of the shown timeline: an unthreaded one, or one of the
 * open thread (of the main timeline in the room view). A thread's every event gives its sender a
 * receipt there, so while agents stream these come many a second.
 */
const hasShownTimelineReceipt = (receiptEvent: MatrixEvent | undefined, threadId?: string) => {
  // Without the event (the SDK always passes one) the receipt may be any.
  if (!receiptEvent) return true;
  const shown = threadId ?? MAIN_ROOM_TIMELINE;
  const receipts = Object.values(receiptEvent.getContent())
    .flatMap((byType) => (isRecord(byType) ? Object.values(byType) : []))
    .flatMap((byUser) => (isRecord(byUser) ? Object.values(byUser) : []));
  return receipts.some(
    (receipt) => !isRecord(receipt) || !receipt.thread_id || receipt.thread_id === shown
  );
};

/** The newest event the server knows, in the thread when one is open, else in the room. */
const latestSyncedEvent = (room: Room, threadId?: string): MatrixEvent | undefined => {
  const events = shownTimeline(room, threadId)?.getEvents() ?? [];
  return events.findLast((event) => event.getId()?.startsWith('$'));
};

type Following = { eventId: string; userIds: string[] };

/**
 * Everyone else who has read the latest event. A receipt may sit on that event or on any later
 * one, a thread reply for example, so each member's receipt is compared with the event.
 */
const readFollowers = (
  room: Room,
  threadId: string | undefined,
  myUserId: string | null
): Following | undefined => {
  const event = latestSyncedEvent(room, threadId);
  const eventId = event?.getId();
  if (!event || !eventId) return undefined;
  const sender = event.getSender();
  const userIds = room
    .getJoinedMembers()
    .map(({ userId }) => userId)
    .filter(
      (userId) => userId !== myUserId && userId !== sender && room.hasUserReadEvent(userId, eventId)
    );
  return { eventId, userIds };
};

const sameFollowing = (a: Following | undefined, b: Following | undefined): boolean =>
  a === b ||
  (!!a &&
    !!b &&
    a.eventId === b.eventId &&
    a.userIds.length === b.userIds.length &&
    a.userIds.every((userId, index) => userId === b.userIds[index]));

/**
 * The followers of the room or thread, read again when receipts, events or members arrive. An
 * unchanged answer keeps the previous object, so a streamed reply's edits do not re-render the row.
 */
const useFollowers = (room: Room, threadId: string | undefined, myUserId: string | null) => {
  const [following, setFollowing] = useState(() => readFollowers(room, threadId, myUserId));

  useEffect(() => {
    const refresh = () => {
      const next = readFollowers(room, threadId, myUserId);
      setFollowing((previous) => (sameFollowing(previous, next) ? previous : next));
    };
    // The room passes on the events and receipts of all its threads, many a second while agents
    // stream, and each refresh asks every member's receipt; only those of the shown timeline can
    // change who has read its newest event.
    const refreshForTimeline: RoomEventHandlerMap[RoomEvent.Timeline] = (...[, , , , data]) => {
      if (data?.timeline && data.timeline !== shownTimeline(room, threadId)) return;
      refresh();
    };
    const refreshForThread = (thread: Thread) => {
      if (thread.id === threadId) refresh();
    };
    const refreshForReceipt = (receiptEvent: MatrixEvent | undefined) => {
      if (hasShownTimelineReceipt(receiptEvent, threadId)) refresh();
    };
    refresh();
    room.on(RoomEvent.Receipt, refreshForReceipt);
    room.on(RoomEvent.Timeline, refreshForTimeline);
    room.on(ThreadEvent.Update, refreshForThread);
    // Members load lazily, so a follower may only be known once the member list arrives.
    room.on(RoomStateEvent.NewMember, refresh);
    return () => {
      room.removeListener(RoomEvent.Receipt, refreshForReceipt);
      room.removeListener(RoomEvent.Timeline, refreshForTimeline);
      room.removeListener(ThreadEvent.Update, refreshForThread);
      room.removeListener(RoomStateEvent.NewMember, refresh);
    };
  }, [room, threadId, myUserId]);

  return following;
};

// Sentences for one to four followers; five and more share the last one.
const FOLLOWING_KEYS = [
  'featureUi.room.following.one',
  'featureUi.room.following.two',
  'featureUi.room.following.three',
  'featureUi.room.following.four',
  'featureUi.room.following.many',
] as const;

/** The empty row under the composer: it reserves the space the followers line uses. */
export function RoomViewFollowingPlaceholder() {
  return <div className={css.FollowingStrip} data-room-following="true" />;
}

type RoomViewFollowingProps = {
  room: Room;
  threadId?: string;
};

/**
 * The row under the composer. When other members have read the latest message, it names them,
 * and pressing the names lists everyone who has seen it. It stays empty while the user shares
 * no read receipts of their own.
 */
export function RoomViewFollowing({ room, threadId }: RoomViewFollowingProps) {
  const mx = useMatrixClient();
  const [hideActivity] = useSetting(settingsAtom, 'hideActivity');
  const following = useFollowers(room, threadId, mx.getUserId());
  const [readersOf, setReadersOf] = useState<string>();

  if (hideActivity || !following || following.userIds.length === 0) {
    return <RoomViewFollowingPlaceholder />;
  }
  const names = following.userIds.map(
    (userId) => getMemberDisplayName(room, userId) ?? getMxIdLocalPart(userId) ?? userId
  );

  return (
    <div className={css.FollowingStrip} data-room-following="true">
      <button
        type="button"
        className={css.FollowingButton}
        onClick={() => setReadersOf(following.eventId)}
      >
        <Icon size="50" src={Icons.CheckTwice} aria-hidden />
        <Text as="span" size="T200" truncate>
          <NamesSentence keys={FOLLOWING_KEYS} names={names} />
        </Text>
      </button>
      {readersOf && (
        <Modal500 requestClose={() => setReadersOf(undefined)} fillPhoneScreen>
          <EventReaders
            room={room}
            eventId={readersOf}
            readers={following.userIds}
            requestClose={() => setReadersOf(undefined)}
          />
        </Modal500>
      )}
    </div>
  );
}
