import { Icon, IconButton, Icons, Text } from 'folds';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSetAtom } from 'jotai';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useRoomTypingMember } from './useRoomTypingMembers';
import { IconTooltip } from '../../ui/IconTooltip';
import { roomIdToTypingMembersAtom } from '../../matrix/state/typingMembers';
import { getMemberDisplayName } from '../../matrix/room';
import { getMxIdLocalPart } from '../../matrix/matrix';
import { useAgentRoomState } from '../../matrix/protocol/agentRoomState';
import {
  MINDROOM_BACKGROUND_JOBS_EVENT,
  parseBackgroundJobsStateEvent,
} from '../../matrix/protocol/backgroundJobsContract';
import { NamesSentence } from './NamesSentence';
import { getEventReactions } from '../../matrix/room';
import { isMindroomAgentUserIdForViewer } from '../../matrix/protocol/agentIdentity';
import {
  getThreadStreamingEvents,
  isEventStreaming,
  useThreadStreamingState,
} from '../../event-store/threads/useThreadStreamingState';
import * as css from './RoomViewTyping.css';

type RoomViewTypingProps = {
  room: Room;
  /** The open thread, if any. */
  threadId?: string;
};

/**
 * The senders whose reply in the thread still streams, or undefined outside a thread. An agent
 * keeps one typing notice for all its replies in a room, so only these name the agent as typing.
 */
const useThreadStreamingSenders = (room: Room, threadId: string | undefined) => {
  // Re-renders whenever the thread's latest replies change.
  useThreadStreamingState(room, threadId);
  if (!threadId) return undefined;
  const timelineSet =
    room.getThread(threadId)?.getUnfilteredTimelineSet() ?? room.getUnfilteredTimelineSet();
  return new Set(
    getThreadStreamingEvents(room, threadId)
      .filter((event) => {
        const eventId = event.getId();
        const reactions = eventId ? getEventReactions(timelineSet, eventId) : undefined;
        return isEventStreaming(event, reactions, timelineSet);
      })
      .map((event) => event.getSender())
  );
};

// Sentences for one to four typing members; five and more share the last one.
const TYPING_KEYS = [
  'featureUi.room.typing.one',
  'featureUi.room.typing.two',
  'featureUi.room.typing.three',
  'featureUi.room.typing.four',
  'featureUi.room.typing.many',
] as const;

/** Three dots that take turns rising, the usual sign that someone is writing. */
function TypingDots() {
  return (
    <span className={css.TypingDots} aria-hidden>
      <span className={css.TypingDot} />
      <span className={css.TypingDot} />
      <span className={css.TypingDot} />
    </span>
  );
}

/** The agents whose job in the thread waits for its approval, from the jobs state they publish. */
const useAgentsAwaitingApproval = (room: Room, threadId: string | undefined): Set<string> => {
  const select = useCallback(
    (events: MatrixEvent[]) =>
      new Set(
        events
          .filter((event) =>
            parseBackgroundJobsStateEvent(event).some(
              (job) => !!threadId && job.threadId === threadId && job.status === 'awaiting_approval'
            )
          )
          .flatMap((event) => event.getSender() ?? [])
      ),
    [threadId]
  );
  return useAgentRoomState(room, MINDROOM_BACKGROUND_JOBS_EVENT, select);
};

/**
 * Names the other members who are typing in the room, in a strip above the composer; in a thread,
 * an agent only while its reply there streams. Dropping the status hides it until the next typing
 * update arrives for that member. In a thread, an agent whose job there waits for approval is left
 * out: MindRoom keeps its typing notice up while the reply waits for the decision, and the agent
 * waits for a person rather than writing.
 */
export function RoomViewTyping({ room, threadId }: RoomViewTypingProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const updateTyping = useSetAtom(roomIdToTypingMembersAtom);
  const myUserId = mx.getUserId();
  const awaitingApproval = useAgentsAwaitingApproval(room, threadId);
  const streaming = useThreadStreamingSenders(room, threadId);
  const typing = useRoomTypingMember(room.roomId).filter(
    (receipt) =>
      receipt.userId !== myUserId &&
      receipt.isTyping() &&
      !awaitingApproval.has(receipt.userId) &&
      (!streaming ||
        streaming.has(receipt.userId) ||
        !isMindroomAgentUserIdForViewer(receipt.userId, myUserId ?? undefined))
  );

  if (typing.length === 0) return null;

  const names = typing.map(
    ({ userId }) => getMemberDisplayName(room, userId) ?? getMxIdLocalPart(userId) ?? userId
  );
  const message = <NamesSentence keys={TYPING_KEYS} names={names} />;

  const dropLabel = t('featureUi.room.typing.dropTypingStatus');
  const dropTyping = () =>
    typing.forEach(({ userId }) => updateTyping({ type: 'DELETE', roomId: room.roomId, userId }));

  return (
    <div className={css.TypingStrip} role="status" aria-live="polite">
      <TypingDots />
      <Text className={css.TypingText} size="T200" priority="300" truncate>
        {message}
      </Text>
      <IconTooltip label={dropLabel} position="Top">
        {(triggerRef) => (
          <IconButton
            ref={triggerRef}
            size="300"
            radii="Pill"
            variant="SurfaceVariant"
            fill="None"
            aria-label={dropLabel}
            onClick={dropTyping}
          >
            <Icon size="50" src={Icons.Cross} />
          </IconButton>
        )}
      </IconTooltip>
    </div>
  );
}
