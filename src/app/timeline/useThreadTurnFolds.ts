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
import { rememberManualExpansionState } from '../messages/manualExpansionState';
import {
  EMPTY_TURN_FOLD_VIEW,
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

/** Where the timeline keeps the reader's choice for a turn, apart from its messages' folds. */
const turnFoldKey = (fold: ThreadTurnFold) => `turnFold:${fold.key}`;

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
  /** The timeline's manual expansion state and its expand all baseline (manualExpansionState). */
  manualExpansionState: Map<string, boolean>;
  expandAllInit: boolean | undefined;
};

/**
 * The open thread's finished turns folded behind their breaks, each open where the reader opened
 * it. The choice lives in the timeline's manual expansion state, so it lasts while the rows
 * remount, and a turn the reader never chose for follows the timeline's expand all.
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
  manualExpansionState,
  expandAllInit,
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
  // The reader's choices live in the shared map; a toggle renders the timeline again.
  const [choices, setChoices] = useState(0);
  const view = useMemo(() => {
    void choices;
    if (folds.length === 0) return EMPTY_TURN_FOLD_VIEW;
    return viewThreadTurnFolds(
      folds,
      (fold) => manualExpansionState.get(turnFoldKey(fold)) ?? expandAllInit ?? false
    );
  }, [choices, expandAllInit, folds, manualExpansionState]);
  const toggle = useCallback(
    (fold: ThreadTurnFold) => {
      const key = turnFoldKey(fold);
      const open = manualExpansionState.get(key) ?? expandAllInit ?? false;
      rememberManualExpansionState(manualExpansionState, key, !open);
      setChoices((count) => count + 1);
    },
    [expandAllInit, manualExpansionState]
  );
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
  const previous = useRef<ReadonlyMap<string, boolean>>(new Map());
  useLayoutEffect(() => {
    const hosts = new Map([...view.breaks].map(([id, { open }]) => [id, open]));
    const before = previous.current;
    previous.current = hosts;
    const changed = (id: string) =>
      (hosts.has(id) || before.has(id)) && hosts.get(id) !== before.get(id);
    events.forEach((event, index) => {
      const id = event.getId();
      // A row unmounted in this commit can still be in the cache, detached.
      if (id && changed(id) && !virtualizer.elementsCache.get(id)?.isConnected) {
        virtualizer.resizeItem(index, estimate(index));
      }
    });
  }, [virtualizer, events, view, estimate]);
};
