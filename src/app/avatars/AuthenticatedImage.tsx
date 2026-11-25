import type { ImgHTMLAttributes } from 'react';
import type { AvatarMediaClient } from './avatarMedia';
import { useAvatarImage } from './useAvatarImage';

type AuthenticatedImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  /** Explicit Matrix client for callers rendered outside `MatrixClientProvider`. */
  client?: AvatarMediaClient;
};

/**
 * An `<img>` whose `src` resolves through `useAvatarImage`, so homeserver media fetches with
 * `Authorization: Bearer` when no service worker or Electron desktop interceptor adds the header.
 */
export function AuthenticatedImage({
  src,
  client,
  alt = '',
  onError,
  ...props
}: AuthenticatedImageProps) {
  const { imageSrc, onImageError } = useAvatarImage(src, client);
  if (!imageSrc) return null;
  return (
    <img
      {...props}
      src={imageSrc}
      alt={alt}
      onError={(event) => {
        onImageError();
        onError?.(event);
      }}
    />
  );
}
