import React, { ImgHTMLAttributes, ReactNode } from 'react';
import classNames from 'classnames';
import { Icon } from 'folds';
import { AvatarFallbackTone, AvatarPicture } from '../user-avatar/UserAvatar';
import { getRoomIconSrc } from './roomIconSrc';
import * as css from './RoomAvatar.css';

export { getRoomIconSrc };

type RoomAvatarProps = Pick<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt' | 'className'> & {
  roomId: string;
  /** Rendered while there is no image or it failed to load. */
  renderFallback: () => ReactNode;
  /**
   * How the fallback is filled: tinted by default, `solid` for a header tile, `plain` for an
   * icon that sits on the surface (room lists).
   */
  fallbackTone?: AvatarFallbackTone;
};

/** A room's avatar image, or a colored fallback while there is none or it fails to load. */
export function RoomAvatar({
  roomId,
  src,
  alt,
  className,
  renderFallback,
  fallbackTone,
}: RoomAvatarProps) {
  const avatarClassName = classNames(css.RoomAvatar, className);
  return (
    <AvatarPicture
      src={src}
      alt={alt}
      imageClassName={avatarClassName}
      fallbackClassName={avatarClassName}
      fallbackId={roomId}
      fallbackTone={fallbackTone}
      renderFallback={renderFallback}
    />
  );
}

type RoomIconProps = {
  space?: boolean;
  joinRule?: string;
  size?: '50' | '100' | '200' | '300' | '400' | '500' | '600';
  filled?: boolean;
};

export function RoomIcon({ space = false, joinRule, size = '100', filled }: RoomIconProps) {
  return <Icon size={size} src={getRoomIconSrc(space, joinRule)} filled={filled} />;
}
