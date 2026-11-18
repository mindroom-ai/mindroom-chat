import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { EventTimelineSet, MatrixEvent, Room } from 'matrix-js-sdk';
import type { Virtualizer } from '@tanstack/react-virtual';
import { useThreadApprovals } from '../approvals/ThreadApprovalProvider';
import { isEventStreaming } from '../event-store/threads/useThreadStreamingState';
import type { ThreadBackgroundState } from '../matrix/protocol/threadBackgroundJobs';
import { getEventReactions } from '../matrix/room';
import {
  readInteractiveQuestion,
  readRoomQuestionAnswer,
} from '../matrix/protocol/interactiveQuestion';
import {
  MINDROOM_SECRET_REQUEST_KEY,
  effectiveSecretRequestStatus,
  parseSecretRequestContent,
} from '../matrix/protocol/secretRequest';
import {
  planThreadTurnFolds,
  threadRowAuthor,
  viewThreadTurnFolds,
  type ThreadTurnFold,
  type ThreadTurnFoldView,
} from './threadTurnFolds';

type TurnRowContext = {
  room: Room;
  timelineSet: EventTimelineSet;
  getContent: (event: MatrixEvent) => Record<string, unknown>;
  /** The thread's approvals that wait for a decision (ThreadApprovalProvider). */
  pendingApprovalIds: ReadonlySet<string> | undefined;
  viewerId: string | undefined;
  now: number;
};

/**
 * Whether a thread row keeps its turn unfolded (`ThreadTurnRules.holdsTurn`): it cannot tell who
 * wrote it, it is an approval or a secret request that waits for the reader, an agent's reply
 * that says it streams, or an agent's question no reaction answered.
 */
export const turnRowWaits = (
  event: MatrixEvent,
  { room, timelineSet, getContent, pendingApprovalIds, viewerId, now }: TurnRowContext
): boolean => {
  const eventId = event.getId() ?? '';
  const author = threadRowAuthor(event);
  if (author === 'unknown') return true;
  if (pendingApprovalIds?.has(eventId)) return true;
  if (MINDROOM_SECRET_REQUEST_KEY in event.getOriginalContent()) {
    const request = parseSecretRequestContent(getContent(event));
    if (request && effectiveSecretRequestStatus(request, now) === 'pending') return true;
  }
  if (author !== 'agent') return false;
  // A reply that says it streams has not finished, also while the client has yet to vouch for it
  // (isStreamingReplyCurrent): its turn folds once it says it ended.
  // One whose writer died mid-stream keeps holding: its turn shows whole, as without folds.
  if (isEventStreaming(event, getEventReactions(timelineSet, eventId), timelineSet)) return true;
  // A question waits until a reaction answers it, as its card reads it (QuestionCard), whatever
  // the person wrote since.
  const question = readInteractiveQuestion(getContent(event), event.getOriginalContent());
  return !!question && !readRoomQuestionAnswer(room, eventId, question, viewerId);
};

/**
 * Whether a row can answer its turn (`ThreadTurnRules.isAnswer`): an agent's message, as it shows
 * now, that is not redacted, not a notice and not a quiet marker.
 */
export const isTurnAnswer = (
  event: MatrixEvent,
  getContent: (event: MatrixEvent) => Record<string, unknown>,
  isQuietMarker: (event: MatrixEvent) => boolean
): boolean =>
  threadRowAuthor(event) === 'agent' &&
  !event.isRedacted() &&
  !isQuietMarker(event) &&
  getContent(event).msgtype !== 'm.notice';

type UseThreadTurnFoldsOptions = {
  room: Room;
  /** Only an open thread folds its turns. */
  threadId: string | undefined;
  /** The thread's rows, in order. */
  events: readonly MatrixEvent[];
  viewerId: string | undefined;
  /** What a row shows, its latest edit included. */
  getContent: (event: MatrixEvent) => Record<string, unknown>;
  timelineSet: EventTimelineSet;
  /** A row the timeline draws nothing for already (roomTimelineRows `isTimelineRowHidden`). */
  isSkipped: (event: MatrixEvent) => boolean;
  /** As the renderer reads a quiet marker row (`isQuietMarkerRow`). */
  isQuietMarker: (event: MatrixEvent) => boolean;
  /** Rows that must stay in view (`ThreadTurnRules.pinnedIds`). */
  pinnedIds: ReadonlySet<string>;
  /** The thread's live background jobs, which work on its newest turn (`threadBackgroundJobs`). */
  backgroundState: ThreadBackgroundState | undefined;
};

/**
 * The open thread's finished turns folded behind their breaks, each open where the reader opened
 * it. The choice lives with the timeline, so it lasts while the rows remount.
 */
export const useThreadTurnFolds = ({
  room,
  threadId,
  events,
  viewerId,
  getContent,
  timelineSet,
  isSkipped,
  isQuietMarker,
  pinnedIds,
  backgroundState,
}: UseThreadTurnFoldsOptions): {
  view: ThreadTurnFoldView;
  toggle: (fold: ThreadTurnFold) => void;
} => {
  const pendingApprovalIds = useThreadApprovals()?.pendingEventIds;
  // A reply streaming in the newest turn holds it from its own row (`holdsTurn`).
  const lastTurnBusy =
    !!backgroundState?.hasBackgroundJob || !!backgroundState?.hasBackgroundApproval;
  const folds = useMemo(() => {
    if (!threadId) return [];
    const now = Date.now();
    return planThreadTurnFolds(events, {
      isPersonMessage: (event) => threadRowAuthor(event) === 'person',
      isSkipped,
      isAnswer: (event) => isTurnAnswer(event, getContent, isQuietMarker),
      isQuietMarker,
      holdsTurn: (event) =>
        turnRowWaits(event, { room, timelineSet, getContent, pendingApprovalIds, viewerId, now }),
      pinnedIds,
      lastTurnBusy,
    });
  }, [
    events,
    getContent,
    isQuietMarker,
    isSkipped,
    lastTurnBusy,
    pendingApprovalIds,
    pinnedIds,
    room,
    threadId,
    timelineSet,
    viewerId,
  ]);
  // The turns the reader opened, by `ThreadTurnFold.key`.
  const [openKeys, setOpenKeys] = useState<ReadonlySet<string>>(() => new Set());
  const view = useMemo(
    () => viewThreadTurnFolds(folds, (fold) => openKeys.has(fold.key)),
    [folds, openKeys]
  );
  const toggle = useCallback((fold: ThreadTurnFold) => {
    setOpenKeys((keys) => {
      const next = new Set(keys);
      if (!next.delete(fold.key)) next.add(fold.key);
      return next;
    });
  }, []);
  return { view, toggle };
};

/**
 * Gives the row that draws a turn's break its estimate again whenever the turn opens or folds, or
 * the row starts or stops drawing one, while the row is not mounted: the size measured before
 * would otherwise last (a long first reply, folded, kept its height off screen). A mounted row
 * measures itself.
 */
export const useTurnBreakRowMeasurements = (
  virtualizer: Virtualizer<HTMLDivElement, Element>,
  events: readonly MatrixEvent[],
  view: ThreadTurnFoldView,
  estimate: (index: number) => number
) => {
  const previous = useRef<ThreadTurnFoldView['breaks']>(new Map());
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = view.breaks;
    events.forEach((event, index) => {
      const id = event.getId();
      const changed = id && view.breaks.get(id)?.open !== before.get(id)?.open;
      // A row unmounted in this commit can still be in the cache, detached.
      if (changed && !virtualizer.elementsCache.get(id)?.isConnected) {
        virtualizer.resizeItem(index, estimate(index));
      }
    });
  }, [virtualizer, events, view, estimate]);
};
