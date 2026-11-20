import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ClientEvent, KnownMembership, RoomEvent, type Room } from 'matrix-js-sdk';
import { Box, Button, Spinner, Text } from 'folds';
import * as css from '../account/auth/styles.css';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { getMxIdServer } from '../matrix/matrix';
import { describeError } from '../lib/describeError';
import { matchesEnum } from '../lib/matchesEnum';
import { getHomeRoomPath } from '../routes/pathUtils';
import { ErrorDetail } from '../ui/ErrorDetail';
import { PageMain } from '../ui/page/Page';
import { CLAIM_TIMEOUT_MS, inviterOf, startClaim } from './inviteClaim';
import { parseInviteFragment, type InviteLink } from './inviteLink';
import { IsolatedText, isolateInSentence } from '../ui/directional';
import { dropInviteFragment } from '../../boot/inviteFragment';

/** The link in the address, read once and then cleared: null when malformed, undefined when absent. */
const takeLink = (): InviteLink | null | undefined => {
  const { hash } = window.location;
  dropInviteFragment();
  return hash ? parseInviteFragment(hash) ?? null : undefined;
};

type PageState =
  | { status: 'ready' | 'claiming' | 'offline' | 'rejected' | 'retry' | 'joining' }
  | { status: 'joinFailed'; roomId: string; error: unknown };

function InviteCard({ children }: { children: ReactNode }) {
  return (
    <PageMain>
      <Box grow="Yes" direction="Column" alignItems="Center" justifyContent="Center">
        <Box className={css.AuthCard} direction="Column">
          <Box className={css.AuthCardContent} direction="Column" gap="500">
            {children}
          </Box>
        </Box>
      </Box>
    </PageMain>
  );
}

/** `/invite/#r=<router ID>&c=<code>`: claims a mailed invitation from the router and joins its room. */
export function InvitePage(): JSX.Element {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const navigate = useNavigate();
  const [link, setLink] = useState(takeLink);
  const [state, setState] = useState<PageState>({ status: 'ready' });
  // Stops what runs now: the claim, the wait for the invitation, or the join.
  const stopRef = useRef<() => void>();
  const halt = useCallback(() => {
    stopRef.current?.();
    stopRef.current = undefined;
  }, []);
  useEffect(() => halt, [halt]);
  useEffect(() => {
    const onHashChange = (): void => {
      halt();
      setLink(takeLink());
      setState({ status: 'ready' });
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [halt]);

  const framed = window.top !== window.self;
  if (framed || !link) {
    const notice = framed ? 'framed' : (link === null && 'invalid') || 'reopen';
    return (
      <InviteCard>
        <Text size="T300">{t(`mindroomUi.invites.${notice}`)}</Text>
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

  // Joins the router's invitation or opens the room; false while there is none. It takes the room
  // the SDK hands over, which announces a first invitation before it stores the room.
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
      if (outcome.status !== 'offline') stopRef.current = undefined;
      if (outcome.status === 'invited') enterRoom(outcome.roomId);
      else setState(outcome);
    });
  };

  let action: { onClick: () => void; label: 'join' | 'tryAgain' } | undefined;
  if (state.status === 'ready' || state.status === 'retry')
    action = { onClick: claim, label: state.status === 'ready' ? 'join' : 'tryAgain' };
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
    const [router, user] = [link.routerId, mx.getSafeUserId()].map(isolateInSentence);
    message = (
      <Text size="T300" style={{ overflowWrap: 'anywhere' }}>
        <IsolatedText text={t(`mindroomUi.invites.${state.status}`, { router, user })} />
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
