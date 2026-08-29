import React, { useState } from 'react';
import { Avatar, Box, Button, color, Icon, Icons, Spinner, Text } from 'folds';
import { Room, RoomMember } from 'matrix-js-sdk';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useRelativeTime } from '../../hooks/useRelativeTime';
import { UserAvatar } from '../../components/user-avatar';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../utils/matrix';
import { getMemberDisplayName } from '../../utils/room';
import { BreakWord } from '../../styles/Text.css';
import * as css from './MembersDrawer.css';

type JoinRequestAction = 'approve' | 'decline';
type JoinRequestActionState = {
  action?: JoinRequestAction;
  error?: string;
  status: 'idle' | 'loading' | 'success' | 'error';
};

type JoinRequestItemProps = {
  room: Room;
  member: RoomMember;
  canApprove: boolean;
  canDecline: boolean;
};

export function JoinRequestItem({ room, member, canApprove, canDecline }: JoinRequestItemProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const [actionState, setActionState] = useState<JoinRequestActionState>({ status: 'idle' });

  const name =
    getMemberDisplayName(room, member.userId) ?? getMxIdLocalPart(member.userId) ?? member.userId;
  const avatarMxcUrl = member.getMxcAvatarUrl();
  const avatarUrl = avatarMxcUrl
    ? mxcUrlToHttp(mx, avatarMxcUrl, useAuthentication, 100, 100, 'crop')
    : undefined;
  const memberEvent = member.events.member;
  const reason = memberEvent?.getContent().reason;
  const message = typeof reason === 'string' ? reason.trim() : undefined;
  const relativeTime = useRelativeTime(memberEvent?.getTs());

  const loading = actionState.status === 'loading';
  const settled = actionState.status === 'success';
  const disabled = loading || settled;

  const runAction = async (action: JoinRequestAction): Promise<void> => {
    setActionState({ action, status: 'loading' });
    try {
      if (action === 'approve') {
        await mx.invite(room.roomId, member.userId);
      } else {
        await mx.kick(room.roomId, member.userId);
      }
      setActionState({ action, status: 'success' });
    } catch (error) {
      setActionState({
        action,
        error: error instanceof Error ? error.message : 'The request could not be updated.',
        status: 'error',
      });
    }
  };

  const loadingLabel = actionState.action === 'approve' ? 'Approving…' : 'Declining…';
  const successLabel =
    actionState.action === 'approve'
      ? 'Approved. Waiting for room sync…'
      : 'Declined. Waiting for room sync…';

  return (
    <Box className={css.JoinRequestItem} direction="Column" gap="200" aria-busy={loading}>
      <Box alignItems="Center" gap="200">
        <Avatar size="300">
          <UserAvatar
            userId={member.userId}
            src={avatarUrl ?? undefined}
            alt={name}
            renderFallback={() => <Icon size="100" src={Icons.User} filled />}
          />
        </Avatar>
        <Box grow="Yes" direction="Column">
          <Box alignItems="Center" justifyContent="SpaceBetween" gap="100">
            <Text size="L400" truncate>
              {name}
            </Text>
            {relativeTime && (
              <Text size="T200" priority="300">
                {relativeTime}
              </Text>
            )}
          </Box>
          <Text size="T200" priority="300" truncate>
            {member.userId}
          </Text>
        </Box>
      </Box>

      <Text className={css.JoinRequestMessage} size="T300">
        {message || <i>No message provided.</i>}
      </Text>

      {actionState.status === 'error' && (
        <Text
          as="p"
          className={BreakWord}
          role="alert"
          size="T200"
          style={{ color: color.Critical.Main }}
        >
          {actionState.error}
        </Text>
      )}
      {(loading || settled) && (
        <Text as="p" role="status" size="T200" priority="300">
          {loading ? loadingLabel : successLabel}
        </Text>
      )}

      <Box className={css.JoinRequestActions} gap="100" justifyContent="End">
        {canDecline && (
          <Button
            aria-label={`Decline join request from ${member.userId}`}
            size="300"
            variant="Critical"
            fill="Soft"
            radii="300"
            disabled={disabled}
            before={
              loading && actionState.action === 'decline' ? (
                <Spinner size="100" variant="Critical" fill="Soft" />
              ) : undefined
            }
            onClick={() => void runAction('decline')}
          >
            <Text size="B300">Decline</Text>
          </Button>
        )}
        {canApprove && (
          <Button
            aria-label={`Approve join request from ${member.userId}`}
            size="300"
            variant="Primary"
            radii="300"
            disabled={disabled}
            before={
              loading && actionState.action === 'approve' ? (
                <Spinner size="100" variant="Primary" fill="Solid" />
              ) : settled && actionState.action === 'approve' ? (
                <Icon size="50" src={Icons.Check} />
              ) : undefined
            }
            onClick={() => void runAction('approve')}
          >
            <Text size="B300">Approve</Text>
          </Button>
        )}
      </Box>
    </Box>
  );
}
