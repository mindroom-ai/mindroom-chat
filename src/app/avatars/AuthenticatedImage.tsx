import type { ImgHTMLAttributes, ReactNode } from 'react';
import type { AvatarMediaClient } from './avatarMedia';
import { useAvatarImage } from './useAvatarImage';

type AuthenticatedImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  /** Explicit Matrix client for callers rendered outside `MatrixClientProvider`. */
  client?: AvatarMediaClient;
  /** Shown when the image cannot load (or while loading if `showFallbackWhileLoading`). */
  fallback?: ReactNode;
  /** Render `fallback` during the initial fetch too, e.g. to keep an anchor labelled. */
  showFallbackWhileLoading?: boolean;
};

/**
 * An `<img>` whose `src` resolves through `useAvatarImage`, so homeserver media fetches with
 * `Authorization: Bearer` when no service worker or Electron desktop interceptor adds the header.
 */
export function AuthenticatedImage({
  src,
  client,
  alt = '',
  fallback = null,
  showFallbackWhileLoading = false,
  onError,
  ...props
}: AuthenticatedImageProps) {
  const { imageSrc, loading, onImageError } = useAvatarImage(src, client);
  if (!imageSrc) return !loading || showFallbackWhileLoading ? fallback : null;
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
