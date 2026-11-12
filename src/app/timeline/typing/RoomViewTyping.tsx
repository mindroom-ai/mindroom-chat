import { Icon, IconButton, Icons, Text } from 'folds';
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { flushSync } from 'react-dom';
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
import { DEFAULT_THREAD_TAIL_EVENT_COUNT } from '../../matrix/thread';
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
 * The senders whose reply in the thread still streams, or undefined outside a thread. A typing
 * notice is the room's and names no thread (an agent keeps one for all its replies in a room), so
 * in a thread only these show as typing.
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

/** Whether part of the timeline row of `eventId` shows on screen, inside every scrolling area. */
const rowOnScreen = (eventId: string): boolean =>
  Array.from(document.querySelectorAll('[data-message-id]')).some((row) => {
    if (row.getAttribute('data-message-id') !== eventId) return false;
    let { top, bottom } = row.getBoundingClientRect();
    top = Math.max(top, 0);
    bottom = Math.min(bottom, window.innerHeight);
    for (let parent = row.parentElement; parent; parent = parent.parentElement) {
      if (/auto|scroll|hidden|clip/.test(getComputedStyle(parent).overflowY)) {
        const box = parent.getBoundingClientRect();
        top = Math.max(top, box.top);
        bottom = Math.min(bottom, box.bottom);
      }
    }
    return bottom > top;
  });

const NOBODY: ReadonlySet<string> = new Set();

const sameMembers = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size === b.size && Array.from(a).every((member) => b.has(member));

/** How often a watched reply's place on screen is read again; scrolling moves it. */
const ON_SCREEN_CHECK_MS = 250;

/**
 * The senders whose streaming reply shows on screen in the open thread or, outside one, in the
 * room's timeline: the reply's dots and Stop button already say that they write. Read while
 * `agentsTyping` (the typing agents' IDs, joined) names any, when it changes and a few times a
 * second.
 */
const useStreamingRepliesOnScreen = (
  room: Room,
  threadId: string | undefined,
  agentsTyping: string
): ReadonlySet<string> => {
  const watch = agentsTyping !== '';
  const [onScreen, setOnScreen] = useState(NOBODY);
  const read = useCallback(() => {
    const timelineSet =
      (threadId ? room.getThread(threadId)?.getUnfilteredTimelineSet() : undefined) ??
      room.getUnfilteredTimelineSet();
    const events = threadId
      ? getThreadStreamingEvents(room, threadId)
      : room.getLiveTimeline().getEvents().slice(-DEFAULT_THREAD_TAIL_EVENT_COUNT);
    const senders = new Set(
      events
        .filter((event) => {
          const eventId = event.getId();
          return (
            !!eventId &&
            isEventStreaming(event, getEventReactions(timelineSet, eventId), timelineSet) &&
            rowOnScreen(eventId)
          );
        })
        .flatMap((event) => event.getSender() ?? [])
    );
    setOnScreen((previous) => (sameMembers(previous, senders) ? previous : senders));
  }, [room, threadId]);
  // Before the paint: an agent that the strip would name as its reply starts streaming in the
  // thread stays out of it from that frame on.
  useLayoutEffect(() => {
    if (watch) read();
    else setOnScreen(NOBODY);
  }, [agentsTyping, read, watch]);
  useEffect(() => {
    if (!watch) return undefined;
    // A thread's rows can mount after the typing notice's layout effect. Read DOM changes
    // before paint, so the polling fallback cannot leave a strip over an already visible reply.
    const onChange = () => flushSync(read);
    const observer = new MutationObserver(onChange);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('scroll', onChange, true);
    window.addEventListener('resize', onChange);
    const timer = window.setInterval(read, ON_SCREEN_CHECK_MS);
    return () => {
      observer.disconnect();
      document.removeEventListener('scroll', onChange, true);
      window.removeEventListener('resize', onChange);
      window.clearInterval(timer);
    };
  }, [read, watch]);
  return onScreen;
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
 * Names the other members who are typing in the room, in a strip above the composer. In a thread,
 * only a member whose reply there streams: a typing notice says nothing of where the member types,
 * so a person typing in the room or in another thread would show as typing here. An agent whose
 * streaming reply shows on screen is left out, as MindRoom Chat shows no strip: the reply's dots
 * and Stop say it writes, and the strip would cover Stop as the reply grows. Dropping the status
 * hides it until the next typing update arrives for that member. In a thread, an agent whose job
 * there waits for approval is left out: MindRoom keeps its typing notice up while the reply waits
 * for the decision, and the agent waits for a person rather than writing.
 */
export function RoomViewTyping({ room, threadId }: RoomViewTypingProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const updateTyping = useSetAtom(roomIdToTypingMembersAtom);
  const myUserId = mx.getUserId();
  const awaitingApproval = useAgentsAwaitingApproval(room, threadId);
  const streaming = useThreadStreamingSenders(room, threadId);
  const isAgent = (userId: string) => isMindroomAgentUserIdForViewer(userId, myUserId ?? undefined);
  const members = useRoomTypingMember(room.roomId).filter(
    (receipt) =>
      receipt.userId !== myUserId &&
      receipt.isTyping() &&
      !awaitingApproval.has(receipt.userId) &&
      (!streaming || streaming.has(receipt.userId))
  );
  const onScreen = useStreamingRepliesOnScreen(
    room,
    threadId,
    members
      .map(({ userId }) => userId)
      .filter(isAgent)
      .join(' ')
  );
  const typing = members.filter(({ userId }) => !onScreen.has(userId));

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
            className={css.DropButton}
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
