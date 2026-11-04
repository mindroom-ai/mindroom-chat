import { useEffect, useState } from 'react';
import { Icon, Icons, Text } from 'folds';
import { type MatrixEvent, type Room, RoomEvent, RoomStateEvent, ThreadEvent } from 'matrix-js-sdk';
import { EventReaders } from '../../components/event-readers';
import { Modal500 } from '../../components/Modal500';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import { getMemberDisplayName } from '../../utils/room';
import { getMxIdLocalPart } from '../../utils/matrix';
import * as css from './RoomViewFollowing.css';
import { NamesSentence } from './NamesSentence';

/** The newest event the server knows, in the thread when one is open, else in the room. */
const latestSyncedEvent = (room: Room, threadId?: string): MatrixEvent | undefined => {
  const timeline = threadId ? room.getThread(threadId)?.liveTimeline : room.getLiveTimeline();
  const events = timeline?.getEvents() ?? [];
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

/** The followers of the room or thread, read again when receipts, events or members arrive. */
const useFollowers = (room: Room, threadId: string | undefined, myUserId: string | null) => {
  const [following, setFollowing] = useState(() => readFollowers(room, threadId, myUserId));

  useEffect(() => {
    const refresh = () => setFollowing(readFollowers(room, threadId, myUserId));
    refresh();
    room.on(RoomEvent.Receipt, refresh);
    room.on(RoomEvent.Timeline, refresh);
    room.on(ThreadEvent.Update, refresh);
    // Members load lazily, so a follower may only be known once the member list arrives.
    room.on(RoomStateEvent.NewMember, refresh);
    return () => {
      room.removeListener(RoomEvent.Receipt, refresh);
      room.removeListener(RoomEvent.Timeline, refresh);
      room.removeListener(ThreadEvent.Update, refresh);
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
