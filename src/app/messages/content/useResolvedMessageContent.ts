import { useEffect, useMemo, useRef, useState } from 'react';
import { useMatrixClient, useOptionalMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { trimReplyFromBody } from '../../matrix/room';
import { isRecord } from '../../lib/isRecord';
import {
  LongTextSource,
  getCachedLongTextContent,
  getLongTextSourceIdentity,
  hasLongTextMetadata,
  withToolTraceFallback,
} from '../../matrix/protocol/longText';
import type { ToolMetadataStatus } from '../../matrix/protocol/toolTrace';
import { COMPACTIONS_CONTENT_KEY } from '../../matrix/protocol/compactions';
import { TRIGGER_WAKE_METADATA_KEYS } from '../../matrix/protocol/triggerWake';
import { TODO_POKE_METADATA_KEYS } from '../../matrix/protocol/todoPoke';
import { sanitizeContent } from '../../matrix/protocol/untrustedContent';
import {
  LIVE_COMPACTIONS_KEY,
  LIVE_REASONING_KEY,
  LIVE_REASONING_SEGMENTS_KEY,
} from '../live/useLiveReplyContent';
import { hydrateCachedLongText } from '../../event-store/cache/attachmentRepository';

const LOADING_INDICATOR_DELAY_MS = 350;

/** The live keys a streaming reply's frames add to its outer content (useLiveReplyContent). */
const LIVE_WRAPPER_KEYS = [LIVE_REASONING_KEY, LIVE_REASONING_SEGMENTS_KEY, LIVE_COMPACTIONS_KEY];

/** Wrapper keys carried onto a hydrated sidecar when the sidecar leaves them out. */
const FALLBACK_WRAPPER_KEYS = [
  COMPACTIONS_CONTENT_KEY,
  ...TRIGGER_WAKE_METADATA_KEYS,
  ...TODO_POKE_METADATA_KEYS,
];

const getStringValue = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
};

const hasRenderableFormattedBody = (value: Record<string, unknown>): boolean =>
  typeof value.formatted_body === 'string' && value.formatted_body.length > 0;

/**
 * The live reasoning and compactions of `outer`, moved onto the content a long text resolved, and
 * its own compactions or trigger metadata when the download leaves them out.
 */
const withLiveWrapperContent = (
  resolved: Record<string, unknown>,
  outer: Record<string, unknown>
): Record<string, unknown> => {
  if (resolved === outer) return resolved;
  const carried = [
    ...LIVE_WRAPPER_KEYS,
    ...FALLBACK_WRAPPER_KEYS.filter((key) => resolved[key] === undefined),
  ].filter((key) => outer[key] !== undefined && resolved[key] !== outer[key]);
  if (carried.length === 0) return resolved;
  return { ...resolved, ...Object.fromEntries(carried.map((key) => [key, outer[key]])) };
};

export const shouldResetResolvedContentToPreview = (
  nextPreviewContent: Record<string, unknown>,
  currentResolvedContent: Record<string, unknown>
): boolean =>
  hasRenderableFormattedBody(nextPreviewContent) ||
  !hasRenderableFormattedBody(currentResolvedContent);

export const getLongTextHydrationIdentity = (
  content: Record<string, unknown>,
  source: Pick<LongTextSource, 'encryptedFile' | 'isV2ContentJson' | 'mxcUri' | 'owner'>
): string => {
  const info = isRecord(content.info) ? content.info : undefined;
  const meta = isRecord(content['io.mindroom.long_text'])
    ? content['io.mindroom.long_text']
    : undefined;
  const enc = source.encryptedFile;

  return JSON.stringify({
    owner: source.owner,
    body: getStringValue(content, 'body'),
    encryptedFileHashes: isRecord(enc?.hashes) ? JSON.stringify(enc.hashes) : undefined,
    encryptedFileIv: enc?.iv,
    encryptedFileKey: isRecord(enc?.key) ? JSON.stringify(enc.key) : undefined,
    encryptedFileUrl: enc?.url,
    encryptedFileVersion: enc?.v,
    filename: getStringValue(content, 'filename'),
    format: getStringValue(content, 'format'),
    formattedBody: getStringValue(content, 'formatted_body'),
    infoMimetype: typeof info?.mimetype === 'string' ? info.mimetype : undefined,
    isV2ContentJson: source.isV2ContentJson,
    longTextEncoding: typeof meta?.encoding === 'string' ? meta.encoding : undefined,
    longTextVersion: typeof meta?.version === 'number' ? meta.version : undefined,
    msgtype: getStringValue(content, 'msgtype'),
    mxcUri: source.mxcUri,
    url: getStringValue(content, 'url'),
  });
};

type ResolvedEntry = { sourceIdentity: string; content: Record<string, unknown> };

export const useLongTextResolvedContent = (
  source: LongTextSource | undefined,
  enabled: boolean
): Record<string, unknown> | undefined => {
  const mx = useMatrixClient();
  const sourceIdentity = source ? getLongTextSourceIdentity(source) : undefined;
  const [resolvedEntry, setResolvedEntry] = useState<ResolvedEntry | undefined>(() => {
    if (!source || !sourceIdentity) return undefined;
    const cachedContent = getCachedLongTextContent(source, mx);
    return cachedContent ? { sourceIdentity, content: cachedContent } : undefined;
  });

  useEffect(() => {
    if (!source) {
      setResolvedEntry(undefined);
      return undefined;
    }

    const cachedContent = getCachedLongTextContent(source, mx);
    if (cachedContent) {
      setResolvedEntry({
        sourceIdentity: getLongTextSourceIdentity(source),
        content: cachedContent,
      });
      if (!source.owner) return undefined;
    }

    if (!enabled) return undefined;

    let cancelled = false;
    void (async () => {
      const nextContent = await hydrateCachedLongText(mx, source);
      if (!cancelled) {
        setResolvedEntry({
          sourceIdentity: getLongTextSourceIdentity(source),
          content: nextContent,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, mx, source, sourceIdentity]);

  if (sourceIdentity && resolvedEntry?.sourceIdentity === sourceIdentity) {
    return resolvedEntry.content;
  }

  return source ? getCachedLongTextContent(source, mx) : undefined;
};

export type UseResolvedMessageContentParams = {
  outerContent: Record<string, unknown>;
  content: Record<string, unknown>;
  longTextSource?: LongTextSource;
  fromMindroomAgent: boolean;
  hydrate?: boolean;
};

export type ResolvedMessageContent = {
  content: Record<string, unknown>;
  rawHydratedContent: Record<string, unknown> | undefined;
  toolMetadataStatus: ToolMetadataStatus | undefined;
  showLoadingIndicator: boolean;
  canFold: boolean;
};

/**
 * Resolves message content through a single seam: hydrates a long-text sidecar when active,
 * sanitizes downloaded content without mutating the shared MXC cache, carries outer live wrapper
 * keys once, and tracks raw hydrated content (preserving non-enumerable sidecar facts) for the
 * current source revision.
 */
export const useResolvedMessageContent = ({
  outerContent,
  content,
  longTextSource,
  fromMindroomAgent,
  hydrate = true,
}: UseResolvedMessageContentParams): ResolvedMessageContent => {
  const mx = useOptionalMatrixClient();
  const activeSidecar = mx && longTextSource ? { mx, source: longTextSource } : undefined;
  const hasActiveSidecar = activeSidecar !== undefined;
  const sourceIdentity = activeSidecar
    ? getLongTextSourceIdentity(activeSidecar.source)
    : undefined;
  const hydrationIdentity = activeSidecar
    ? getLongTextHydrationIdentity(content, activeSidecar.source)
    : undefined;
  // Render-time warm-cache read: covers sync first paint, warm receipts (even when hydrate=false),
  // and hydrate false -> true flips on the flip's own render before effects run.
  const warmCachedContent = activeSidecar
    ? getCachedLongTextContent(activeSidecar.source, activeSidecar.mx)
    : undefined;
  const warmResolvedContent = hydrate ? warmCachedContent : undefined;

  const hydrationInputRef = useRef(
    activeSidecar ? { content, source: activeSidecar.source } : undefined
  );
  const [loading, setLoading] = useState(() =>
    Boolean(activeSidecar && hydrate && !warmCachedContent)
  );
  const [settledHydrationIdentity, setSettledHydrationIdentity] = useState<string>();
  const [loadingIndicatorElapsed, setLoadingIndicatorElapsed] = useState(false);
  // Prewarmed rows render hydrated on first paint when hydrate=true; overscan rows keep preview.
  const [resolvedContent, setResolvedContent] = useState<Record<string, unknown> | undefined>(() =>
    activeSidecar ? (warmResolvedContent ?? content) : undefined
  );
  const [hydratedEntry, setHydratedEntry] = useState<ResolvedEntry | undefined>(() =>
    warmCachedContent && sourceIdentity ? { sourceIdentity, content: warmCachedContent } : undefined
  );

  // Reset sidecar state as soon as `activeSidecar` disappears so a later
  // `defined -> undefined -> defined` transition never flashes stale sidecar data.
  if (
    !hasActiveSidecar &&
    (resolvedContent !== undefined ||
      hydratedEntry !== undefined ||
      loading ||
      loadingIndicatorElapsed ||
      settledHydrationIdentity !== undefined)
  ) {
    setResolvedContent(undefined);
    setHydratedEntry(undefined);
    setSettledHydrationIdentity(undefined);
    setLoading(false);
    setLoadingIndicatorElapsed(false);
  }

  hydrationInputRef.current = activeSidecar ? { content, source: activeSidecar.source } : undefined;

  useEffect(() => {
    if (!hydrationIdentity || !sourceIdentity || !mx) {
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    const hydrateContent = async () => {
      const currentInput = hydrationInputRef.current;
      if (!currentInput) return;
      const { content: currentContent, source: currentSource } = currentInput;
      const hydrateSource: LongTextSource = { ...currentSource, previewContent: currentContent };

      if (hydrate) {
        const cachedContent = getCachedLongTextContent(hydrateSource, mx);
        if (cachedContent) {
          setResolvedContent(cachedContent);
          setHydratedEntry({ sourceIdentity, content: cachedContent });
          setLoading(false);
          if (currentSource.owner) await hydrateCachedLongText(mx, hydrateSource);
          return;
        }
      }

      setResolvedContent((currentResolvedContent) => {
        if (!currentResolvedContent) return currentContent;
        return !hydrate ||
          shouldResetResolvedContentToPreview(currentContent, currentResolvedContent)
          ? withToolTraceFallback(currentContent, currentResolvedContent)
          : currentResolvedContent;
      });

      if (!hydrate) {
        setLoading(false);
        return;
      }

      setLoading(true);
      const nextContent = await hydrateCachedLongText(mx, hydrateSource);

      if (!cancelled) {
        setResolvedContent(nextContent);
        setHydratedEntry(
          nextContent === currentContent ? undefined : { sourceIdentity, content: nextContent }
        );
        setSettledHydrationIdentity(hydrationIdentity);
        setLoading(false);
      }
    };

    void hydrateContent();

    return () => {
      cancelled = true;
    };
  }, [hydrate, hydrationIdentity, mx, sourceIdentity]);

  useEffect(() => {
    if (!loading) {
      setLoadingIndicatorElapsed(false);
      return undefined;
    }
    const timerId = setTimeout(() => setLoadingIndicatorElapsed(true), LOADING_INDICATOR_DELAY_MS);
    return () => clearTimeout(timerId);
  }, [loading]);

  const rawDisplayContent = activeSidecar
    ? (warmResolvedContent ?? resolvedContent ?? content)
    : content;
  const rawHydratedContent =
    warmCachedContent ??
    (sourceIdentity && hydratedEntry?.sourceIdentity === sourceIdentity
      ? hydratedEntry.content
      : undefined);

  const sanitized = useMemo(
    () => (hasActiveSidecar ? sanitizeContent(rawDisplayContent, fromMindroomAgent) : content),
    [hasActiveSidecar, rawDisplayContent, fromMindroomAgent, content]
  );
  const hasLongTextSource = longTextSource !== undefined;
  const displayContent = useMemo(
    () =>
      hasActiveSidecar || hasLongTextSource
        ? withLiveWrapperContent(sanitized, outerContent)
        : sanitized,
    [hasActiveSidecar, hasLongTextSource, sanitized, outerContent]
  );
  const toolMetadataStatus: ToolMetadataStatus | undefined = hasActiveSidecar
    ? !warmResolvedContent &&
      (loading || !hydrate || settledHydrationIdentity !== hydrationIdentity)
      ? 'loading'
      : 'unavailable'
    : undefined;

  const previewHasText = !!trimReplyFromBody(getStringValue(displayContent, 'body') ?? '').trim();

  return {
    content: displayContent,
    rawHydratedContent,
    toolMetadataStatus,
    showLoadingIndicator: hasActiveSidecar && loadingIndicatorElapsed && !previewHasText,
    canFold: !hasActiveSidecar || !hasLongTextMetadata(sanitized),
  };
};
