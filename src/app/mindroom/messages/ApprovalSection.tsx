import { useTranslation } from 'react-i18next';
import React from 'react';
import classNames from 'classnames';
import { Icon, Icons, Text } from 'folds';
import { ToolApprovalData, ToolApprovalDuration } from './toolApproval';
import { formatApprovalTime, formatExpiryDistance } from './approvalScheduleText';
import { useAppLanguageCode } from '../../hooks/useAppLanguageCode';
import { agentDisplayName, ApprovalMemberRoom, userDisplayName } from './approvalPeople';
import * as css from './ThreadApprovals.css';

export type ApprovalChipTone = 'attention' | 'neutral' | 'done';

/** Operation, call count, and status for one approval section. */
export function ApprovalSectionHeader({
  operation,
  count,
  chip,
}: {
  operation: string;
  count: number;
  chip?: { label: string; tone: ApprovalChipTone };
}) {
  const { t } = useTranslation();
  return (
    <div className={css.SectionHeader}>
      <span className={css.SectionIcon} aria-hidden>
        <Icon size="50" src={Icons.Terminal} />
      </span>
      <span className={css.SectionTitle}>{operation}</span>
      {count > 1 && (
        <Text as="span" size="T200" className={css.SectionCount}>
          {t('mindroomUi.messages.threadApprovalControls.callCount', { count })}
        </Text>
      )}
      {chip && (
        <span
          className={classNames(
            css.StatusChip,
            chip.tone === 'attention' && css.StatusChipAttention,
            chip.tone === 'done' && css.StatusChipDone
          )}
        >
          {chip.label}
        </span>
      )}
    </div>
  );
}

/** Which agent asked, on whose behalf, and until when. */
export function ApprovalMeta({
  approval,
  room,
  viewerId,
}: {
  approval: ToolApprovalData;
  room: ApprovalMemberRoom | null | undefined;
  viewerId: string | null;
}) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const requester = approval.requesterId
    ? approval.requesterId === viewerId
      ? t('mindroomUi.messages.threadApprovalControls.you')
      : userDisplayName(room, approval.requesterId)
    : t('mindroomUi.messages.threadApprovalControls.unknown');
  return (
    <Text size="T200" className={css.SectionMeta}>
      {t('mindroomUi.messages.threadApprovalControls.sectionMeta', {
        agent: agentDisplayName(room, approval.agentName),
        requester,
      })}
      {approval.expiresAt &&
        ` · ${t('mindroomUi.messages.threadApprovalControls.expires', {
          time:
            formatExpiryDistance(approval.expiresAt, Date.now(), language) ??
            formatApprovalTime(approval.expiresAt, language),
        })}`}
    </Text>
  );
}

/** One segmented choice of timed auto-approval durations. */
export function ApprovalDurations({
  durations,
  disabled = false,
  onPick,
  accessibleLabel,
  explanation,
}: {
  durations: readonly ToolApprovalDuration[];
  disabled?: boolean;
  onPick: (duration: ToolApprovalDuration) => void;
  accessibleLabel: (duration: ToolApprovalDuration) => string;
  explanation?: string;
}) {
  const { t } = useTranslation();
  if (durations.length === 0) return null;
  return (
    <div className={css.Durations}>
      <div className={css.DurationRow}>
        <Text as="span" size="T200">
          {t('mindroomUi.messages.threadApprovalControls.autoApproveFor')}
        </Text>
        <div
          role="group"
          aria-label={t('mindroomUi.messages.approvalDecisionControls.autoApprovalDuration')}
          className={css.Segmented}
        >
          {durations.map((duration) => (
            <button
              key={duration}
              type="button"
              className={css.Segment}
              aria-label={accessibleLabel(duration)}
              disabled={disabled}
              onClick={() => onPick(duration)}
            >
              {t('mindroomUi.messages.threadApprovalControls.minutesShort', {
                count: duration / 60,
              })}
            </button>
          ))}
        </div>
      </div>
      {explanation && (
        <Text size="T200" className={css.SectionMeta}>
          {explanation}
        </Text>
      )}
    </div>
  );
}
