import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { ClientEvent, KnownMembership, RoomEvent, type Room } from 'matrix-js-sdk';
import { Box, Button, Spinner, Text } from 'folds';
import * as css from '../account/auth/styles.css';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { getMxIdServer } from '../matrix/matrix';
import { describeError } from '../lib/describeError';
import { matchesEnum } from '../lib/matchesEnum';
import { getHomeRoomPath } from '../routes/pathUtils';
import { ErrorDetail } from '../ui/ErrorDetail';
import { CLAIM_TIMEOUT_MS, inviterOf, startClaim } from './inviteClaim';
import { parseInviteFragment } from './inviteLink';

type PageState =
  | { status: 'ready' | 'claiming' | 'offline' | 'rejected' | 'retry' | 'joining' }
  | { status: 'joinFailed'; roomId: string; error: unknown };

function InviteCard({ children }: { children: ReactNode }) {
  return (
    <Box grow="Yes" direction="Column" alignItems="Center" justifyContent="Center">
      <Box className={css.AuthCard} direction="Column">
        <Box className={css.AuthCardContent} direction="Column" gap="500">
          {children}
        </Box>
      </Box>
    </Box>
  );
}

/** `/invite/#r=<router ID>&c=<code>`: claims a mailed invitation from the router and joins its room. */
export function InvitePage(): JSX.Element {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const navigate = useNavigate();
  const location = useLocation();
  // The code stays in memory only: it leaves the router's location as soon as it is read.
  const [link, setLink] = useState(() => parseInviteFragment(location.hash));
  const [state, setState] = useState<PageState>({ status: 'ready' });
  // Stops what runs now: the claim, the wait for the invitation, or the join.
  const stopRef = useRef<() => void>();
  const halt = useCallback(() => {
    stopRef.current?.();
    stopRef.current = undefined;
  }, []);
  useEffect(() => halt, [halt]);
  useEffect(() => {
    if (!location.hash) return;
    // Every link opened here, also on this page, starts over.
    halt();
    setLink(parseInviteFragment(location.hash));
    setState({ status: 'ready' });
    const { pathname, search, state: routeState } = location;
    navigate({ pathname, search }, { replace: true, state: routeState });
  }, [halt, location, navigate]);

  if (window.top !== window.self) {
    return (
      <InviteCard>
        <Text size="T300">{t('mindroomUi.invites.framed')}</Text>
      </InviteCard>
    );
  }
  if (!link) {
    return (
      <InviteCard>
        <Text size="T300">{t('mindroomUi.invites.invalid')}</Text>
      </InviteCard>
    );
  }
  const server = getMxIdServer(link.routerId);

  const join = (roomId: string): void => {
    setState({ status: 'joining' });
    let current = true;
    stopRef.current = () => {
      current = false;
    };
    void mx.joinRoom(roomId, { viaServers: server ? [server] : undefined }).then(
      () => current && navigate(getHomeRoomPath(roomId)),
      (error: unknown) => current && setState({ status: 'joinFailed', roomId, error })
    );
  };

  /** Joins the router's invitation or opens the room; false while there is no invitation yet. */
  // The SDK announces a first invitation before it stores the room, so this takes the room it has.
  const settle = (roomId: string, room = mx.getRoom(roomId)): boolean => {
    const membership = room?.getMyMembership();
    const joined = matchesEnum(membership, KnownMembership.Join);
    if (!room || (!joined && !matchesEnum(membership, KnownMembership.Invite))) return false;
    halt();
    if (!joined && inviterOf(mx, room) === link.routerId) join(roomId);
    // Someone else's invitation opens the room's own invitation view, which names who sent it.
    else navigate(getHomeRoomPath(roomId));
    return true;
  };

  const enterRoom = (roomId: string): void => {
    setState({ status: 'joining' });
    if (settle(roomId)) return;
    const onRoom = (room: Room): void => {
      if (room.roomId === roomId) settle(roomId, room);
    };
    const timer = setTimeout(() => {
      halt();
      setState({ status: 'rejected' });
    }, CLAIM_TIMEOUT_MS);
    mx.on(RoomEvent.MyMembership, onRoom);
    mx.on(ClientEvent.Room, onRoom);
    stopRef.current = () => {
      clearTimeout(timer);
      mx.removeListener(RoomEvent.MyMembership, onRoom);
      mx.removeListener(ClientEvent.Room, onRoom);
    };
  };

  const claim = (): void => {
    setState({ status: 'claiming' });
    stopRef.current = startClaim(mx, link, (outcome) => {
      // Every outcome but `offline` ends the claim.
      if (outcome.status !== 'offline') stopRef.current = undefined;
      if (outcome.status === 'invited') enterRoom(outcome.roomId);
      else setState(outcome);
    });
  };

  let action: { onClick: () => void; label: 'join' | 'tryAgain' } | undefined;
  if (state.status === 'ready') action = { onClick: claim, label: 'join' };
  if (state.status === 'retry') action = { onClick: claim, label: 'tryAgain' };
  if (state.status === 'joinFailed') {
    const { roomId } = state;
    action = { onClick: () => enterRoom(roomId), label: 'tryAgain' };
  }
  let message: ReactNode;
  if (state.status === 'joinFailed') {
    message = (
      <Text size="T300">
        {describeError(t, state.error)}
        <ErrorDetail error={state.error} />
      </Text>
    );
  } else if (state.status === 'claiming' || state.status === 'joining') {
    message = (
      <Box alignItems="Center" gap="200">
        <Spinner variant="Secondary" size="200" aria-hidden />
        <Text size="T300">{t(`mindroomUi.invites.${state.status}`)}</Text>
      </Box>
    );
  } else {
    const values = { router: link.routerId, user: mx.getSafeUserId() };
    message = (
      <Text size="T300" style={{ overflowWrap: 'anywhere' }}>
        {t(`mindroomUi.invites.${state.status}`, values)}
      </Text>
    );
  }

  return (
    <InviteCard>
      <div role="status">{message}</div>
      {action && (
        <Button variant="Primary" size="400" radii="300" onClick={action.onClick}>
          <Text size="B400">{t(`mindroomUi.invites.${action.label}`)}</Text>
        </Button>
      )}
    </InviteCard>
  );
}
