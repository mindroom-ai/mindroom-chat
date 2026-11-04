import React, { CSSProperties, ImgHTMLAttributes, ReactNode } from 'react';
import classNames from 'classnames';
import { AvatarFallback, AvatarImage } from 'folds';
import { AVATAR_SWATCH_INK, avatarSwatchIndex, avatarSwatchVar } from './avatarSwatches';
import { useAvatarImage } from './useAvatarImage';
import * as css from './UserAvatar.css';

/**
 * How an avatar without a picture is filled: `solid` with the swatch of its ID from the avatar
 * palette, so a user or room has the same color everywhere, or `plain`, with no fill at all (an
 * icon that sits on the surface, as in the room list).
 */
export type AvatarFallbackTone = 'solid' | 'plain';

/** The fallback fill and text color for an avatar of this user or room ID. */
export const getAvatarFallbackStyle = (
  id: string,
  tone: AvatarFallbackTone = 'solid'
): CSSProperties | undefined => {
  if (tone === 'plain') return undefined;
  return { backgroundColor: avatarSwatchVar(avatarSwatchIndex(id)), color: AVATAR_SWATCH_INK };
};

type AvatarPictureProps = Pick<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt'> & {
  imageClassName: string;
  fallbackClassName?: string;
  /** The user or room ID the fallback color follows. */
  fallbackId: string;
  fallbackTone?: AvatarFallbackTone;
  /** Shown while there is no picture: no `src`, still fetching, or failed. */
  renderFallback: () => ReactNode;
};

/**
 * The picture inside a folds `Avatar`, loaded through `useAvatarImage` (so homeserver media also
 * loads without a service worker), with the fallback in its place until there is one. The
 * fallback and its colors are only worked out when it shows.
 */
export function AvatarPicture({
  src,
  alt,
  imageClassName,
  fallbackClassName,
  fallbackId,
  fallbackTone,
  renderFallback,
}: AvatarPictureProps) {
  const { imageSrc, onImageError } = useAvatarImage(src);
  if (!imageSrc) {
    const fill = getAvatarFallbackStyle(fallbackId, fallbackTone);
    // Filled fallbacks name the ID their color follows, so tests can compare screens.
    return (
      <AvatarFallback
        className={fallbackClassName}
        style={fill}
        data-avatar-fallback-id={fill ? fallbackId : undefined}
      >
        {renderFallback()}
      </AvatarFallback>
    );
  }
  return (
    <AvatarImage
      onError={onImageError}
      draggable={false}
      className={imageClassName}
      src={imageSrc}
      alt={alt}
    />
  );
}

/** The image attributes the avatar takes; without a `src` (an HTTP URL) the fallback shows. */
type AvatarImageProps = Pick<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt' | 'className'>;

type UserAvatarProps = AvatarImageProps & {
  userId: string;
  /** Fallback content, usually the first letter of the name. */
  renderFallback: () => ReactNode;
  /** How the fallback is filled; solid by default. */
  fallbackTone?: AvatarFallbackTone;
};

/** A user's avatar image, or a colored fallback while there is none or it fails to load. */
export function UserAvatar({
  userId,
  src,
  alt,
  className,
  renderFallback,
  fallbackTone,
}: UserAvatarProps) {
  return (
    <AvatarPicture
      src={src}
      alt={alt}
      imageClassName={classNames(css.UserAvatar, className)}
      fallbackClassName={className}
      fallbackId={userId}
      fallbackTone={fallbackTone}
      renderFallback={renderFallback}
    />
  );
}
