import React, { type ComponentPropsWithoutRef, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import { Avatar, Badge, Icon, Icons, Text } from 'folds';
import { UserAvatar } from '../avatars/UserAvatar';
import { documentIsRightToLeft } from '../ui/directional';
import * as css from './ThreadIndicator.css';

export type ThreadIndicatorParticipant = {
  userId: string;
  displayName: string;
  avatarUrl?: string;
};

/** What an unread thread's chip tells. */
export type ThreadIndicatorUnread = {
  /** A new reply (or the unread root) names the user. */
  mentionsMe: boolean;
};

export type ThreadIndicatorChipProps = Omit<ComponentPropsWithoutRef<'button'>, 'children'> & {
  as?: 'button' | 'div' | 'span';
  replyCount?: number;
  participants?: readonly ThreadIndicatorParticipant[];
  isResolved?: boolean;
  /** Optional leading title, allowed to wrap before the unbroken reply metadata. */
  threadTitle?: string;
  /** Set while the thread is unread: the chip takes the accent and reads "New". */
  unread?: ThreadIndicatorUnread;
  ref?: Ref<HTMLElement>;
};

/**
 * Pure presentational thread indicator chip: reply count, participant avatars, unread/mention
 * marks, and resolved check. Shared by the timeline's `ThreadIndicator` and the interface tour.
 */
export function ThreadIndicatorChip({
  replyCount,
  participants = [],
  isResolved,
  unread,
  threadTitle,
  className,
  as: tag = 'div',
  ref,
  ...rest
}: ThreadIndicatorChipProps) {
  const { t } = useTranslation();

  const counted = replyCount !== undefined;
  const replies = counted ? t('thread.replyCount', { count: replyCount }) : t('thread.chip');
  const label = unread
    ? t('thread.newAndReplies', { news: t('thread.newUnknown'), replies })
    : replies;
  // With a count, the icon names what is counted, so a badge reads "Thread 2 replies".
  const iconLabel = counted
    ? { role: 'img', 'aria-label': t('thread.chip') }
    : { 'aria-hidden': true as const };

  const ownProps = {
    // A button inside a form must never submit it.
    ...(tag === 'button' ? { type: 'button' as const } : undefined),
    ...rest,
    ref,
    className: classNames(
      css.ThreadIndicator,
      threadTitle && css.ThreadIndicatorTitled,
      isResolved ? css.ThreadIndicatorResolved : undefined,
      unread ? css.ThreadIndicatorUnread : undefined,
      className
    ),
  };

  const metadata = (
    <>
      <Text as="span" className={css.ThreadIndicatorLabel} size="L400">
        {label}
      </Text>
      {participants.length > 0 && (
        <span className={css.ThreadParticipants} aria-hidden="true">
          {participants.map(({ userId, displayName, avatarUrl }) => (
            <Avatar
              key={userId}
              className={css.ThreadParticipant}
              size="200"
              radii="400"
              title={displayName}
            >
              <UserAvatar
                userId={userId}
                src={avatarUrl}
                alt={displayName}
                renderFallback={() => (
                  <Text as="span" size="T200">
                    {Array.from(displayName.replace(/^[@#!]/, ''))[0]?.toUpperCase() ?? '?'}
                  </Text>
                )}
              />
            </Avatar>
          ))}
        </span>
      )}
      {unread?.mentionsMe && (
        <Badge
          className={css.ThreadMentionPill}
          variant="Primary"
          fill="Solid"
          radii="Pill"
          size="200"
          role="img"
          aria-label={t('thread.mentionsYou')}
        >
          <Text as="span" size="L400" aria-hidden="true">
            @
          </Text>
        </Badge>
      )}
      {isResolved && (
        <Icon size="50" src={Icons.Check} aria-label={t('thread.aria.resolvedThread')} role="img" />
      )}
    </>
  );

  return React.createElement(
    tag,
    ownProps,
    <Icon size="50" src={Icons.Thread} {...iconLabel} />,
    threadTitle ? (
      <span className={css.ThreadIndicatorBody} dir="auto">
        <span className={css.ThreadIndicatorTitle}>{threadTitle}</span>
        {/* A dot parts the title from the count; the no-break space keeps it on the title's line. */}
        <span aria-hidden="true">{'\u00a0'}·</span>{' '}
        <bdi className={css.ThreadIndicatorMetadata} dir={documentIsRightToLeft() ? 'rtl' : 'ltr'}>
          {metadata}
        </bdi>
      </span>
    ) : (
      metadata
    )
  );
}
