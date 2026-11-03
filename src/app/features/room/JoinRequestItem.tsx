import React, { useState } from 'react';
import { Avatar, Box, Button, Icon, Icons, Spinner, Text, color, config } from 'folds';
import { useTranslation } from 'react-i18next';
import type { Room, RoomMember } from 'matrix-js-sdk';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useRelativeTime } from '../../hooks/useRelativeTime';
import { UserAvatar } from '../../components/user-avatar';
import { getMxIdLocalPart } from '../../utils/matrix';
import { mxcUrlToHttp } from '../../utils/mediaUrl';
import { getMemberDisplayName } from '../../utils/room';
import { BreakWord } from '../../styles/Text.css';
import * as css from './MembersDrawer.css';

type JoinRequestItemProps = {
  room: Room;
  member: RoomMember;
  canApprove: boolean;
  canDecline: boolean;
};

type RequestAction = 'approve' | 'decline';

type RequestState =
  | { status: 'idle' }
  | { status: 'pending'; action: RequestAction }
  | { status: 'done'; action: RequestAction }
  | { status: 'error'; action: RequestAction; message: string };

const requestMessage = (member: RoomMember): string | undefined => {
  const reason = member.events.member?.getContent()?.reason;
  return typeof reason === 'string' && reason.trim() ? reason : undefined;
};

/**
 * One pending join request (a `knock` membership): who asked, their message,
 * and approve (invite) or decline (kick) buttons. A decided request stays
 * settled until the membership sync removes the row.
 */
export function JoinRequestItem({ room, member, canApprove, canDecline }: JoinRequestItemProps) {



  const [state, setState] = useState<RequestState>({ status: 'idle' });
  const { userId } = member;

  const name = getMemberDisplayName(room, userId) ?? getMxIdLocalPart(userId) ?? userId;
  const avatarMxc = member.getMxcAvatarUrl();
  const avatarUrl = avatarMxc
    ? mxcUrlToHttp(mx, avatarMxc, useAuthentication, 96, 96, 'crop') ?? undefined
    : undefined;
  const requestTs = member.events.member?.getTs();
  const age = useRelativeTime(requestTs);
  const message = requestMessage(member);

  const run = async (action: RequestAction) => {
    setState({ status: 'pending', action });
    try {
      if (action === 'approve') await mx.invite(room.roomId, userId);
      else await mx.kick(room.roomId, userId);
      setState({ status: 'done', action });
    } catch (error) {
      setState({
        status: 'error',
        action,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const busy = state.status === 'pending' || state.status === 'done';

  let statusText: string | undefined;
  if (state.status === 'pending') {
    statusText =
      state.action === 'approve'
        ? t('featureUi.room.joinRequestItem.approving')
        : t('featureUi.room.joinRequestItem.declining');
  } else if (state.status === 'done') {
    statusText =
      state.action === 'approve'
        ? t('featureUi.room.joinRequestItem.approvedWaitingForSync')
        : t('featureUi.room.joinRequestItem.declinedWaitingForSync');
  }

  return (
    <Box className={css.JoinRequestItem} direction="Column" gap="100">
      <Box gap="200" alignItems="Center">
        <Avatar radii="400" size="300">
          <UserAvatar
            alt={name}
            userId={userId}
            src={avatarUrl}
            renderFallback={() => <Icon filled size="100" src={Icons.User} />}
          />
        </Avatar>
        <Box direction="Column" grow="Yes" style={{ minWidth: 0 }}>
          <Text size="T300" truncate>
            {name}
          </Text>
          <Text size="T200" priority="300" truncate>
            {userId}
          </Text>
        </Box>
        {requestTs !== undefined && (
          <Text size="T200" priority="300">
            {age}
          </Text>
        )}
      </Box>
      <Text as="p" size="T300" className={`${css.JoinRequestMessage} ${BreakWord}`}>
        {message ?? t('featureUi.room.joinRequestItem.noMessageProvided')}
      </Text>
      {state.status === 'error' && (
        <Text size="T200" style={{ color: color.Critical.Main }}>
          {state.message}
        </Text>
      )}
      {statusText && (
        <Text size="T200" priority="300">
          {statusText}
        </Text>
      )}
      <Box className={css.JoinRequestActions} gap="200" style={{ paddingTop: config.space.S100 }}>
        {canApprove && (
          <Button
            size="300"
            variant="Success"
            fill="Soft"
            radii="300"
            disabled={busy}
            aria-label={t('featureUi.room.joinRequestItem.approveFromUser', { userId })}
            onClick={() => run('approve')}
            before={
              state.status === 'pending' && state.action === 'approve' ? (
                <Spinner size="50" variant="Success" />
              ) : (
                <Icon size="50" src={Icons.Check} />
              )
            }
          >
            <Text size="B300">{t('featureUi.room.joinRequestItem.approve')}</Text>
          </Button>
        )}
        {canDecline && (
          <Button
            size="300"
            variant="Critical"
            fill="Soft"
            radii="300"
            disabled={busy}
            aria-label={t('featureUi.room.joinRequestItem.declineFromUser', { userId })}
            onClick={() => run('decline')}
            before={
              state.status === 'pending' && state.action === 'decline' ? (
                <Spinner size="50" variant="Critical" />
              ) : undefined
            }
          >
            <Text size="B300">{t('featureUi.room.joinRequestItem.decline')}</Text>
          </Button>
        )}
      </Box>
    </Box>
  );
}
