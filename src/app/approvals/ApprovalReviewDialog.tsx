import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAppLanguageCode } from '../i18n/useAppLanguageCode';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { groupApprovalRecords } from '../matrix/protocol/threadApprovalModel';
import { describeReviewHeader } from './approvalLabels';
import { agentDisplayName, type ApprovalMemberRoom, userDisplayName } from './approvalPeople';
import { formatApprovalTime, formatExpiryDistance } from './approvalScheduleText';
import { ApprovalAgentAvatar } from './ApprovalSection';
import { ApprovalDialog, ApprovalReviewGroup } from './ThreadApprovalControls';
import { useThreadApprovals } from './ThreadApprovalProvider';

export const HISTORY_ERROR_KEYS = {
  unavailable: 'mindroomUi.messages.threadApprovalControls.historyErrors.unavailable',
  undecryptable: 'mindroomUi.messages.threadApprovalControls.historyErrors.undecryptable',
  unloadable: 'mindroomUi.messages.threadApprovalControls.historyErrors.unloadable',
} as const;

export function ApprovalReviewDialog({
  room,
  eventIds,
  onClose,
  returnFocus,
  fallbackFocus,
  children,
}: {
  room: ApprovalMemberRoom | null | undefined;
  eventIds?: readonly string[];
  onClose: () => void;
  returnFocus: React.RefObject<HTMLElement | null>;
  fallbackFocus?: () => void;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const context = useThreadApprovals();
  const user = useMatrixClient().getUserId();
  if (!context) return null;
  const reviewGroups = eventIds
    ? groupApprovalRecords(
        eventIds.flatMap((id) => context.records.find((record) => record.eventId === id) ?? [])
      )
    : [];
  const review = describeReviewHeader(reviewGroups.flat(), user);
  const reviewTitle =
    review.agents.length === 1
      ? t('mindroomUi.messages.threadApprovalControls.reviewAgentWants', {
          agent: agentDisplayName(room, review.agents[0]!),
          count: review.count,
        })
      : review.agents.length > 1
        ? t('mindroomUi.messages.threadApprovalControls.reviewAgentsWant', {
            agents: review.agents.length,
            count: review.count,
          })
        : t('mindroomUi.messages.threadApprovalControls.reviewToolCalls');
  const reviewSubtitle = [
    review.requester &&
      t('mindroomUi.messages.threadApprovalControls.reviewRequestedBy', {
        requester:
          review.requester === 'you'
            ? t('mindroomUi.messages.threadApprovalControls.you')
            : userDisplayName(room, review.requester),
      }),
    review.expiresAt &&
      t('mindroomUi.messages.threadApprovalControls.expires', {
        time:
          formatExpiryDistance(review.expiresAt, Date.now(), language) ??
          formatApprovalTime(review.expiresAt, language),
      }),
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <ApprovalDialog
      title={reviewTitle}
      subtitle={reviewSubtitle || undefined}
      leading={
        review.agents.length === 1 ? (
          <ApprovalAgentAvatar room={room} agentName={review.agents[0]!} size="300" />
        ) : undefined
      }
      onClose={onClose}
      returnFocus={returnFocus}
      fallbackFocus={fallbackFocus}
    >
      {eventIds ? (
        <>
          {reviewGroups.map((records) => (
            <ApprovalReviewGroup
              key={records[0]!.eventId}
              records={records}
              flat
              showMeta={review.agents.length > 1 || review.requester === null}
            />
          ))}
          {eventIds.some((id) => !context.records.some((record) => record.eventId === id)) && (
            <p>
              {t('mindroomUi.messages.threadApprovalControls.someRequestsAreNoLongerAvailable')}
            </p>
          )}
        </>
      ) : (
        children
      )}
    </ApprovalDialog>
  );
}
