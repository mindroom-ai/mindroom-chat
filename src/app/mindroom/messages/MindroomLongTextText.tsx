import React, { ReactNode, useEffect, useRef, useState } from 'react';
import { MatrixClient } from 'matrix-js-sdk';
import { Box, Spinner, Text as FText, config } from 'folds';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import {
  decryptFile,
  downloadEncryptedMedia,
  downloadMedia,
  mxcUrlToHttp,
} from '../../utils/matrix';
import { MEmote, MNotice, MText } from '../../components/message/MsgTypeRenderers';
import {
  MindroomLongTextSource,
  getCachedMindroomLongTextContent,
  getMindroomLongTextSourceIdentity,
  hydrateMindroomLongTextSource,
  withMindroomToolTraceFallback,
} from './longText';

export enum MindroomLongTextKind {
  Text = 'text',
  Emote = 'emote',
  Notice = 'notice',
}

const LOADING_INDICATOR_DELAY_MS = 350;

type RenderBodyProps = {
  body: string;
  customBody?: string;
};

type MindroomLongTextTextProps = {
  kind: MindroomLongTextKind;
  displayName?: string;
  edited?: boolean;
  renderStateSuffix?: () => ReactNode;
  content: Record<string, unknown>;
  longTextSource: MindroomLongTextSource;
  renderBody: (content: Record<string, unknown>, props: RenderBodyProps) => ReactNode;
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

const getLongTextMimeType = (content: Record<string, unknown>): string => {
  const info = isRecord(content.info) ? content.info : undefined;
  return typeof info?.mimetype === 'string' ? info.mimetype : 'application/json';
};

const downloadSidecarBlob = async (
  source: MindroomLongTextSource,
  textUrl: string
): Promise<Blob> => {
  const encryptedFile = source.encryptedFile;
  if (!encryptedFile) return downloadMedia(textUrl);

  const mimeType = getLongTextMimeType(source.previewContent);
  return downloadEncryptedMedia(textUrl, (encBuf) => decryptFile(encBuf, mimeType, encryptedFile));
};

export const downloadMindroomLongTextSidecarBlob = async (
  mx: MatrixClient,
  source: MindroomLongTextSource,
  useAuthentication: boolean
): Promise<Blob> => {
  const textUrl = mxcUrlToHttp(mx, source.mxcUri, useAuthentication);
  if (!textUrl) {
    throw new Error('Unable to resolve sidecar URL');
  }

  return downloadSidecarBlob(source, textUrl);
};

export const downloadMindroomLongTextSidecarText = async (
  mx: MatrixClient,
  source: MindroomLongTextSource,
  useAuthentication: boolean
): Promise<string> => {
  const blob = await downloadMindroomLongTextSidecarBlob(mx, source, useAuthentication);
  return blob.text();
};

export const getMindroomLongTextHydrationIdentity = (
  content: Record<string, unknown>,
  source: Pick<MindroomLongTextSource, 'encryptedFile' | 'isV2ContentJson' | 'mxcUri'>
): string => {
  const info = isRecord(content.info) ? content.info : undefined;
  const meta = isRecord(content['io.mindroom.long_text'])
    ? content['io.mindroom.long_text']
    : undefined;

  return JSON.stringify({
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

export const useMindroomLongTextResolvedContent = (
  source: MindroomLongTextSource | undefined,
  enabled: boolean
): Record<string, unknown> | undefined => {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const sourceIdentity = source ? getMindroomLongTextSourceIdentity(source) : undefined;
  const [resolvedEntry, setResolvedEntry] = useState<
    { sourceIdentity: string; content: Record<string, unknown> } | undefined
  >(() => {
    if (!source) return undefined;
    const cachedContent = getCachedMindroomLongTextContent(source, mx);
    return cachedContent && sourceIdentity ? { sourceIdentity, content: cachedContent } : undefined;
  });

  useEffect(() => {
    if (!source) {
      setResolvedEntry(undefined);
      return undefined;
    }

    const cachedContent = getCachedMindroomLongTextContent(source, mx);
    if (cachedContent) {
      setResolvedEntry({
        sourceIdentity: getMindroomLongTextSourceIdentity(source),
        content: cachedContent,
      });
      return undefined;
    }

    if (!enabled) {
      return undefined;
    }

    let cancelled = false;

    void (async () => {
      const nextContent = await hydrateMindroomLongTextSource(
        source,
        (nextSource) => downloadMindroomLongTextSidecarText(mx, nextSource, useAuthentication),
        mx
      );

      if (!cancelled) {
        setResolvedEntry({
          sourceIdentity: getMindroomLongTextSourceIdentity(source),
          content: nextContent,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, mx, source, sourceIdentity, useAuthentication]);

  if (sourceIdentity && resolvedEntry?.sourceIdentity === sourceIdentity) {
    return resolvedEntry.content;
  }

  return source ? getCachedMindroomLongTextContent(source, mx) : undefined;
};

export function MindroomLongTextText({
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
}: MindroomLongTextTextProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const { encryptedFile, isV2ContentJson, mxcUri } = longTextSource;
  const hydrationIdentity = getMindroomLongTextHydrationIdentity(content, longTextSource);
  const hydrationInputRef = useRef({
    content,
    encryptedFile,
    isV2ContentJson,
    mxcUri,
  });
  const [loading, setLoading] = useState(false);
  const [showLoadingIndicator, setShowLoadingIndicator] = useState(false);
  const [resolvedContent, setResolvedContent] = useState<Record<string, unknown>>(content);

  hydrationInputRef.current = {
    content,
    encryptedFile,
    isV2ContentJson,
    mxcUri,
  };

  useEffect(() => {
    let cancelled = false;
    const hydrateContent = async () => {
      const {
        content: currentContent,
        encryptedFile: currentEncryptedFile,
        isV2ContentJson: currentIsV2ContentJson,
        mxcUri: currentMxcUri,
      } = hydrationInputRef.current;

      setResolvedContent((currentResolvedContent) =>
        !hydrate || shouldResetResolvedContentToPreview(currentContent, currentResolvedContent)
          ? withMindroomToolTraceFallback(currentContent, currentResolvedContent)
          : currentResolvedContent
      );

      if (!hydrate) {
        setLoading(false);
        return;
      }

      setLoading(true);
      const nextContent = await hydrateMindroomLongTextSource(
        {
          previewContent: currentContent,
          encryptedFile: currentEncryptedFile,
          isV2ContentJson: currentIsV2ContentJson,
          mxcUri: currentMxcUri,
        },
        (source) => downloadMindroomLongTextSidecarText(mx, source, useAuthentication),
        mx
      );

      if (!cancelled) {
        setResolvedContent(nextContent);
        setLoading(false);
      }
    };

    hydrateContent();

    return () => {
      cancelled = true;
    };
  }, [hydrate, hydrationIdentity, mx, useAuthentication]);

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

  const afterBody = renderAfterBody?.(content, resolvedContent);

  let textContent: ReactNode;
  if (kind === MindroomLongTextKind.Emote) {
    textContent = (
      <MEmote
        displayName={displayName ?? ''}
        edited={edited}
        renderStateSuffix={renderStateSuffix}
        content={resolvedContent}
        renderBody={(props) => renderBody(resolvedContent, props)}
        renderAfterBody={afterBody}
        renderUrlsPreview={renderUrlsPreview}
      />
    );
  } else if (kind === MindroomLongTextKind.Notice) {
    textContent = (
      <MNotice
        edited={edited}
        renderStateSuffix={renderStateSuffix}
        content={resolvedContent}
        renderBody={(props) => renderBody(resolvedContent, props)}
        renderAfterBody={afterBody}
        renderUrlsPreview={renderUrlsPreview}
      />
    );
  } else {
    textContent = (
      <MText
        edited={edited}
        renderStateSuffix={renderStateSuffix}
        content={resolvedContent}
        renderBody={(props) => renderBody(resolvedContent, props)}
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
          <FText size="T200">Loading full response...</FText>
        </Box>
      )}
    </>
  );
}
