import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { Avatar, Icon, IconButton, Icons, Text, Tooltip } from 'folds';
import { TooltipProvider } from '../ui/directional';
import { UserAvatar } from '../avatars/UserAvatar';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../matrix/hooks/useMediaAuthentication';
import { useLoadedRoomMembers } from '../matrix/hooks/useLoadedRoomMembers';
import { getMemberAvatarMxc, getSenderName } from '../matrix/room';
import { getMxIdLocalPart, mxcUrlToHttp } from '../matrix/matrix';
import { NameWithUserId } from '../matrix/NameWithUserId';
import { nameInitials } from '../lib/common';
import { ExpandIcon } from '../ui/panels/panelIcons';
import type { CallParticipant, CallVideoTrack } from './RoomCall';
import * as css from './CallPanel.css';

/** Tiles draw pictures up to 80 px wide; twice that keeps them sharp on dense screens. */
const PICTURE_SIZE = 160;

/**
 * A member's name and picture in the call's room, as tiles and the prescreen show them. The call
 * starts after the room's member list loaded, but that load may have failed: until the list is
 * there, the user ID follows the name (`getSenderName`), so nobody shows as a member the client has
 * not loaded yet, and the list is asked for again.
 */
export const useCallMemberProfile = (room: Room, userId: string) => {
  const mx = useMatrixClient();
  useLoadedRoomMembers(mx, [room.roomId]);
  const picture = getMemberAvatarMxc(room, userId);
  const httpPicture = mxcUrlToHttp(
    mx,
    picture ?? '',
    useMediaAuthentication(),
    PICTURE_SIZE,
    PICTURE_SIZE,
    'crop'
  );
  return {
    name: getSenderName(room, userId),
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
            {nameInitials(name === userId ? getMxIdLocalPart(userId) : name)}
          </Text>
        )}
      />
    </Avatar>
  );
}

type TileVideoProps = {
  track: CallVideoTrack;
  /** A camera seen by its own person shows as in a mirror. */
  mirrored?: boolean;
  className?: string;
  videoRef?: React.RefObject<HTMLVideoElement>;
};

function TileVideo({ track, mirrored, className = css.TileVideo, videoRef }: TileVideoProps) {
  const ownRef = useRef<HTMLVideoElement>(null);
  const ref = videoRef ?? ownRef;
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    track.attach(element);
    return () => {
      track.detach(element);
    };
  }, [ref, track]);
  return (
    <video
      ref={ref}
      className={className}
      style={mirrored ? { transform: 'scaleX(-1)' } : undefined}
      autoPlay
      playsInline
      muted
    />
  );
}

/** Shows a video on the whole screen, or leaves full screen when it is there already. */
const toggleFullScreen = (video: HTMLVideoElement | null) => {
  if (!video) return;
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => undefined);
    return;
  }
  video.requestFullscreen?.().catch(() => undefined);
};

/**
 * A screen someone shares: across the panel's width and whole rather than cropped, with its
 * sharer's name and a way to see it on the whole screen (also by double-clicking it).
 */
export function ScreenTile({ room, participant }: { room: Room; participant: CallParticipant }) {
  const { t } = useTranslation();
  const { name } = useCallMemberProfile(room, participant.userId);
  const videoRef = useRef<HTMLVideoElement>(null);
  if (!participant.screen) return null;
  const screenOf = (shown: string) => t('featureUi.calls.panel.screenOf', { name: shown });
  const label = screenOf(name);
  const fullScreenLabel = t('featureUi.calls.panel.fullScreen');
  return (
    <li
      className={css.ScreenTile}
      data-call-screen={participant.userId}
      aria-label={label}
      onDoubleClick={() => toggleFullScreen(videoRef.current)}
    >
      <TileVideo track={participant.screen} className={css.ScreenVideo} videoRef={videoRef} />
      <span className={css.TileLabel}>
        <Icon size="50" src={Icons.ScreenShare} />
        <NameWithUserId name={name} userId={participant.userId} text={screenOf} size="T200" />
      </span>
      {typeof document !== 'undefined' && document.fullscreenEnabled && (
        <TooltipProvider
          position="Bottom"
          align="End"
          offset={4}
          tooltip={
            <Tooltip>
              <Text size="T200">{fullScreenLabel}</Text>
            </Tooltip>
          }
        >
          {(anchorRef) => (
            <IconButton
              ref={anchorRef}
              className={css.ScreenFullScreen}
              size="300"
              radii="300"
              variant="Surface"
              fill="Soft"
              aria-label={fullScreenLabel}
              onClick={() => toggleFullScreen(videoRef.current)}
            >
              <Icon size="100" src={ExpandIcon} />
            </IconButton>
          )}
        </TooltipProvider>
      )}
    </li>
  );
}

/** One device in the call: its video or the member's picture, the name, and whether it talks. */
export function CallTile({ room, participant }: { room: Room; participant: CallParticipant }) {
  const { t } = useTranslation();
  const { name } = useCallMemberProfile(room, participant.userId);
  const you = (shown: string) => t('featureUi.calls.panel.you', { name: shown });
  const label = participant.local ? you(name) : name;
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
        <span className={css.TileStatus}>
          <NameWithUserId
            name={name}
            userId={participant.userId}
            text={(shown) => t('featureUi.calls.panel.waitingFor', { name: shown })}
            size="T200"
            priority="300"
          />
        </span>
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
        <NameWithUserId
          name={name}
          userId={participant.userId}
          text={participant.local ? you : undefined}
          size="T200"
        />
      </span>
    </li>
  );
}
