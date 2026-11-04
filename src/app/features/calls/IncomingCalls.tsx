import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAtomValue } from 'jotai';
import { RoomEvent, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { Box, Button, Icon, Icons, Text } from 'folds';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { useRoomName } from '../../hooks/useRoomMeta';
import { mDirectAtom } from '../../state/mDirectList';
import { Surface } from '../../components/glass/GlassPrimitives';
import { activeMemberships } from './callMemberships';
import { declineRing, readRing, type IncomingRing } from './callRings';
import { useActiveCall, useCallActions } from './callStore';
import { CallMemberAvatar, useCallMemberProfile } from './CallTile';
import * as css from './IncomingCalls.css';

/** A ring and what can be done about it. */
type RingCardProps = {
  room: Room;
  ring: IncomingRing;
  onAnswer: () => void;
  onDecline: () => void;
  onIgnore: () => void;
};

function RingCard({ room, ring, onAnswer, onDecline, onIgnore }: RingCardProps) {
  const { t } = useTranslation();
  const { name } = useCallMemberProfile(room, ring.sender);
  const roomName = useRoomName(room);
  const direct = useAtomValue(mDirectAtom).has(room.roomId);
  const line = direct
    ? t('featureUi.calls.incoming.calling', { name })
    : t('featureUi.calls.incoming.callingIn', { name, room: roomName });
  return (
    <Surface
      className={css.Card}
      role="alertdialog"
      aria-label={t('sharedUi.callEmbedProvider.incomingCall')}
      aria-describedby={`incoming-call-${ring.eventId}`}
      data-incoming-call={room.roomId}
    >
      <Box alignItems="Center" gap="300">
        <CallMemberAvatar room={room} userId={ring.sender} size="400" />
        <Box direction="Column" style={{ minWidth: 0 }}>
          <Text size="L400" priority="300">
            {ring.video
              ? t('featureUi.calls.incoming.videoCall')
              : t('featureUi.calls.incoming.voiceCall')}
          </Text>
          <Text id={`incoming-call-${ring.eventId}`} size="H5" truncate>
            {line}
          </Text>
        </Box>
      </Box>
      <Box gap="200" justifyContent="End" wrap="Wrap">
        <Button size="300" radii="Pill" variant="Secondary" fill="None" onClick={onIgnore}>
          <Text size="B300">{t('sharedUi.callEmbedProvider.ignore')}</Text>
        </Button>
        <Button
          size="300"
          radii="Pill"
          variant="Critical"
          fill="Solid"
          before={<Icon size="100" src={Icons.PhoneDown} />}
          onClick={onDecline}
        >
          <Text size="B300">{t('sharedUi.callEmbedProvider.reject')}</Text>
        </Button>
        <Button
          size="300"
          radii="Pill"
          variant="Success"
          fill="Solid"
          before={<Icon size="100" src={Icons.Phone} />}
          onClick={onAnswer}
        >
          <Text size="B300">{t('sharedUi.callEmbedProvider.answer')}</Text>
        </Button>
      </Box>
    </Surface>
  );
}

/**
 * Rings on any page when someone starts a call that rings this account (a direct chat call). A
 * ring goes away when it expires, when its call ends, when this device joins the call, and on
 * Answer, Reject or Ignore. One ring shows at a time, the newest.
 */
export function IncomingCalls() {
  const mx = useMatrixClient();
  const active = useActiveCall();
  const { startCall } = useCallActions(mx);
  const { navigateRoom } = useRoomNavigate();
  const [ring, setRing] = useState<IncomingRing>();

  useEffect(() => {
    const myUserId = mx.getSafeUserId();
    const consider = async (event: MatrixEvent) => {
      await mx.decryptEventIfNeeded(event).catch(() => undefined);
      const found = readRing(event, myUserId);
      if (found) setRing(found);
    };
    const onTimeline = (
      event: MatrixEvent,
      _room: Room | undefined,
      toStartOfTimeline: boolean | undefined,
      removed: boolean,
      data: { liveEvent?: boolean }
    ) => {
      if (toStartOfTimeline || removed || data?.liveEvent !== true) return;
      consider(event);
    };
    mx.on(RoomEvent.Timeline, onTimeline);
    return () => {
      mx.off(RoomEvent.Timeline, onTimeline);
    };
  }, [mx]);

  // Stops ringing when the ring expires or the call it rang for has nobody left in it.
  useEffect(() => {
    if (!ring) return undefined;
    const room = mx.getRoom(ring.roomId);
    const check = () => {
      const ended = !room || activeMemberships(mx.matrixRTC.getRoomSession(room)).length === 0;
      if (ended || Date.now() >= ring.expiresAt) setRing(undefined);
    };
    const timer = window.setInterval(check, 1000);
    return () => window.clearInterval(timer);
  }, [mx, ring]);

  useEffect(() => {
    if (ring && active?.call.room.roomId === ring.roomId) setRing(undefined);
  }, [active, ring]);

  const room = ring ? mx.getRoom(ring.roomId) : undefined;
  if (!ring || !room || active) return null;

  const answer = () => {
    setRing(undefined);
    navigateRoom(room.roomId);
    startCall({ room, kind: 'room', microphone: true, video: ring.video });
  };
  const decline = () => {
    setRing(undefined);
    declineRing(mx, ring).catch(() => undefined);
  };

  return (
    <div className={css.Host}>
      <RingCard
        room={room}
        ring={ring}
        onAnswer={answer}
        onDecline={decline}
        onIgnore={() => setRing(undefined)}
      />
    </div>
  );
}
