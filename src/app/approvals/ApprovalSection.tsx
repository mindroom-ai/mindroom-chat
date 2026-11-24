import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import { Avatar, Icon, Icons, IconSrc, Text } from 'folds';
import { ToolApprovalData, ToolApprovalDuration } from '../matrix/protocol/toolApproval';
import { formatApprovalTime, formatExpiryDistance } from './approvalScheduleText';
import { useAppLanguageCode } from '../i18n/useAppLanguageCode';
import {
  agentDisplayName,
  agentMember,
  ApprovalMemberRoom,
  userDisplayName,
} from './approvalPeople';
import { UserAvatar } from '../avatars/UserAvatar';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../matrix/hooks/useMediaAuthentication';
import { mxcUrlToHttp } from '../matrix/mediaUrl';
import { toolTitle } from './approvalLabels';
import type { ApprovalChipLabel, describeApprovalChip } from './approvalLabels';
import * as css from './ThreadApprovals.css';
import { IsolatedText, ownDirectionLine } from '../ui/directional';

const CHIP_LABEL_KEYS = {
  waitingForYou: 'mindroomUi.messages.threadApprovalControls.waitingForYou',
  waitingForApproval: 'mindroomUi.messages.threadApprovalControls.waitingForApproval',
  sending: 'mindroomUi.messages.threadApprovalControls.chipSending',
  submitted: 'mindroomUi.messages.threadApprovalControls.chipSubmitted',
  approved: 'mindroomUi.messages.approvalReviewCall.status.approved',
  denied: 'mindroomUi.messages.approvalReviewCall.status.denied',
  expired: 'mindroomUi.messages.approvalReviewCall.status.expired',
  resolved: 'mindroomUi.messages.threadApprovalControls.chipResolved',
} as const satisfies Record<ApprovalChipLabel, string>;

// A recognizable glyph for common tools; anything else reads as a command.
const toolIcon = (operation: string): IconSrc => {
  const name = operation.toLowerCase();
  if (/mail/.test(name)) return Icons.Mail;
  if (/message|chat|post_to|notify/.test(name)) return Icons.Message;
  if (/webhook|http|url|fetch|request/.test(name)) return Icons.Link;
  if (/schedule|calendar|event/.test(name)) return Icons.Clock;
  if (/search|query|lookup/.test(name)) return Icons.Search;
  if (/file|write|read|edit|upload|download/.test(name)) return Icons.File;
  return Icons.Terminal;
};

/** The agent's room avatar, falling back to its colored initial tile. */
export function ApprovalAgentAvatar({
  room,
  agentName,
  size = '200',
}: {
  room: ApprovalMemberRoom | null | undefined;
  agentName: string;
  size?: '200' | '300';
}) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const member = agentMember(room, agentName);
  const mxc = member?.getMxcAvatarUrl?.();
  const name = member?.name || agentName;
  return (
    <Avatar size={size} radii="400" aria-hidden>
      <UserAvatar
        userId={member?.userId ?? agentName}
        src={
          mxc ? mxcUrlToHttp(mx, mxc, useAuthentication, 64, 64, 'crop') ?? undefined : undefined
        }
        alt={name}
        renderFallback={() => <Icon size="100" src={Icons.User} filled />}
      />
    </Avatar>
  );
}

/** Operation, call count, and status for one approval section. */
export function ApprovalSectionHeader({
  operation,
  count,
  chip,
}: {
  operation: string;
  count: number;
  chip?: ReturnType<typeof describeApprovalChip>;
}) {
  const { t } = useTranslation();
  return (
    <div className={css.SectionHeader}>
      <span className={css.SectionIcon} aria-hidden>
        <Icon size="100" src={toolIcon(operation)} />
      </span>
      <span className={css.SectionTitle}>{toolTitle(operation)}</span>
      <span className={css.SectionTool} {...ownDirectionLine}>
        {operation}
      </span>
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
          {t(CHIP_LABEL_KEYS[chip.label])}
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
      <IsolatedText
        text={t('mindroomUi.messages.threadApprovalControls.sectionMeta', {
          agent: agentDisplayName(room, approval.agentName),
          requester,
        })}
      />
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
              // The name starts with the words on the button, so speech control finds it.
              aria-label={t('sharedUi.approvalDurations.name', {
                short: t('mindroomUi.messages.threadApprovalControls.minutesShort', {
                  count: duration / 60,
                }),
                long: accessibleLabel(duration),
              })}
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
