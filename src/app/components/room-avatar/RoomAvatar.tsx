import React, { ImgHTMLAttributes, ReactNode } from 'react';
import classNames from 'classnames';
import { AvatarFallback, AvatarImage, Icon } from 'folds';
import { getAvatarFallbackStyle, useImageFailed } from '../user-avatar/UserAvatar';
import { getRoomIconSrc } from './roomIconSrc';
import * as css from './RoomAvatar.css';

export { getRoomIconSrc };

type RoomAvatarProps = Pick<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt' | 'className'> & {
  roomId: string;
  /** Rendered while there is no image or it failed to load. */
  renderFallback: () => ReactNode;
};

/** A room's avatar image, or a colored fallback while there is none or it fails to load. */
export function RoomAvatar({ roomId, src, alt, className, renderFallback }: RoomAvatarProps) {
  const [failed, setFailed] = useImageFailed(src);

  const avatarClassName = classNames(css.RoomAvatar, className);

  if (src && !failed) {
    return (
      <AvatarImage
        className={avatarClassName}
        src={src}
        alt={alt}
        draggable={false}
        onError={() => setFailed()}
      />
    );
  }

  return (
    <AvatarFallback className={avatarClassName} style={getAvatarFallbackStyle(roomId)}>
      {renderFallback()}
    </AvatarFallback>
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
