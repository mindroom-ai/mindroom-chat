import { ImgHTMLAttributes, ReactNode } from 'react';
import classNames from 'classnames';
import { Icon } from 'folds';
import { AvatarFallbackTone, AvatarPicture } from './UserAvatar';
import { getRoomIconSrc } from './roomIconSrc';
import * as css from './RoomAvatar.css';

export { getRoomIconSrc };

type RoomAvatarProps = Pick<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt' | 'className'> & {
  roomId: string;
  /** Rendered while there is no image or it failed to load. */
  renderFallback: () => ReactNode;
  /**
   * How the fallback is filled: the room's swatch by default, `plain` for an icon that sits on
   * the surface (room lists).
   */
  fallbackTone?: AvatarFallbackTone;
  /**
   * The ID whose color the fallback takes, the room's own unless given. A direct chat passes
   * the other person's user ID, so its tile has the color of that person's avatar.
   */
  fallbackId?: string;
};

/** A room's avatar image, or a colored fallback while there is none or it fails to load. */
export function RoomAvatar({
  roomId,
  src,
  alt,
  className,
  renderFallback,
  fallbackTone,
  fallbackId,
}: RoomAvatarProps) {
  const avatarClassName = classNames(css.RoomAvatar, className);
  return (
    <AvatarPicture
      src={src}
      alt={alt}
      imageClassName={avatarClassName}
      fallbackClassName={avatarClassName}
      fallbackId={fallbackId ?? roomId}
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
  /** A MindRoom agent is in the room: its hash is framed. */
  work?: boolean;
};

export function RoomIcon({ space = false, joinRule, size = '100', filled, work }: RoomIconProps) {
  return <Icon size={size} src={getRoomIconSrc(space, joinRule, work)} filled={filled} />;
}
