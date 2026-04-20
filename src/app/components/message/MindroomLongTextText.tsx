import React, { ReactNode, useEffect, useState } from 'react';
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
import { MEmote, MNotice, MText } from './MsgTypeRenderers';
import {
  MindroomLongTextSource,
  getCachedMindroomLongTextContent,
  hydrateMindroomLongTextSource,
} from './mindroomLongText';

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
  isStreaming?: boolean;
  content: Record<string, unknown>;
  longTextSource: MindroomLongTextSource;
  renderBody: (content: Record<string, unknown>, props: RenderBodyProps) => ReactNode;
  renderUrlsPreview?: (urls: string[]) => ReactNode;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const getStringValue = (
  record: Record<string, unknown>,
  key: string
): string | undefined => {
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
  const [resolvedEntry, setResolvedEntry] = useState<
    { mxcUri: string; content: Record<string, unknown> } | undefined
  >(() => {
    if (!source) return undefined;
    const cachedContent = getCachedMindroomLongTextContent(source);
    return cachedContent ? { mxcUri: source.mxcUri, content: cachedContent } : undefined;
  });

  useEffect(() => {
    if (!source) {
      setResolvedEntry(undefined);
      return undefined;
    }

    const cachedContent = getCachedMindroomLongTextContent(source);
    if (cachedContent) {
      setResolvedEntry({ mxcUri: source.mxcUri, content: cachedContent });
      return undefined;
    }

    if (!enabled) {
      return undefined;
    }

    let cancelled = false;

    void (async () => {
      const nextContent = await hydrateMindroomLongTextSource(source, (nextSource) =>
        downloadMindroomLongTextSidecarText(mx, nextSource, useAuthentication)
      );

      if (!cancelled) {
        setResolvedEntry({ mxcUri: source.mxcUri, content: nextContent });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, mx, source, source?.mxcUri, useAuthentication]);

  if (source && resolvedEntry?.mxcUri === source.mxcUri) {
    return resolvedEntry.content;
  }

  return source ? getCachedMindroomLongTextContent(source) : undefined;
};

export function MindroomLongTextText({
  kind,
  displayName,
  edited,
  isStreaming,
  content,
  longTextSource,
  renderBody,
  renderUrlsPreview,
}: MindroomLongTextTextProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const { encryptedFile, isV2ContentJson, mxcUri } = longTextSource;
  const hydrationIdentity = getMindroomLongTextHydrationIdentity(content, longTextSource);
  const [loading, setLoading] = useState(false);
  const [showLoadingIndicator, setShowLoadingIndicator] = useState(false);
  const [resolvedContent, setResolvedContent] = useState<Record<string, unknown>>(content);

  useEffect(() => {
    let cancelled = false;
    const hydrateContent = async () => {
      setLoading(true);
      setResolvedContent((currentResolvedContent) =>
        shouldResetResolvedContentToPreview(content, currentResolvedContent)
          ? content
          : currentResolvedContent
      );

      const nextContent = await hydrateMindroomLongTextSource(
        {
          previewContent: content,
          encryptedFile,
          isV2ContentJson,
          mxcUri,
        },
        (source) => downloadMindroomLongTextSidecarText(mx, source, useAuthentication)
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
  }, [hydrationIdentity, mx, useAuthentication]);

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

  let textContent: ReactNode;
  if (kind === MindroomLongTextKind.Emote) {
    textContent = (
      <MEmote
        displayName={displayName ?? ''}
        edited={edited}
        isStreaming={isStreaming}
        content={resolvedContent}
        renderBody={(props) => renderBody(resolvedContent, props)}
        renderUrlsPreview={renderUrlsPreview}
      />
    );
  } else if (kind === MindroomLongTextKind.Notice) {
    textContent = (
      <MNotice
        edited={edited}
        isStreaming={isStreaming}
        content={resolvedContent}
        renderBody={(props) => renderBody(resolvedContent, props)}
        renderUrlsPreview={renderUrlsPreview}
      />
    );
  } else {
    textContent = (
      <MText
        edited={edited}
        isStreaming={isStreaming}
        content={resolvedContent}
        renderBody={(props) => renderBody(resolvedContent, props)}
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
