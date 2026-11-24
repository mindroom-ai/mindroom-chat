import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from 'jotai';
import { Button, Text } from 'folds';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { isLiveWorkflowRunStatus } from '../../matrix/protocol/workflowFrame';
import type { WorkflowRunCard as WorkflowRunCardData } from '../../matrix/protocol/workflowRunContent';
import { openWorkflowRunPanel } from '../../navigation/workflowPanel';
import { ownDirectionBlock, ownDirectionLine } from '../../ui/directional';
import { getWorkflowRunStore, selectWorkflowRun, useWorkflowRun } from '../live/workflowRunStore';
import * as questionCss from '../question/QuestionCard.css';
import { workflowRunHeading } from './workflowRunLabels';
import {
  useWorkflowRunActions,
  WorkflowRunActionButtons,
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
  readOnly?: boolean;
};

/** Renders a workflow run's durable notice card, overlaid with live ephemeral frames when newer. */
export function WorkflowRunCard({
  card,
  roomId,
  threadId = null,
  sender,
  readOnly = false,
}: WorkflowRunCardProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const jotaiStore = useStore();
  const room = mx.getRoom(roomId);
  const stored = useWorkflowRun(roomId, card.run);

  useEffect(() => {
    getWorkflowRunStore(mx).showCard(roomId, sender ?? '', card, Date.now(), threadId);
  }, [card, mx, roomId, sender, threadId]);

  const view = selectWorkflowRun(stored?.live, {
    sender: sender ?? '',
    card,
    receivedAt: 0,
    threadId,
  })!;
  const isLive = isLiveWorkflowRunStatus(view.status);
  const heading = workflowRunHeading(view, t);
  const phases = view.graph?.phases.length ? view.graph.phases : card.phases;
  const showGraph = !!view.graph;
  const actions = useWorkflowRunActions({
    room,
    roomId,
    run: card.run,
    jobId: card.jobId,
    requester: card.requester,
    status: view.status,
    attempt: view.attempt,
    threadId,
    readOnly,
  });

  return (
    <section
      className={css.Card}
      aria-label={heading}
      data-workflow-run-card={card.run}
      data-workflow-run-status={view.status}
    >
      <div className={css.Row} style={{ gap: '4px' }}>
        <WorkflowRunTitleBadges
          heading={heading}
          name={view.name}
          title={view.title}
          status={view.status}
          attempt={view.attempt}
          large={view.large}
        />
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
      <WorkflowRunMetrics
        counts={view.counts}
        usage={view.usage}
        startedAt={view.startedAt}
        endedAt={view.endedAt}
        isLive={isLive}
        showFailed
      />
      {!isLive && view.error && (
        <Text size="T200" className={css.ErrorLine} {...ownDirectionBlock}>
          {view.error}
        </Text>
      )}
      {(showGraph || actions.showStop || actions.showResume || actions.showRunAgain) && (
        <div className={css.Row}>
          {showGraph && (
            <Button
              type="button"
              size="300"
              variant="Secondary"
              fill="Soft"
              onClick={() => {
                getWorkflowRunStore(mx).showCard(roomId, sender ?? '', card, Date.now(), threadId);
                openWorkflowRunPanel(jotaiStore, roomId, card.run, threadId);
              }}
            >
              <Text size="B300">{t('mindroomUi.workflowRun.graph')}</Text>
            </Button>
          )}
          <WorkflowRunActionButtons room={room} actions={actions} />
        </div>
      )}
      {actions.actionError && (
        <Text role="alert" size="T200" className={questionCss.Failed}>
          {actions.actionError}
        </Text>
      )}
    </section>
  );
}
