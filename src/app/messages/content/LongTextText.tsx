import { useTranslation } from 'react-i18next';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { Box, Spinner, Text as FText, config } from 'folds';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';

import { MEmote, MNotice, MText } from './MsgTypeRenderers';
import {
  LongTextSource,
  getCachedLongTextContent,
  getLongTextSourceIdentity,
  withToolTraceFallback,
} from '../../matrix/protocol/longText';
import { ToolMetadataStatus } from '../../matrix/protocol/toolTrace';
import { hydrateCachedLongText } from '../../event-store/cache/attachmentRepository';

export enum LongTextKind {
  Text = 'text',
  Emote = 'emote',
  Notice = 'notice',
}

const LOADING_INDICATOR_DELAY_MS = 350;

type RenderBodyProps = {
  body: string;
  customBody?: string;
};

type LongTextTextProps = {
  kind: LongTextKind;
  displayName?: string;
  edited?: boolean;
  renderStateSuffix?: () => ReactNode;
  content: Record<string, unknown>;
  longTextSource: LongTextSource;
  renderBody: (
    content: Record<string, unknown>,
    props: RenderBodyProps,
    toolMetadataStatus: ToolMetadataStatus
  ) => ReactNode;
  renderAfterBody?: (
    content: Record<string, unknown>,
    fallbackContent: Record<string, unknown>
  ) => ReactNode;
  renderUrlsPreview?: (urls: string[]) => ReactNode;
  hydrate?: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const getStringValue = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
};

const hasRenderableFormattedBody = (value: Record<string, unknown>): boolean =>
  typeof value.formatted_body === 'string' && value.formatted_body.length > 0;

export const shouldResetResolvedContentToPreview = (
  nextPreviewContent: Record<string, unknown>,
  currentResolvedContent: Record<string, unknown>
): boolean => {
  if (hasRenderableFormattedBody(nextPreviewContent)) {
    return true;
  }
  return !hasRenderableFormattedBody(currentResolvedContent);
};

export const getLongTextHydrationIdentity = (
  content: Record<string, unknown>,
  source: Pick<LongTextSource, 'encryptedFile' | 'isV2ContentJson' | 'mxcUri' | 'owner'>
): string => {
  const info = isRecord(content.info) ? content.info : undefined;
  const meta = isRecord(content['io.mindroom.long_text'])
    ? content['io.mindroom.long_text']
    : undefined;

  return JSON.stringify({
    owner: source.owner,
    body: getStringValue(content, 'body'),
    encryptedFileHashes: isRecord(source.encryptedFile?.hashes)
      ? JSON.stringify(source.encryptedFile.hashes)
      : undefined,
    encryptedFileIv: source.encryptedFile?.iv,
    encryptedFileKey: isRecord(source.encryptedFile?.key)
      ? JSON.stringify(source.encryptedFile.key)
      : undefined,
    encryptedFileUrl: source.encryptedFile?.url,
    encryptedFileVersion: source.encryptedFile?.v,
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

export const useLongTextResolvedContent = (
  source: LongTextSource | undefined,
  enabled: boolean
): Record<string, unknown> | undefined => {
  const mx = useMatrixClient();
  const sourceIdentity = source ? getLongTextSourceIdentity(source) : undefined;
  const [resolvedEntry, setResolvedEntry] = useState<
    { sourceIdentity: string; content: Record<string, unknown> } | undefined
  >(() => {
    if (!source) return undefined;
    const cachedContent = getCachedLongTextContent(source, mx);
    return cachedContent && sourceIdentity ? { sourceIdentity, content: cachedContent } : undefined;
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

    if (!enabled) {
      return undefined;
    }

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

export function LongTextText({
  kind,
  displayName,
  edited,
  renderStateSuffix,
  content,
  longTextSource,
  renderBody,
  renderAfterBody,
  renderUrlsPreview,
  hydrate = true,
}: LongTextTextProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const { encryptedFile, isV2ContentJson, mxcUri, owner } = longTextSource;
  const hydrationIdentity = getLongTextHydrationIdentity(content, longTextSource);
  const hydrationInputRef = useRef({
    content,
    encryptedFile,
    isV2ContentJson,
    mxcUri,
    owner,
  });
  const [loading, setLoading] = useState(
    () => hydrate && !getCachedLongTextContent(longTextSource, mx)
  );
  const [settledHydrationIdentity, setSettledHydrationIdentity] = useState<string>();
  const [showLoadingIndicator, setShowLoadingIndicator] = useState(false);
  // Prewarmed rows must render hydrated on their FIRST paint: initialize
  // from the cache synchronously instead of flashing the preview until the
  // post-paint hydration effect runs. Gated on `hydrate` so overscan rows
  // keep the cheap preview (PR #110's guard) even when their sidecar is
  // already warm.
  const [resolvedContent, setResolvedContent] = useState<Record<string, unknown>>(
    () => (hydrate ? getCachedLongTextContent(longTextSource, mx) : undefined) ?? content
  );

  hydrationInputRef.current = {
    content,
    encryptedFile,
    isV2ContentJson,
    mxcUri,
    owner,
  };

  useEffect(() => {
    let cancelled = false;
    const hydrateContent = async () => {
      const {
        content: currentContent,
        encryptedFile: currentEncryptedFile,
        isV2ContentJson: currentIsV2ContentJson,
        mxcUri: currentMxcUri,
        owner: currentOwner,
      } = hydrationInputRef.current;

      if (hydrate) {
        // Warm cache: resolve synchronously — no preview reset, no async
        // round-trip, no loading state.
        const cachedContent = getCachedLongTextContent(
          {
            previewContent: currentContent,
            encryptedFile: currentEncryptedFile,
            isV2ContentJson: currentIsV2ContentJson,
            mxcUri: currentMxcUri,
          },
          mx
        );
        if (cachedContent) {
          setResolvedContent(cachedContent);
          setLoading(false);
          if (currentOwner)
            await hydrateCachedLongText(mx, {
              previewContent: currentContent,
              encryptedFile: currentEncryptedFile,
              isV2ContentJson: currentIsV2ContentJson,
              mxcUri: currentMxcUri,
              owner: currentOwner,
            });
          return;
        }
      }

      setResolvedContent((currentResolvedContent) =>
        !hydrate || shouldResetResolvedContentToPreview(currentContent, currentResolvedContent)
          ? withToolTraceFallback(currentContent, currentResolvedContent)
          : currentResolvedContent
      );

      if (!hydrate) {
        setLoading(false);
        return;
      }

      setLoading(true);
      const nextContent = await hydrateCachedLongText(mx, {
        previewContent: currentContent,
        encryptedFile: currentEncryptedFile,
        isV2ContentJson: currentIsV2ContentJson,
        mxcUri: currentMxcUri,
        owner: currentOwner,
      });

      if (!cancelled) {
        setResolvedContent(nextContent);
        setSettledHydrationIdentity(hydrationIdentity);
        setLoading(false);
      }
    };

    hydrateContent();

    return () => {
      cancelled = true;
    };
  }, [hydrate, hydrationIdentity, mx]);

  useEffect(() => {
    if (!loading) {
      setShowLoadingIndicator(false);
      return undefined;
    }

    const timerId = setTimeout(() => {
      setShowLoadingIndicator(true);
    }, LOADING_INDICATOR_DELAY_MS);

    return () => {
      clearTimeout(timerId);
    };
  }, [loading]);

  // Render-time warm-cache read: a row that mounted cold (hydrate=false)
  // and later flips to hydrate=true must show cached content on the flip's
  // OWN render, not one effect-pass later (the mount initializer and the
  // hydration effect only cover mount and post-paint). Pure read of the
  // module cache for the current source; the effect converges state to the
  // same value.
  const warmResolvedContent = hydrate
    ? getCachedLongTextContent(longTextSource, mx)
    : undefined;
  const displayContent = warmResolvedContent ?? resolvedContent;
  const toolMetadataStatus: ToolMetadataStatus =
    !warmResolvedContent && (loading || !hydrate || settledHydrationIdentity !== hydrationIdentity)
      ? 'loading'
      : 'unavailable';

  const afterBody = renderAfterBody?.(content, displayContent);

  let textContent: ReactNode;
  if (kind === LongTextKind.Emote) {
    textContent = (
      <MEmote
        displayName={displayName ?? ''}
        edited={edited}
        renderStateSuffix={renderStateSuffix}
        content={displayContent}
        renderBody={(props) => renderBody(displayContent, props, toolMetadataStatus)}
        renderAfterBody={afterBody}
        renderUrlsPreview={renderUrlsPreview}
      />
    );
  } else if (kind === LongTextKind.Notice) {
    textContent = (
      <MNotice
        edited={edited}
        renderStateSuffix={renderStateSuffix}
        content={displayContent}
        renderBody={(props) => renderBody(displayContent, props, toolMetadataStatus)}
        renderAfterBody={afterBody}
        renderUrlsPreview={renderUrlsPreview}
      />
    );
  } else {
    textContent = (
      <MText
        edited={edited}
        renderStateSuffix={renderStateSuffix}
        content={displayContent}
        renderBody={(props) => renderBody(displayContent, props, toolMetadataStatus)}
        renderAfterBody={afterBody}
        renderUrlsPreview={renderUrlsPreview}
      />
    );
  }

  return (
    <>
      {textContent}
      {showLoadingIndicator && (
        <Box alignItems="Center" gap="100" style={{ marginTop: config.space.S100 }}>
          <Spinner size="100" variant="Secondary" />
          <FText size="T200">
            {t('mindroomUi.messages.mindroomLongTextText.loadingFullResponse')}
          </FText>
        </Box>
      )}
    </>
  );
}
