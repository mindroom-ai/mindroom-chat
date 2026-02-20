import { Avatar, Box, Icon, Icons, Text, as, color, toRem } from 'folds';
import { EventTimelineSet, Room } from 'matrix-js-sdk';
import React, { MouseEventHandler, ReactNode, useCallback, useMemo } from 'react';
import classNames from 'classnames';
import { getMemberAvatarMxc, getMemberDisplayName, trimReplyFromBody } from '../../utils/room';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../utils/matrix';
import { LinePlaceholder } from './placeholder';
import { randomNumberBetween } from '../../utils/common';
import * as css from './Reply.css';
import { MessageBadEncryptedContent, MessageDeletedContent, MessageFailedContent } from './content';
import { scaleSystemEmoji } from '../../plugins/react-custom-html-parser';
import { useRoomEvent } from '../../hooks/useRoomEvent';
import colorMXID from '../../../util/colorMXID';
import { GetMemberPowerTag } from '../../hooks/useMemberPowerTag';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { UserAvatar } from '../user-avatar';

type ReplyLayoutProps = {
  userColor?: string;
  username?: ReactNode;
};
export const ReplyLayout = as<'div', ReplyLayoutProps>(
  ({ username, userColor, className, children, ...props }, ref) => (
    <Box
      className={classNames(css.Reply, className)}
      alignItems="Center"
      gap="100"
      {...props}
      ref={ref}
    >
      <Box style={{ color: userColor, maxWidth: toRem(200) }} alignItems="Center" shrink="No">
        <Icon size="100" src={Icons.ReplyArrow} />
        {username}
      </Box>
      <Box grow="Yes" className={css.ReplyContent}>
        {children}
      </Box>
    </Box>
  )
);

type ThreadIndicatorProps = {
  threadReplyCount?: number;
  threadParticipantIds?: string[];
  room?: Room;
};
export const ThreadIndicator = as<'div', ThreadIndicatorProps>(
  ({ threadReplyCount, threadParticipantIds, room, ...props }, ref) => {
    const mx = useMatrixClient();
    const useAuthentication = useMediaAuthentication();

    const threadParticipants = useMemo(() => {
      if (!room || !threadParticipantIds?.length) return [];
      return threadParticipantIds.slice(0, 3).map((userId) => {
        const displayName =
          getMemberDisplayName(room, userId) ?? getMxIdLocalPart(userId) ?? userId;
        const avatarMxc = getMemberAvatarMxc(room, userId);
        return {
          userId,
          displayName,
          avatarUrl: avatarMxc
            ? mxcUrlToHttp(mx, avatarMxc, useAuthentication, 32, 32, 'crop') ?? undefined
            : undefined,
        };
      });
    }, [mx, room, threadParticipantIds, useAuthentication]);

    return (
      <Box
        shrink="No"
        className={css.ThreadIndicator}
        alignItems="Center"
        gap="100"
        {...props}
        ref={ref}
      >
        {threadParticipants.length > 0 && (
          <Box className={css.ThreadParticipants} alignItems="Center">
            {threadParticipants.map((participant, index) => (
              <Avatar
                key={participant.userId}
                className={css.ThreadParticipant}
                size="200"
                radii="400"
                style={
                  index === 0
                    ? { zIndex: threadParticipants.length - index }
                    : {
                        marginInlineStart: toRem(-6),
                        zIndex: threadParticipants.length - index,
                      }
                }
              >
                <UserAvatar
                  userId={participant.userId}
                  src={participant.avatarUrl}
                  alt={participant.displayName}
                  renderFallback={() => <Icon size="100" src={Icons.User} filled />}
                />
              </Avatar>
            ))}
          </Box>
        )}
        <Icon size="100" src={Icons.Thread} />
        <Text size="T200">Thread</Text>
        {typeof threadReplyCount === 'number' && (
          <Text size="T200">
            {threadReplyCount} {threadReplyCount === 1 ? 'reply' : 'replies'}
          </Text>
        )}
      </Box>
    );
  }
);

type ReplyProps = {
  room: Room;
  timelineSet?: EventTimelineSet | undefined;
  replyEventId: string;
  threadRootId?: string | undefined;
  hideThreadIndicator?: boolean;
  onClick?: MouseEventHandler | undefined;
  getMemberPowerTag?: GetMemberPowerTag;
  accessibleTagColors?: Map<string, string>;
  legacyUsernameColor?: boolean;
};

export const Reply = as<'div', ReplyProps>(
  (
    {
      room,
      timelineSet,
      replyEventId,
      threadRootId,
      hideThreadIndicator,
      onClick,
      getMemberPowerTag,
      accessibleTagColors,
      legacyUsernameColor,
      ...props
    },
    ref
  ) => {
    const placeholderWidth = useMemo(() => randomNumberBetween(40, 400), []);
    const getFromLocalTimeline = useCallback(
      () => timelineSet?.findEventById(replyEventId),
      [timelineSet, replyEventId]
    );
    const replyEvent = useRoomEvent(room, replyEventId, getFromLocalTimeline);

    const { body } = replyEvent?.getContent() ?? {};
    const sender = replyEvent?.getSender();
    const powerTag = sender ? getMemberPowerTag?.(sender) : undefined;
    const tagColor = powerTag?.color ? accessibleTagColors?.get(powerTag.color) : undefined;

    const usernameColor = legacyUsernameColor ? colorMXID(sender ?? replyEventId) : tagColor;
    const threadRootEvent = useMemo(() => {
      if (!threadRootId) return undefined;
      return timelineSet?.findEventById(threadRootId) ?? room.findEventById(threadRootId);
    }, [timelineSet, room, threadRootId]);
    const threadReplyCount = useMemo(() => {
      if (!threadRootEvent) return undefined;
      const threadMeta = threadRootEvent.getUnsigned()?.['m.relations']?.['m.thread'] as
        | { count?: unknown; c?: unknown }
        | undefined;
      if (typeof threadMeta?.count === 'number') return threadMeta.count;
      if (typeof threadMeta?.c === 'number') return threadMeta.c;
      return undefined;
    }, [threadRootEvent]);

    const fallbackBody = replyEvent?.isRedacted() ? (
      <MessageDeletedContent />
    ) : (
      <MessageFailedContent />
    );

    const badEncryption = replyEvent?.getContent().msgtype === 'm.bad.encrypted';
    const bodyJSX = body ? scaleSystemEmoji(trimReplyFromBody(body)) : fallbackBody;

    return (
      <Box direction="Row" gap="200" alignItems="Center" {...props} ref={ref}>
        {/* Hide the thread badge inside thread view to avoid redundant UI. */}
        {threadRootId && !hideThreadIndicator && (
          <ThreadIndicator
            as="button"
            data-thread-root-id={threadRootId}
            threadReplyCount={threadReplyCount}
            data-event-id={threadRootId}
            onClick={onClick}
          />
        )}
        <ReplyLayout
          as="button"
          userColor={usernameColor}
          username={
            sender && (
              <Text size="T300" truncate>
                <b>{getMemberDisplayName(room, sender) ?? getMxIdLocalPart(sender)}</b>
              </Text>
            )
          }
          data-event-id={replyEventId}
          onClick={onClick}
        >
          {replyEvent !== undefined ? (
            <Text size="T300" truncate>
              {badEncryption ? <MessageBadEncryptedContent /> : bodyJSX}
            </Text>
          ) : (
            <LinePlaceholder
              style={{
                backgroundColor: color.SurfaceVariant.ContainerActive,
                width: toRem(placeholderWidth),
                maxWidth: '100%',
              }}
            />
          )}
        </ReplyLayout>
      </Box>
    );
  }
);
