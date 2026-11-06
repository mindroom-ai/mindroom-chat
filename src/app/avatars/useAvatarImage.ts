import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ClientEvent, SyncState, type MatrixClient } from 'matrix-js-sdk';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useSpecVersions } from '../matrix/hooks/useSpecVersions';
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
// `failedAt` is the client's reconnect count when the picture failed to load.
type ImageState = {
  src: string | undefined;
  source: Source;
  objectUrl?: string;
  failedAt?: number;
};

type Reconnects = { count: number; listeners: Set<() => void> };
const reconnects = new WeakMap<AvatarMediaClient, Reconnects>();
const NO_RECONNECTS: Reconnects = { count: 0, listeners: new Set() };

/**
 * Counts the client's returns to a working sync (the first one and each after an outage), so a
 * picture that failed to load while the homeserver was out of reach is tried again.
 */
const getReconnects = (mx: AvatarMediaClient | undefined): Reconnects => {
  const emitter = mx as Partial<Pick<MatrixClient, 'on'>> | undefined;
  if (!mx || typeof emitter?.on !== 'function') return NO_RECONNECTS;
  let entry = reconnects.get(mx);
  if (!entry) {
    const created: Reconnects = { count: 0, listeners: new Set() };
    emitter.on(ClientEvent.Sync, (state: SyncState, previous: SyncState | null) => {
      const returned =
        state === SyncState.Prepared ||
        (state === SyncState.Syncing && previous !== SyncState.Syncing);
      if (!returned) return;
      created.count += 1;
      created.listeners.forEach((listener) => listener());
    });
    reconnects.set(mx, created);
    entry = created;
  }
  return entry;
};

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
 * available, and may change back. A picture that failed is tried again when the client's sync
 * recovers, since the homeserver may only have been out of reach.
 */
export function useAvatarImage(src: string | undefined): AvatarImage {
  const mx = useClientIfAny();
  const versions = useSpecVersions();
  const [state, setState] = useState<ImageState>(() => startFor(src, mx, versions));
  const sync = getReconnects(mx);
  const subscribe = useCallback(
    (onChange: () => void) => {
      sync.listeners.add(onChange);
      return () => {
        sync.listeners.delete(onChange);
      };
    },
    [sync]
  );
  const reconnectCount = useSyncExternalStore(subscribe, () => sync.count);
  const reconnectRef = useRef(reconnectCount);
  reconnectRef.current = reconnectCount;

  let current = state;
  const failedBeforeReconnect =
    state.source === 'none' && state.failedAt !== undefined && state.failedAt < reconnectCount;
  if (state.src !== src || failedBeforeReconnect) {
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
        return objectUrl
          ? { src, source: 'fetched', objectUrl }
          : { src, source: 'none', failedAt: reconnectRef.current };
      });
    });
    return () => {
      mounted = false;
    };
  }, [fetching, src, mx]);

  const onImageError = () =>
    setState((prev) => {
      if (prev.src !== src || prev.source !== 'direct') {
        return prev.src === src ? { src, source: 'none', failedAt: reconnectRef.current } : prev;
      }
      // The direct load failed; homeserver media gets one more try with the token.
      const retry = !!src && !!mx && canFetchAvatar(mx, src);
      return retry
        ? { src, source: 'fetching' }
        : { src, source: 'none', failedAt: reconnectRef.current };
    });

  let imageSrc: string | undefined;
  if (current.source === 'direct') imageSrc = src;
  else if (current.source === 'fetched') imageSrc = current.objectUrl;
  return { imageSrc, onImageError };
}
