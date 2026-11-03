import React, { CSSProperties, ImgHTMLAttributes, ReactNode } from 'react';
import classNames from 'classnames';
import { AvatarFallback, AvatarImage, color } from 'folds';
import { AVATAR_SWATCH_COUNT, AVATAR_SWATCH_INK, avatarSwatchVar } from './avatarSwatches';
import { useAvatarImage } from './useAvatarImage';
import * as css from './UserAvatar.css';

// Tinted fills rotate through the theme's accent containers, picked by a stable hash of the ID.
// Read on first use, not at import, so importing the avatar never needs the folds theme.
const getFallbackColors = () => [
  { background: color.Primary.Container, foreground: color.Primary.OnContainer },
  { background: color.Secondary.Container, foreground: color.Secondary.OnContainer },
  { background: color.Success.Container, foreground: color.Success.OnContainer },
  { background: color.Warning.Container, foreground: color.Warning.OnContainer },
  { background: color.Critical.Container, foreground: color.Critical.OnContainer },
];

const hashId = (id: string): number => {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
};

/**
 * How an avatar without a picture is filled: `tinted` with a pale accent container, `solid` with
 * a saturated swatch from the avatar palette (a room header tile), or `plain`, with no fill at all
 * (an icon that sits on the surface, as in the room list). The color follows the ID.
 */
export type AvatarFallbackTone = 'tinted' | 'solid' | 'plain';

/** The fallback fill and text color for an avatar of this user or room ID. */
export const getAvatarFallbackStyle = (
  id: string,
  tone: AvatarFallbackTone = 'tinted'
): CSSProperties | undefined => {
  if (tone === 'plain') return undefined;
  if (tone === 'solid') {
    const swatch = hashId(id) % AVATAR_SWATCH_COUNT;
    return { backgroundColor: avatarSwatchVar(swatch), color: AVATAR_SWATCH_INK };
  }
  const colors = getFallbackColors();
  const fill = colors[hashId(id) % colors.length];
  return { backgroundColor: fill.background, color: fill.foreground };
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
    return (
      <AvatarFallback
        className={fallbackClassName}
        style={getAvatarFallbackStyle(fallbackId, fallbackTone)}
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
  /** How the fallback is filled; tinted by default. */
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
