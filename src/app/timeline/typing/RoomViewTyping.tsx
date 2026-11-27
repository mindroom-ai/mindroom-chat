import classNames from 'classnames';
import { Icon, IconButton, Icons, Text } from 'folds';
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useSetAtom } from 'jotai';
import { RoomEvent, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { usePaneCollapsed } from '../../lib/hooks/usePaneCollapsed';
import { usePauseAnimationWhenHidden } from '../../lib/hooks/usePauseWhenHidden';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useRoomTypingMember } from './useRoomTypingMembers';
import { IconTooltip } from '../../ui/IconTooltip';
import { roomIdToTypingMembersAtom } from '../../matrix/state/typingMembers';
import { getMemberDisplayName } from '../../matrix/room';
import { getMxIdLocalPart } from '../../matrix/matrix';
import { useRoomActiveRuns } from '../../matrix/hooks/useRoomActiveRuns';
import type { ActiveRun } from '../../matrix/protocol/activeRunsContract';
import { roomTrustedAgents, useAgentRoomState } from '../../matrix/protocol/agentRoomState';
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
} from '../../event-store/threads/useThreadStreamingState';
import * as css from './RoomViewTyping.css';

type RoomViewTypingProps = {
  room: Room;
  /** The open thread, if any. */
  threadId?: string;
  /** Enclosing conversation box, used to scope DOM observation to this timeline. */
  containerRef?: RefObject<HTMLElement | null>;
};

/**
 * The agents with an active run in `threadId`, or undefined outside a thread. A typing notice is
 * the room's and names no thread (an agent keeps one for all its replies in a room), so in a
 * thread only these show as typing.
 */
const useThreadStreamingSenders = (
  room: Room,
  threadId: string | undefined
): ReadonlySet<string> | undefined => {
  const { runs } = useRoomActiveRuns(room);
  if (!threadId) return undefined;
  const senders = new Set<string>();
  runs.forEach((run: ActiveRun) => {
    if (run.threadId === threadId) senders.add(run.agentId);
  });
  return senders;
};

const findRowsForEvent = (root: ParentNode, eventId: string): Element[] =>
  typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? Array.from(root.querySelectorAll(`[data-message-id="${CSS.escape(eventId)}"]`))
    : Array.from(root.querySelectorAll('[data-message-id]')).filter(
        (row) => row.getAttribute('data-message-id') === eventId
      );

const findScrollRoot = (element: Element | null, boundary: Element | null): Element | null => {
  for (let p = element?.parentElement ?? null; p && p !== boundary; p = p.parentElement) {
    if (/auto|scroll|hidden|clip/.test(getComputedStyle(p).overflowY)) return p;
  }
  return null;
};

const elementOnScreen = (row: Element, scrollRoot: Element | null): boolean => {
  let { top, bottom } = row.getBoundingClientRect();
  top = Math.max(top, 0);
  bottom = Math.min(bottom, window.innerHeight);
  const clip = (box: DOMRect) => {
    top = Math.max(top, box.top);
    bottom = Math.min(bottom, box.bottom);
  };
  if (scrollRoot) clip(scrollRoot.getBoundingClientRect());
  else {
    for (let p = row.parentElement; p; p = p.parentElement) {
      if (/auto|scroll|hidden|clip/.test(getComputedStyle(p).overflowY)) {
        clip(p.getBoundingClientRect());
      }
    }
  }
  return bottom > top;
};

const getStreamingReplies = (
  room: Room,
  threadId: string | undefined,
  typingAgents: ReadonlySet<string>
): Array<{ eventId: string; sender: string }> => {
  const timelineSet =
    (threadId ? room.getThread(threadId)?.getUnfilteredTimelineSet() : undefined) ??
    room.getUnfilteredTimelineSet();
  const events = threadId
    ? getThreadStreamingEvents(room, threadId)
    : room.getLiveTimeline().getEvents().slice(-DEFAULT_THREAD_TAIL_EVENT_COUNT);
  return events.flatMap((event) => {
    const eventId = event.getId();
    const sender = event.getSender();
    return eventId &&
      sender &&
      typingAgents.has(sender) &&
      isEventStreaming(event, getEventReactions(timelineSet, eventId), timelineSet)
      ? [{ eventId, sender }]
      : [];
  });
};

const NOBODY: ReadonlySet<string> = new Set();

const sameMembers = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size === b.size && Array.from(a).every((member) => b.has(member));

/** Polling fallback interval when IntersectionObserver is unavailable (jsdom tests). */
const ON_SCREEN_CHECK_MS = 250;

/**
 * The senders whose streaming reply shows on screen in the open thread or, outside one, in the
 * room's timeline: uses a scoped IntersectionObserver on active streaming rows, with an initial
 * synchronous layout check before paint so an already-visible reply never flashes the strip.
 */
const useStreamingRepliesOnScreen = (
  room: Room,
  threadId: string | undefined,
  agentsTyping: string,
  containerRef?: RefObject<HTMLElement | null>
): ReadonlySet<string> => {
  const watch = agentsTyping !== '';
  const [onScreen, setOnScreen] = useState(NOBODY);
  const readSync = useCallback(() => {
    const typingSet = new Set(agentsTyping.split(' ').filter(Boolean));
    const scopeRoot = containerRef?.current ?? document.body;
    const timelineRows = scopeRoot.querySelector<HTMLElement>('[data-timeline-rows]');
    const scrollRoot = timelineRows
      ? findScrollRoot(timelineRows, containerRef?.current?.parentElement ?? null)
      : null;
    const senders = new Set(
      getStreamingReplies(room, threadId, typingSet)
        .filter(({ eventId }) =>
          findRowsForEvent(timelineRows ?? scopeRoot, eventId).some((row) =>
            elementOnScreen(row, scrollRoot)
          )
        )
        .map(({ sender }) => sender)
    );
    setOnScreen((previous) => (sameMembers(previous, senders) ? previous : senders));
  }, [agentsTyping, containerRef, room, threadId]);

  useLayoutEffect(() => {
    if (watch) readSync();
    else setOnScreen(NOBODY);
  }, [readSync, watch]);

  useEffect(() => {
    if (!watch) return undefined;
    const scopeRoot = containerRef?.current ?? document.body;
    if (typeof IntersectionObserver !== 'function') {
      const onChange = () => flushSync(readSync);
      const observer = new MutationObserver(onChange);
      observer.observe(scopeRoot, { childList: true, subtree: true });
      document.addEventListener('scroll', onChange, true);
      window.addEventListener('resize', onChange);
      const timer = window.setInterval(readSync, ON_SCREEN_CHECK_MS);
      return () => {
        observer.disconnect();
        document.removeEventListener('scroll', onChange, true);
        window.removeEventListener('resize', onChange);
        window.clearInterval(timer);
      };
    }

    const typingSet = new Set(agentsTyping.split(' ').filter(Boolean));
    const observed = new Map<Element, { eventId: string; sender: string }>();
    const visible = new Map<Element, string>();
    let cachedTimelineRows: HTMLElement | null | undefined;
    let cachedScrollRoot: Element | null = null;
    let io: IntersectionObserver | undefined;
    let ioRoot: Element | null | undefined;
    let mo: MutationObserver | undefined;
    let moKey = '';

    const publish = () => {
      const next = new Set(visible.values());
      setOnScreen((previous) => (sameMembers(previous, next) ? previous : next));
    };

    const syncTargets = () => {
      const timelineRows = scopeRoot.querySelector<HTMLElement>('[data-timeline-rows]');
      if (timelineRows !== cachedTimelineRows) {
        cachedTimelineRows = timelineRows;
        cachedScrollRoot = timelineRows
          ? findScrollRoot(timelineRows, containerRef?.current?.parentElement ?? null)
          : null;
      }
      if (!io || ioRoot !== cachedScrollRoot) {
        io?.disconnect();
        observed.clear();
        visible.clear();
        ioRoot = cachedScrollRoot;
        io = new IntersectionObserver(
          (entries) => {
            let needsResync = false;
            for (const entry of entries) {
              const info = observed.get(entry.target);
              if (!info) continue;
              if (entry.isIntersecting && entry.target.isConnected) {
                visible.set(entry.target, info.sender);
              } else {
                visible.delete(entry.target);
                if (!entry.target.isConnected) {
                  io?.unobserve(entry.target);
                  observed.delete(entry.target);
                  needsResync = true;
                }
              }
            }
            publish();
            if (needsResync) syncTargets();
          },
          { root: cachedScrollRoot, threshold: 0 }
        );
      }

      const replies = getStreamingReplies(room, threadId, typingSet);
      const activeById = new Map(replies.map(({ eventId, sender }) => [eventId, sender]));
      for (const [el, info] of observed) {
        if (!el.isConnected || activeById.get(info.eventId) !== info.sender) {
          io.unobserve(el);
          observed.delete(el);
          visible.delete(el);
        }
      }
      const trackedSenders = new Set<string>();
      for (const { eventId, sender } of replies) {
        for (const row of findRowsForEvent(timelineRows ?? scopeRoot, eventId)) {
          if (!observed.has(row)) {
            observed.set(row, { eventId, sender });
            io.observe(row);
            if (elementOnScreen(row, cachedScrollRoot)) visible.set(row, sender);
          }
          trackedSenders.add(sender);
        }
      }
      publish();

      const target = timelineRows ?? scopeRoot;
      const subtree = !timelineRows;
      const needMo = timelineRows !== null || Array.from(typingSet).some((s) => !trackedSenders.has(s));
      const nextKey = needMo ? `${subtree ? 's' : 'd'}:${timelineRows ? 't' : 'r'}` : '';
      if (nextKey !== moKey) {
        mo?.disconnect();
        mo = undefined;
        moKey = nextKey;
        if (needMo) {
          mo = new MutationObserver(syncTargets);
          mo.observe(target, subtree ? { childList: true, subtree: true } : { childList: true });
        }
      }
    };

    syncTargets();
    const onTimeline = (event: MatrixEvent, eventRoom: Room | undefined) => {
      if (eventRoom?.roomId === room.roomId && !event.isRelation()) syncTargets();
    };
    room.on(RoomEvent.Timeline, onTimeline);
    return () => {
      room.removeListener(RoomEvent.Timeline, onTimeline);
      mo?.disconnect();
      io?.disconnect();
    };
  }, [agentsTyping, containerRef, readSync, room, threadId, watch]);

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
  const ref = useRef<HTMLSpanElement>(null);
  usePauseAnimationWhenHidden(ref);
  return (
    <span ref={ref} className={css.TypingDots} aria-hidden>
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
export function RoomViewTyping(props: RoomViewTypingProps) {
  if (usePaneCollapsed()) return null;
  return <RoomViewTypingActive {...props} />;
}

function RoomViewTypingActive({ room, threadId, containerRef }: RoomViewTypingProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const updateTyping = useSetAtom(roomIdToTypingMembersAtom);
  const myUserId = mx.getUserId();
  const awaitingApproval = useAgentsAwaitingApproval(room, threadId);
  const streaming = useThreadStreamingSenders(room, threadId);
  let trustedAgents: ReadonlySet<string> | undefined;
  const isAgent = (userId: string) => {
    if (isMindroomAgentUserIdForViewer(userId, myUserId ?? undefined)) return true;
    trustedAgents ??= roomTrustedAgents(room);
    return trustedAgents.has(userId);
  };
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
      .join(' '),
    containerRef
  );
  const typing = members.filter(({ userId }) => !onScreen.has(userId));
  const scope = `${room.roomId}\0${threadId ?? ''}`;
  const emptyInScopeRef = useRef<string>(undefined);
  const isEmpty = typing.length === 0;
  const animateArrive = emptyInScopeRef.current === scope;
  useEffect(() => {
    if (isEmpty) emptyInScopeRef.current = scope;
    else if (emptyInScopeRef.current !== scope) emptyInScopeRef.current = undefined;
  }, [isEmpty, scope]);

  if (isEmpty) return null;

  const names = typing.map(
    ({ userId }) => getMemberDisplayName(room, userId) ?? getMxIdLocalPart(userId) ?? userId
  );
  const message = <NamesSentence keys={TYPING_KEYS} names={names} />;

  const dropLabel = t('featureUi.room.typing.dropTypingStatus');
  const dropTyping = () =>
    typing.forEach(({ userId }) => updateTyping({ type: 'DELETE', roomId: room.roomId, userId }));

  return (
    <div
      className={classNames(css.TypingStrip, animateArrive && css.TypingStripArriving)}
      role="status"
      aria-live="polite"
    >
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
