import type { MouseEvent, ReactNode } from 'react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import {
  Avatar,
  Button,
  Chip,
  Icon,
  IconButton,
  Icons,
  Switch,
  Text,
  Tooltip,
  type IconSrc,
} from 'folds';
import { UserAvatar } from '../avatars/UserAvatar';
import { TooltipProvider, ownDirectionLine } from '../ui/directional';
import type { ActivityKind, ActivityTab } from './activityRows';
import * as css from './ActivityList.css';

export const ACTIVITY_TABS: readonly ActivityTab[] = ['all', 'mentions', 'replies', 'needsYou'];

export const ACTIVITY_KIND_ICONS: Record<ActivityKind, { icon: IconSrc; className?: string }> = {
  approval: { icon: Icons.Lock, className: css.KindAttention },
  question: { icon: Icons.Info, className: css.KindAttention },
  invite: { icon: Icons.Mail, className: css.KindAttention },
  mention: { icon: Icons.Mention, className: css.KindMention },
  reply: { icon: Icons.ReplyArrow },
  finished: { icon: Icons.Check, className: css.KindDone },
  stopped: { icon: Icons.Cross, className: css.KindStopped },
};

const noop = () => undefined;

export type ActivityListHeaderProps = {
  variant: 'popover' | 'page' | 'sheet';
  unreadOnly?: boolean;
  onUnreadOnlyChange?: (value: boolean) => void;
  onMarkAllRead?: () => void;
  onExpand?: () => void;
};

/** Activity list header: title (when not in a sheet), Unread switch, Mark all read, Open as page. */
export function ActivityListHeader({
  variant,
  unreadOnly = false,
  onUnreadOnlyChange = noop,
  onMarkAllRead = noop,
  onExpand,
}: ActivityListHeaderProps) {
  const { t } = useTranslation();
  const tooltip = (label: string) => (
    <Tooltip>
      <Text size="T200">{label}</Text>
    </Tooltip>
  );
  return (
    <div className={css.Header}>
      {/* The sheet's own header names it already. */}
      {variant === 'sheet' ? (
        <span className={css.Grow} />
      ) : (
        <Text as="h2" size="H4" className={css.Grow}>
          {t('activity.title')}
        </Text>
      )}
      {/* The label names the switch and toggles it too; its title says what it does. */}
      <label className={css.Toggle} title={t('activity.unreadOnlyHint')}>
        <Text as="span" size="T200">
          {t('activity.unreadOnly')}
        </Text>
        <Switch value={unreadOnly} onChange={onUnreadOnlyChange} />
      </label>
      <TooltipProvider position="Bottom" offset={4} tooltip={tooltip(t('activity.markAllRead'))}>
        {(triggerRef) => (
          <IconButton
            ref={triggerRef}
            size="300"
            radii="300"
            aria-label={t('activity.markAllRead')}
            onClick={onMarkAllRead}
          >
            <Icon size="100" src={Icons.CheckTwice} />
          </IconButton>
        )}
      </TooltipProvider>
      {onExpand && (
        <TooltipProvider position="Bottom" offset={4} tooltip={tooltip(t('activity.openAsPage'))}>
          {(triggerRef) => (
            <IconButton
              ref={triggerRef}
              size="300"
              radii="300"
              aria-label={t('activity.openAsPage')}
              onClick={onExpand}
            >
              <Icon size="100" src={Icons.External} />
            </IconButton>
          )}
        </TooltipProvider>
      )}
    </div>
  );
}

export type ActivityListTabsProps = {
  tab: ActivityTab;
  unreadByTab: Record<ActivityTab, number>;
  onSelectTab?: (tab: ActivityTab) => void;
};

/** Filter tabs (All, Mentions, Replies, Needs you) with unread counts. */
export function ActivityListTabs({ tab, unreadByTab, onSelectTab = noop }: ActivityListTabsProps) {
  const { t } = useTranslation();
  return (
    <div className={css.Tabs} role="tablist" aria-label={t('activity.tabsLabel')}>
      {ACTIVITY_TABS.map((id) => (
        <Chip
          key={id}
          role="tab"
          aria-selected={tab === id}
          variant={tab === id ? 'Primary' : 'Background'}
          radii="Pill"
          onClick={() => onSelectTab(id)}
        >
          <Text size="T200">{t(`activity.tabs.${id}`)}</Text>
          {unreadByTab[id] > 0 && (
            <Text as="span" size="L400" aria-hidden>
              {unreadByTab[id]}
            </Text>
          )}
        </Chip>
      ))}
    </div>
  );
}

export type ActivityRowViewProps = {
  kind: ActivityKind;
  needsYou?: boolean;
  unread?: boolean;
  current?: boolean;
  avatarUserId: string;
  avatarUrl?: string;
  avatarAlt?: string;
  sentence: string;
  suffix?: string;
  time?: string;
  preview?: string;
  wholeId?: string;
  context?: { title: string; room: string };
  actions?: ReactNode;
  onOpen?: (event: MouseEvent<HTMLButtonElement>) => void;
  'data-activity-row'?: string;
  'data-tour-activity-row'?: string;
};

/** Pure presentational Activity row shared by `ActivityRowItem` and the interface tour. */
export function ActivityRowView({
  kind,
  needsYou = false,
  unread = false,
  current = false,
  avatarUserId,
  avatarUrl,
  avatarAlt = '',
  sentence,
  suffix,
  time,
  preview,
  wholeId,
  context,
  actions,
  onOpen,
  'data-activity-row': dataActivityRow,
  'data-tour-activity-row': dataTourActivityRow,
}: ActivityRowViewProps) {
  const kindIcon = ACTIVITY_KIND_ICONS[kind];
  return (
    <div
      data-activity-row={dataActivityRow}
      data-tour-activity-row={dataTourActivityRow}
      className={classNames(
        css.Row,
        needsYou && css.RowNeedsYou,
        !unread && css.RowRead,
        current && css.RowCurrent
      )}
    >
      <div className={css.AvatarSlot}>
        <Avatar size="300" radii="Pill">
          <UserAvatar
            userId={avatarUserId}
            src={avatarUrl}
            alt={avatarAlt}
            renderFallback={() => <Icon size="100" src={Icons.User} filled />}
          />
        </Avatar>
        <span className={classNames(css.KindBadge, kindIcon.className)} aria-hidden>
          <Icon size="50" src={kindIcon.icon} />
        </span>
      </div>
      <div className={css.Body}>
        <button
          type="button"
          className={css.OpenButton}
          aria-current={current ? 'page' : undefined}
          onClick={onOpen}
        >
          <span className={css.Line}>
            <Text as="span" size="T300" className={css.Sentence}>
              {unread ? <b>{sentence}</b> : <span>{sentence}</span>}
              {suffix && (
                <>
                  <span className={css.Muted} aria-hidden>
                    {' · '}
                  </span>
                  <span className={css.Muted}>{suffix}</span>
                </>
              )}
            </Text>
            {time && (
              <Text as="span" size="T200" priority="300">
                {time}
              </Text>
            )}
            {unread && <span className={css.UnreadDot} aria-hidden />}
          </span>
          {preview && (
            <Text
              as="span"
              size="T200"
              priority="400"
              className={css.Preview}
              {...ownDirectionLine}
            >
              {preview}
            </Text>
          )}
          {wholeId && (
            <Text
              as="span"
              size="T200"
              priority="300"
              className={css.WholeId}
              {...ownDirectionLine}
            >
              {wholeId}
            </Text>
          )}
          {context && (
            <span className={css.Context}>
              <Text as="span" size="T200" priority="300" truncate {...ownDirectionLine}>
                {context.title}
              </Text>
              <Text as="span" size="T200" priority="300" aria-hidden>
                ·
              </Text>
              <Text as="span" size="T200" priority="300" truncate {...ownDirectionLine}>
                {context.room}
              </Text>
            </span>
          )}
        </button>
        {actions}
      </div>
    </div>
  );
}

export type ActivityApprovalButtonsProps = {
  approvable?: boolean;
  disabled?: boolean;
  onApprove?: (event: MouseEvent<HTMLButtonElement>) => void;
  onDeny?: (event: MouseEvent<HTMLButtonElement>) => void;
  onDetails?: (event: MouseEvent<HTMLButtonElement>) => void;
};

/** Approve, Deny, and Details action buttons shared by `ActivityRowItem` and the interface tour. */
export function ActivityApprovalButtons({
  approvable = true,
  disabled = false,
  onApprove,
  onDeny,
  onDetails,
}: ActivityApprovalButtonsProps) {
  const { t } = useTranslation();
  return (
    <>
      {approvable && (
        <Button
          size="300"
          variant="Success"
          fill="Soft"
          radii="300"
          className={css.ActionButton}
          disabled={disabled}
          onClick={onApprove}
        >
          <Text size="B300">{t('activity.actions.approve')}</Text>
        </Button>
      )}
      <Button
        size="300"
        variant="Secondary"
        fill="Soft"
        radii="300"
        className={css.ActionButton}
        disabled={disabled}
        onClick={onDeny}
      >
        <Text size="B300">{t('activity.actions.deny')}</Text>
      </Button>
      <Button
        size="300"
        variant="Secondary"
        fill="None"
        radii="300"
        className={css.ActionButton}
        onClick={onDetails}
      >
        <Text size="B300">{t('activity.actions.details')}</Text>
      </Button>
    </>
  );
}
