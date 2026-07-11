import { useEffect } from 'react';
import type { MatrixClient, MatrixEvent } from 'matrix-js-sdk';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import {
  getCachedMindroomLongTextContent,
  getMindroomLongTextSource,
  getMindroomLongTextSourceIdentity,
  hydrateMindroomLongTextSource,
  type MindroomLongTextSource,
} from './longText';
import { downloadMindroomLongTextSidecarText } from './longTextDownload';

const PREWARM_CONCURRENCY = 3;

/**
 * Pre-download the long-text sidecars for a batch of events so a reply's
 * full Markdown is already hydrated when its row renders or expands. The
 * viewport IntersectionObserver gate (PR #110) covers rows the user reaches;
 * this covers the open thread wholesale, matching the "attachments are part
 * of the message" expectation. Failures are not cached
 * (`hydrateMindroomLongTextSource` only caches successful parses), so a
 * later render or prewarm retries naturally.
 */
export const prewarmMindroomLongTextSidecars = async (
  mx: MatrixClient,
  events: readonly MatrixEvent[],
  useAuthentication: boolean,
  isCancelled: () => boolean = () => false
): Promise<void> => {
  const pending: MindroomLongTextSource[] = [];
  const seenIdentities = new Set<string>();
  events.forEach((mEvent) => {
    const content = mEvent.getContent() as Record<string, unknown>;
    const source = getMindroomLongTextSource(content);
    if (!source) return;
    const identity = getMindroomLongTextSourceIdentity(source);
    if (seenIdentities.has(identity)) return;
    seenIdentities.add(identity);
    if (getCachedMindroomLongTextContent(source, mx)) return;
    pending.push(source);
  });
  if (pending.length === 0) return;

  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < pending.length && !isCancelled()) {
      const source = pending[nextIndex];
      nextIndex += 1;
      // eslint-disable-next-line no-await-in-loop
      await hydrateMindroomLongTextSource(
        source,
        (nextSource) => downloadMindroomLongTextSidecarText(mx, nextSource, useAuthentication),
        mx
      ).catch(() => undefined);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(PREWARM_CONCURRENCY, pending.length) }, () => worker())
  );
};

/** Prewarm the sidecars of the given events whenever the set changes. */
export const useMindroomLongTextPrewarm = (
  events: readonly MatrixEvent[],
  enabled: boolean
): void => {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();

  useEffect(() => {
    if (!enabled || events.length === 0) return undefined;
    let cancelled = false;
    void prewarmMindroomLongTextSidecars(mx, events, useAuthentication, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [enabled, events, mx, useAuthentication]);
};
