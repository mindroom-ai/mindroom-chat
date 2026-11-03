import React, { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import type { EventTimelineSet, Room } from 'matrix-js-sdk';
import { Avatar, Icon, Icons, Text } from 'folds';
import { UserAvatar } from '../../components/user-avatar';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { mxcUrlToHttp } from '../../utils/mediaUrl';
import { getThreadRootReplyCount } from './threadIndicatorViewModel';
import * as css from './ThreadIndicator.css';

const MAX_PARTICIPANTS = 3;

export type ThreadIndicatorProps = Omit<ComponentPropsWithoutRef<'button'>, 'children'> & {
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
  const name = member?.rawDisplayName || userId;
  const mxc = member?.getMxcAvatarUrl();
  const src = mxc
    ? mxcUrlToHttp(mx, mxc, useAuthentication, 36, 36, 'crop') ?? undefined
    : undefined;
  return (
    <Avatar className={css.ThreadParticipant} size="200" radii="400" title={name}>
      <UserAvatar



















































      <Text as="span" className={css.ThreadIndicatorLabel} size="L400">
        {label}
      </Text>,
      participants.length > 0 && (
        <span className={css.ThreadParticipants} aria-hidden="true">
          {participants.map((userId) => (
            <ParticipantAvatar key={userId} room={room} userId={userId} />
          ))}
        </span>
      ),
      isResolved && (
        <Icon size="50" src={Icons.Check} aria-label={t('thread.aria.resolvedThread')} role="img" />
      )
    );
  }
);
