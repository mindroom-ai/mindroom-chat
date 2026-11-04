import { useEffect, useState } from 'react';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useSpecVersions } from '../../hooks/useSpecVersions';
import {
  AvatarMediaClient,
  avatarNeedsFetch,
  canFetchAvatar,
  fetchAvatar,
  peekFetchedAvatar,
} from './avatarMedia';

// How the avatar gets its picture: straight from `src`, from a fetch with the access token
// (avatarMedia.ts), or not at all, in which case the fallback shows.
type Source = 'direct' | 'fetching' | 'fetched' | 'none';
type ImageState = { src: string | undefined; source: Source; objectUrl?: string };

/** The active account's client, or undefined outside `MatrixClientProvider` (tests, previews). */
const useClientIfAny = (): AvatarMediaClient | undefined => {
  try {
    return useMatrixClient();
  } catch {
    return undefined;
  }
};

const startFor = (
  src: string | undefined,
  mx: AvatarMediaClient | undefined,
  versions: ReturnType<typeof useSpecVersions>
): ImageState => {
  if (!src) return { src, source: 'none' };
  if (!mx) return { src, source: 'direct' };
  const objectUrl = peekFetchedAvatar(mx, src);
  if (objectUrl) return { src, source: 'fetched', objectUrl };
  return { src, source: avatarNeedsFetch(mx, src, versions) ? 'fetching' : 'direct' };
};

export type AvatarImage = {
  /** What the `<img>` shows; undefined while there is nothing to show, so the fallback renders. */
  imageSrc: string | undefined;
  /** For the `<img>`'s `onError`. */
  onImageError: () => void;
};

/**
 * The picture for an avatar whose image is at `src`. When the page cannot load homeserver media
 * by itself, or the image fails, it is fetched with the account's access token instead. A new
 * `src` starts over, even one that failed before: media URLs change once authenticated media is
 * available, and may change back.
 */
export function useAvatarImage(src: string | undefined): AvatarImage {
  const mx = useClientIfAny();
  const versions = useSpecVersions();
  const [state, setState] = useState<ImageState>(() => startFor(src, mx, versions));

  let current = state;
  if (state.src !== src) {
    current = startFor(src, mx, versions);
    setState(current);
  }

  const fetching = current.source === 'fetching';
  useEffect(() => {
    if (!fetching || !src || !mx) return undefined;
    let mounted = true;
    void fetchAvatar(mx, src).then((objectUrl) => {
      if (!mounted) return;
      setState((prev) => {
        if (prev.src !== src) return prev;
        return objectUrl ? { src, source: 'fetched', objectUrl } : { src, source: 'none' };
      });
    });
    return () => {
      mounted = false;
    };
  }, [fetching, src, mx]);

  const onImageError = () =>
    setState((prev) => {
      if (prev.src !== src || prev.source !== 'direct') {
        return prev.src === src ? { src, source: 'none' } : prev;
      }
      // The direct load failed; homeserver media gets one more try with the token.
      const retry = !!src && !!mx && canFetchAvatar(mx, src);
      return { src, source: retry ? 'fetching' : 'none' };
    });

  let imageSrc: string | undefined;
  if (current.source === 'direct') imageSrc = src;
  else if (current.source === 'fetched') imageSrc = current.objectUrl;
  return { imageSrc, onImageError };
}
