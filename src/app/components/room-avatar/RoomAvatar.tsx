import React, { ReactNode } from 'react';
import classNames from 'classnames';
import { AvatarFallback, AvatarImage, Icon, IconSrc, Icons } from 'folds';
import { JoinRule } from 'matrix-js-sdk';
import { getAvatarFallbackStyle, useImageFailed } from '../user-avatar/UserAvatar';
import * as css from './RoomAvatar.css';







};

/** A room's avatar image, or a colored fallback while there is none or it fails to load. */
export function RoomAvatar({ roomId, src, alt, className, renderFallback }: RoomAvatarProps) {
  const [failed, setFailed] = useImageFailed(src);

  if (!src || failed) {
    return (
      <AvatarFallback
        style={getAvatarFallbackStyle(roomId)}
        className={classNames(css.RoomAvatar, className)}
      >
        {renderFallback()}
      </AvatarFallback>
    );
  }

  return (
    <AvatarImage
      className={classNames(css.RoomAvatar, className)}
      src={src}
      alt={alt}
      onError={() => setFailed()}
      draggable={false}
    />
  );
}

/** The icon for a room or space without an avatar, by how it can be joined. */
export const getRoomIconSrc = (space: boolean, joinRule?: string): IconSrc => {
  const restricted = joinRule === JoinRule.Invite || joinRule === JoinRule.Knock;
  if (space) {
    if (joinRule === JoinRule.Public) return Icons.SpaceGlobe;
    return restricted ? Icons.SpaceLock : Icons.Space;
  }
  if (joinRule === JoinRule.Public) return Icons.HashGlobe;
  return restricted ? Icons.HashLock : Icons.Hash;
};

type RoomIconProps = {
  space?: boolean;
  joinRule?: string;
  size?: '50' | '100' | '200' | '300' | '400' | '500' | '600';
  filled?: boolean;
};

export function RoomIcon({ space = false, joinRule, size = '100', filled }: RoomIconProps) {
  return <Icon size={size} src={getRoomIconSrc(space, joinRule)} filled={filled} />;
}
