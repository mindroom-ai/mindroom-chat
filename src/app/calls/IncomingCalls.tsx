import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAtomValue, useStore } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { Box, Button, Icon, Icons, Text } from 'folds';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useRoomNavigate } from '../navigation/useRoomNavigate';
import { useRoomName } from '../matrix/hooks/useRoomMeta';
import { useLoadedRoomMembers } from '../matrix/hooks/useLoadedRoomMembers';
import { getSenderName } from '../matrix/room';
import { NameWithUserId } from '../matrix/NameWithUserId';
import { mDirectAtom } from '../matrix/state/mDirectList';
import { useSetting } from '../preferences/useSetting';
import { settingsAtom } from '../preferences/settings';
import { Surface } from '../ui/glass/GlassPrimitives';
import { MINDROOM_FAVICON_SRC } from '../ui/branding/branding';
import { activeMemberships } from './callMemberships';
import { declineRing, watchRings, type IncomingRing } from './callRings';
import { startRingtone } from './ringtone';
import { callPanelRoomAtom, noteCallStart, useActiveCall, useCallActions } from './callStore';
import { CallMemberAvatar } from './CallTile';
import * as css from './IncomingCalls.css';
import { revealDirectionControls } from '../ui/directional';

/** A ring and what can be done about it. */
type RingCardProps = {
  room: Room;
  ring: IncomingRing;
  onAnswer: () => void;
  onDecline: () => void;
  onIgnore: () => void;
  /** Shows the ring's room, from its system notification. */
  onOpen: () => void;
};

/**
 * The caller's name and the line that names them: "Maya is calling", or "Maya is calling in
 * Planning" outside a direct chat. The room may be one the user never opened, whose member list
 * is not loaded: until it is, the caller's user ID follows their name, so nobody rings as a member
 * the client has not loaded yet.
 */
export const useRingLine = (
  room: Room,
  ring: IncomingRing
): { caller: string; line: (caller: string) => string } => {
  const { t } = useTranslation();
  useLoadedRoomMembers(useMatrixClient(), [room.roomId]);
  const caller = getSenderName(room, ring.sender);
  const roomName = revealDirectionControls(useRoomName(room));
  const direct = useAtomValue(mDirectAtom).has(room.roomId);
  return {
    caller,
    line: (name) =>
      direct
        ? t('featureUi.calls.incoming.calling', { name })
        : t('featureUi.calls.incoming.callingIn', { name, room: roomName }),
  };
};

const windowHasFocus = (): boolean => document.visibilityState === 'visible' && document.hasFocus();

/**
 * Whether the room's member list has loaded, or failed to. A system notification cannot change
 * its text once shown, so a ring's waits for the list, as a message's does, and names the caller
 * the way the ring card does once the list is there; if the list cannot load, the user ID stays.
 */
const useMemberListSettled = (room: Room): boolean => {
  const [settled, setSettled] = useState<Room>();
  useEffect(() => {
    if (room.membersLoaded()) return undefined;
    let disposed = false;
    const settle = () => {
      if (!disposed) setSettled(room);
    };
    room.loadMembersIfNeeded().then(settle, settle);
    return () => {
      disposed = true;
    };
  }, [room]);
  return room.membersLoaded() || settled === room;
};

/**
 * While a ring shows: the ringtone (when notification sounds are on) and, when the window is in
 * the background and `notify` is set, a system notification (when desktop notifications are on
 * and allowed) that brings the window and the ring forward. Both stop with the ring.
 */
function RingAlerts({
  ring,
  line,
  notify,
  onOpen,
}: {
  ring: IncomingRing;
  line: string;
  notify: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const [sound] = useSetting(settingsAtom, 'isNotificationSounds');
  const [desktop] = useSetting(settingsAtom, 'showNotifications');
  const latest = useRef({ line, onOpen, title: t('sharedUi.callEmbedProvider.incomingCall') });
  latest.current = { line, onOpen, title: t('sharedUi.callEmbedProvider.incomingCall') };

  useEffect(() => (sound ? startRingtone() : undefined), [sound, ring.eventId]);

  useEffect(() => {
    const SystemNotification = typeof window === 'undefined' ? undefined : window.Notification;
    if (!notify || !desktop || SystemNotification?.permission !== 'granted' || windowHasFocus()) {
      return undefined;
    }
    const note = new SystemNotification(latest.current.title, {
      body: latest.current.line,
      icon: MINDROOM_FAVICON_SRC,
      tag: `call-ring-${ring.roomId}`,
      requireInteraction: true,
      // The ringtone is the sound; the system adds none of its own.
      silent: true,
    });
    note.onclick = () => {
      window.focus();
      note.close();
      latest.current.onOpen();
    };
    return () => note.close();
  }, [notify, desktop, ring.eventId, ring.roomId]);

  return null;
}

export function RingCard({ room, ring, onAnswer, onDecline, onIgnore, onOpen }: RingCardProps) {
  const { t } = useTranslation();
  const { caller, line } = useRingLine(room, ring);
  const membersSettled = useMemberListSettled(room);
  return (
    <Surface
      className={css.Card}
      role="alertdialog"
      aria-label={t('sharedUi.callEmbedProvider.incomingCall')}
      aria-describedby={`incoming-call-${ring.eventId}`}
      data-incoming-call={room.roomId}
    >
      <RingAlerts ring={ring} line={line(caller)} notify={membersSettled} onOpen={onOpen} />
      <Box alignItems="Center" gap="300">
        <CallMemberAvatar room={room} userId={ring.sender} size="400" />
        <Box direction="Column" style={{ minWidth: 0 }}>
          <Text size="L400" priority="300">
            {ring.video
              ? t('featureUi.calls.incoming.videoCall')
              : t('featureUi.calls.incoming.voiceCall')}
          </Text>
          <Box id={`incoming-call-${ring.eventId}`} wrap="Wrap" gap="100" style={{ rowGap: 0 }}>
            <NameWithUserId name={caller} userId={ring.sender} text={line} size="H5" />
          </Box>
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
  const store = useStore();
  const active = useActiveCall();
  const { startCall } = useCallActions(mx);
  const { navigateRoom } = useRoomNavigate();
  const [ring, setRing] = useState<IncomingRing>();

  useEffect(
    () =>
      watchRings(mx, {
        onRing: setRing,
        // Rejected on another of this account's devices: this one stops ringing too.
        onDeclined: (declined) =>
          setRing((current) => (current?.eventId === declined ? undefined : current)),
      }),
    [mx]
  );

  // Stops ringing when the ring expires, the call it rang for has nobody left in it, or this
  // account answered on another device.
  useEffect(() => {
    if (!ring) return undefined;
    const room = mx.getRoom(ring.roomId);
    const myUserId = mx.getSafeUserId();
    const check = () => {
      const members = room ? activeMemberships(mx.matrixRTC.getRoomSession(room)) : [];
      const answered = members.some((member) => member.userId === myUserId);
      if (members.length === 0 || answered || Date.now() >= ring.expiresAt) setRing(undefined);
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
    void startCall({ room, kind: 'room', microphone: true, video: ring.video }).then((result) => {
      // Another tab of this session is in a call, or the call could not start: the room's call
      // panel says which, with Join to try again.
      if (noteCallStart(store, mx, room.roomId, result)) store.set(callPanelRoomAtom, room.roomId);
    });
  };
  const decline = () => {
    setRing(undefined);
    declineRing(mx, ring).catch(() => undefined);
  };

  return (
    <RingCard
      room={room}
      ring={ring}
      onAnswer={answer}
      onDecline={decline}
      onOpen={() => navigateRoom(room.roomId)}
      onIgnore={() => setRing(undefined)}
    />
  );
}
