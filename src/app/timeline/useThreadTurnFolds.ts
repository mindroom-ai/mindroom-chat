import { useCallback, useMemo, useState } from 'react';
import type { EventTimelineSet, MatrixEvent, Room } from 'matrix-js-sdk';
import { useThreadApprovals } from '../approvals/ThreadApprovalProvider';
import { isThreadReplyStreaming } from '../event-store/threads/useThreadStreamingState';
import type { ThreadWorkflowStatus } from '../event-store/threads/threadWorkflow';
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
import { resolveMinimapSourceKind } from './timelineMinimapViewModel';
import {
  EMPTY_TURN_FOLD_VIEW,
  planThreadTurnFolds,
  viewThreadTurnFolds,
  type ThreadTurnFold,
  type ThreadTurnFoldView,
} from './threadTurnFolds';

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
  /** The thread's workflow state, which tells whether it still works on its newest turn. */
  threadStatus: ThreadWorkflowStatus | undefined;
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
  threadStatus,
  manualExpansionState,
  expandAllInit,
}: UseThreadTurnFoldsOptions): {
  view: ThreadTurnFoldView;
  toggle: (fold: ThreadTurnFold) => void;
} => {
  const pendingApprovalIds = useThreadApprovals()?.pendingEventIds;
  const lastTurnBusy =
    !!threadStatus &&
    (threadStatus.isStreaming ||
      !!threadStatus.hasBackgroundJob ||
      !!threadStatus.hasBackgroundApproval);
  const folds = useMemo(() => {
    if (!threadId) return [];
    const now = Date.now();
    const isAgentMessage = (event: MatrixEvent) => resolveMinimapSourceKind(event) === 'agent';
    return planThreadTurnFolds(events, {
      isPersonMessage: (event) => {
        const kind = resolveMinimapSourceKind(event);
        return kind === 'user' || kind === 'redactedUser';
      },
      isSkipped,
      isAnswer: (event) =>
        isAgentMessage(event) && !isQuietMarker(event) && getContent(event).msgtype !== 'm.notice',
      isQuietMarker,
      holdsTurn: (event, lastTurn) => {
        const eventId = event.getId() ?? '';
        if (pendingApprovalIds?.has(eventId)) return true;
        if (MINDROOM_SECRET_REQUEST_KEY in event.getOriginalContent()) {
          const request = parseSecretRequestContent(getContent(event));
          if (request && effectiveSecretRequestStatus(request, now) === 'pending') return true;
        }
        if (!isAgentMessage(event)) return false;
        if (isThreadReplyStreaming(room, event, timelineSet)) return true;
        // A question waits only in the newest turn: a person's message after it answers it.
        const question = lastTurn
          ? readInteractiveQuestion(getContent(event), event.getOriginalContent())
          : undefined;
        return !!question && !readRoomQuestionAnswer(room, eventId, question, viewerId);
      },
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
