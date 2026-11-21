import React, { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import type { EventTimelineSet, Room } from 'matrix-js-sdk';
import { Avatar, Badge, Icon, Icons, Text } from 'folds';
import { UserAvatar } from '../avatars/UserAvatar';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../matrix/hooks/useMediaAuthentication';
import { mxcUrlToHttp } from '../matrix/mediaUrl';
import { getMemberDisplayName } from '../matrix/room';
import { documentIsRightToLeft } from '../ui/directional';
import { getThreadRootReplyCount } from './threadIndicatorViewModel';
import * as css from './ThreadIndicator.css';

const MAX_PARTICIPANTS = 3;

/** What an unread thread's chip tells. */
export type ThreadIndicatorUnread = {
  /** A new reply (or the unread root) names the user. */
  mentionsMe: boolean;
};

type ThreadIndicatorProps = Omit<ComponentPropsWithoutRef<'button'>, 'children'> & {
  as?: 'button' | 'div' | 'span';
  room: Room;
  /** Root of the thread; without one the indicator only labels the composer as replying in a thread. */
  threadRootId?: string;
  /** Timeline set the root event lives in, for its reply-count metadata. */
  timelineSet?: EventTimelineSet;
  /** Known reply count; read from the thread model or root metadata when omitted. */
  threadReplyCount?: number;
  threadParticipantIds?: string[];
  isResolved?: boolean;
  /** Optional leading title, allowed to wrap before the unbroken reply metadata. */
  threadTitle?: string;
  /** Set while the thread is unread: the chip takes the accent and reads "New". */
  unread?: ThreadIndicatorUnread;
};

const resolveReplyCount = (
  room: Room,
  threadRootId: string,
  timelineSet: EventTimelineSet | undefined
): number | undefined => {
  const thread = room.getThread?.(threadRootId);
  if (thread) return thread.length;
  const rootEvent = timelineSet?.findEventById(threadRootId) ?? room.findEventById?.(threadRootId);
  return getThreadRootReplyCount(rootEvent);
};

function ParticipantAvatar({ room, userId }: { room: Room; userId: string }) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const member = room.getMember?.(userId);
  const name = (member && getMemberDisplayName(room, userId)) || userId;
  const mxc = member?.getMxcAvatarUrl();
  const src = mxc
    ? mxcUrlToHttp(mx, mxc, useAuthentication, 36, 36, 'crop') ?? undefined
    : undefined;
  return (
    <Avatar className={css.ThreadParticipant} size="200" radii="400" title={name}>
      <UserAvatar
        userId={userId}
        src={src}
        alt={name}
        renderFallback={() => (
          <Text as="span" size="T200">
            {Array.from(name.replace(/^[@#!]/, ''))[0]?.toUpperCase() ?? '?'}
          </Text>
        )}
      />
    </Avatar>
  );
}

/**
 * A chip with a thread's reply count, its first participants and a resolved mark. With
 * `as="button"` it opens the thread; without a `threadRootId` it only reads "Thread". While
 * `unread` is set it reads "New · 11 replies" in the accent, with an @ pill for a mention.
 * With `threadTitle`, the title wraps and the metadata follows it as a single inline group.
 */
export const ThreadIndicator = forwardRef<HTMLElement, ThreadIndicatorProps>(
  function ThreadIndicator(
    {
      threadReplyCount,
      threadParticipantIds,
      threadRootId,
      timelineSet,
      isResolved,
      unread,
      threadTitle,
      room,
      className,
      as: tag = 'div',
      ...rest
    },
    ref
  ) {
    const { t } = useTranslation();

    let replyCount = threadReplyCount;
    if (replyCount === undefined && threadRootId) {
      replyCount = resolveReplyCount(room, threadRootId, timelineSet);
    }
    const counted = replyCount !== undefined;
    const replies = counted ? t('thread.replyCount', { count: replyCount }) : t('thread.chip');
    const label = unread
      ? t('thread.newAndReplies', { news: t('thread.newUnknown'), replies })
      : replies;
    // With a count, the icon names what is counted, so a badge reads "Thread 2 replies".
    const iconLabel = counted
      ? { role: 'img', 'aria-label': t('thread.chip') }
      : { 'aria-hidden': true as const };
    const participants = threadParticipantIds?.slice(0, MAX_PARTICIPANTS) ?? [];

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
            {participants.map((userId) => (
              <ParticipantAvatar key={userId} room={room} userId={userId} />
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
          <Icon
            size="50"
            src={Icons.Check}
            aria-label={t('thread.aria.resolvedThread')}
            role="img"
          />
        )}
      </>
    );
    return React.createElement(
      tag,
      ownProps,
      <Icon size="50" src={Icons.Thread} {...iconLabel} />,
      threadTitle ? (
        <span className={css.ThreadIndicatorBody} dir="auto">
          <span className={css.ThreadIndicatorTitle}>{threadTitle}</span>{' '}
          <bdi
            className={css.ThreadIndicatorMetadata}
            dir={documentIsRightToLeft() ? 'rtl' : 'ltr'}
          >
            {metadata}
          </bdi>
        </span>
      ) : (
        metadata
      )
    );
  }
);
