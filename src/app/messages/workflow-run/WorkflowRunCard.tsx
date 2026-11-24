import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from 'jotai';
import { Button, Text } from 'folds';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useRoomOptionally } from '../../matrix/hooks/useRoom';
import { isLiveWorkflowRunStatus } from '../../matrix/protocol/workflowFrame';
import type { WorkflowRunCard as WorkflowRunCardData } from '../../matrix/protocol/workflowRunContent';
import { openWorkflowRunPanel } from '../../navigation/workflowPanel';
import { ownDirectionBlock, ownDirectionLine } from '../../ui/directional';
import { getWorkflowRunStore, selectWorkflowRun, useWorkflowRun } from '../live/workflowRunStore';
import { workflowRunHeading } from './workflowRunLabels';
import {
  WorkflowRunControls,
  WorkflowRunMetrics,
  WorkflowRunTitleBadges,
} from './WorkflowRunSummary';
import * as css from './WorkflowRunCard.css';

export type WorkflowRunCardProps = {
  card: WorkflowRunCardData;
  roomId: string;
  threadId?: string | null;
  eventId?: string;
  sender?: string;
  updatedAt?: number;
  readOnly?: boolean;
};

const cardObservedAtMap = new WeakMap<WorkflowRunCardData, number>();
const cardTimestamp = (card: WorkflowRunCardData, updatedAt?: number): number => {
  if (updatedAt && updatedAt > 0) return updatedAt;
  let ts = cardObservedAtMap.get(card);
  if (ts === undefined) cardObservedAtMap.set(card, (ts = Date.now()));
  return ts;
};

/** Renders a workflow run's durable notice card, overlaid with live ephemeral frames when newer. */
export function WorkflowRunCard({
  card,
  roomId,
  threadId = null,
  sender,
  updatedAt,
  readOnly = false,
}: WorkflowRunCardProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const jotaiStore = useStore();
  const displayedRoom = useRoomOptionally();
  const room = mx.getRoom(roomId);
  const stored = useWorkflowRun(roomId, card.run);
  const cardObservedAt = cardTimestamp(card, updatedAt);

  useEffect(() => {
    getWorkflowRunStore(mx).showCard(roomId, sender ?? '', card, cardObservedAt, threadId);
  }, [card, cardObservedAt, mx, roomId, sender, threadId]);

  const view = selectWorkflowRun(stored?.live, {
    sender: sender ?? '',
    card,
    receivedAt: cardObservedAt,
    threadId,
  })!;
  const isLive = isLiveWorkflowRunStatus(view.status);
  const heading = workflowRunHeading(view, t);
  const phases = view.graph?.phases.length ? view.graph.phases : card.phases;
  const graphButton =
    view.graph && (!displayedRoom || displayedRoom.roomId === roomId) ? (
      <Button
        type="button"
        size="300"
        variant="Secondary"
        fill="Soft"
        onClick={() => {
          getWorkflowRunStore(mx).showCard(roomId, sender ?? '', card, cardObservedAt, threadId);
          openWorkflowRunPanel(jotaiStore, roomId, card.run, threadId);
        }}
      >
        <Text size="B300">{t('mindroomUi.workflowRun.graph')}</Text>
      </Button>
    ) : null;

  return (
    <section
      className={css.Card}
      aria-label={heading}
      data-workflow-run-card={card.run}
      data-workflow-run-status={view.status}
    >
      <div className={css.Row} style={{ gap: '4px' }}>
        <WorkflowRunTitleBadges heading={heading} view={view} showRunBadges />
      </div>
      {phases.length > 0 && (
        <ul className={css.Phases} aria-label={t('mindroomUi.workflowRun.title')}>
          {phases.map((phase) => (
            <li key={phase} className={css.Pill} {...ownDirectionLine}>
              {phase}
            </li>
          ))}
        </ul>
      )}
      <WorkflowRunMetrics view={view} isLive={isLive} showFailed />
      {!isLive && view.error && (
        <Text size="T200" className={css.ErrorLine} {...ownDirectionBlock}>
          {view.error}
        </Text>
      )}
      {room ? (
        <WorkflowRunControls
          room={room}
          run={card.run}
          view={view}
          jobId={card.jobId}
          threadId={threadId}
          readOnly={readOnly}
          leading={graphButton}
        />
      ) : (
        graphButton && <div className={css.Row}>{graphButton}</div>
      )}
    </section>
  );
}
