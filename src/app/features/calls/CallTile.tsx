import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { Avatar, Icon, Icons, Text } from 'folds';
import { UserAvatar } from '../../components/user-avatar';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { getMemberAvatarMxc, getMemberDisplayName } from '../../utils/room';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../utils/matrix';
import { nameInitials } from '../../utils/common';
import type { CallParticipant, CallVideoTrack } from './RoomCall';
import * as css from './CallPanel.css';

/** Tiles draw pictures up to 80 px wide; twice that keeps them sharp on dense screens. */
const PICTURE_SIZE = 160;

/** A member's name and picture in the call's room, as tiles and the prescreen show them. */
export const useCallMemberProfile = (room: Room, userId: string) => {
  const picture = getMemberAvatarMxc(room, userId);
  const httpPicture = mxcUrlToHttp(
    useMatrixClient(),
    picture ?? '',
    useMediaAuthentication(),
    PICTURE_SIZE,
    PICTURE_SIZE,
    'crop'
  );
  return {
    name: getMemberDisplayName(room, userId) ?? getMxIdLocalPart(userId) ?? userId,
    avatarSrc: picture && httpPicture ? httpPicture : undefined,
  };
};

export function CallMemberAvatar({
  room,
  userId,
  size = '500',
  className,
}: {
  room: Room;
  userId: string;
  size?: '200' | '300' | '400' | '500';
  className?: string;
}) {
  const { name, avatarSrc } = useCallMemberProfile(room, userId);
  return (
    <Avatar size={size} radii="Pill" className={className} aria-hidden>
      <UserAvatar
        alt=""
        userId={userId}
        src={avatarSrc}
        renderFallback={() => (
          <Text as="span" size={size === '500' ? 'H3' : 'L400'}>
            {nameInitials(name)}
          </Text>
        )}
      />
    </Avatar>
  );
}

function TileVideo({ track, mirrored }: { track: CallVideoTrack; mirrored: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    track.attach(element);
    return () => {
      track.detach(element);
    };
  }, [track]);
  return (
    <video
      ref={ref}
      className={css.TileVideo}
      style={mirrored ? { transform: 'scaleX(-1)' } : undefined}
      autoPlay
      playsInline
      muted
    />
  );
}

/** One device in the call: its video or the member's picture, the name, and whether it talks. */
export function CallTile({ room, participant }: { room: Room; participant: CallParticipant }) {
  const { t } = useTranslation();
  const { name } = useCallMemberProfile(room, participant.userId);
  const label = participant.local ? t('featureUi.calls.panel.you', { name }) : name;
  return (
    <li
      className={css.Tile}
      data-call-tile={participant.userId}
      data-speaking={participant.speaking}
      data-connected={participant.connected}
      aria-label={label}
    >
      {participant.video ? (
        <TileVideo track={participant.video} mirrored={participant.local} />
      ) : (
        <CallMemberAvatar room={room} userId={participant.userId} className={css.TileAvatar} />
      )}
      {!participant.connected && !participant.local && (
        <Text className={css.TileStatus} size="T200" priority="300">
          {t('featureUi.calls.panel.waitingFor', { name })}
        </Text>
      )}
      <span className={css.TileLabel}>
        {!participant.microphone && (
          <Icon
            size="50"
            src={Icons.MicMute}
            aria-label={t('featureUi.calls.panel.microphoneOff')}
            role="img"
          />
        )}
        <Text as="span" size="T200" truncate>
          {label}
        </Text>
      </span>
    </li>
  );
}
