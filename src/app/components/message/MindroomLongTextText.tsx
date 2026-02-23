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
import { MindroomLongTextSource, hydrateMindroomLongTextSource } from './mindroomLongText';

export enum MindroomLongTextKind {
  Text = 'text',
  Emote = 'emote',
  Notice = 'notice',
}

type RenderBodyProps = {
  body: string;
  customBody?: string;
};

type MindroomLongTextTextProps = {
  kind: MindroomLongTextKind;
  displayName?: string;
  edited?: boolean;
  content: Record<string, unknown>;
  longTextSource: MindroomLongTextSource;
  renderBody: (content: Record<string, unknown>, props: RenderBodyProps) => ReactNode;
  renderUrlsPreview?: (urls: string[]) => ReactNode;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const getLongTextMimeType = (content: Record<string, unknown>): string => {
  const info = isRecord(content.info) ? content.info : undefined;
  return typeof info?.mimetype === 'string' ? info.mimetype : 'application/json';
};

const downloadSidecarBlob = async (
  source: MindroomLongTextSource,
  textUrl: string
): Promise<Blob> => {
  if (!source.encryptedFile) return downloadMedia(textUrl);

  const mimeType = getLongTextMimeType(source.previewContent);
  return downloadEncryptedMedia(textUrl, (encBuf) =>
    decryptFile(encBuf, mimeType, source.encryptedFile)
  );
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

export function MindroomLongTextText({
  kind,
  displayName,
  edited,
  content,
  longTextSource,
  renderBody,
  renderUrlsPreview,
}: MindroomLongTextTextProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const { encryptedFile, isV2ContentJson, mxcUri } = longTextSource;
  const [loading, setLoading] = useState(false);
  const [resolvedContent, setResolvedContent] = useState<Record<string, unknown>>(content);

  useEffect(() => {
    let cancelled = false;
    const hydrateContent = async () => {
      setLoading(true);
      setResolvedContent(content);

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
  }, [content, encryptedFile, isV2ContentJson, mxcUri, mx, useAuthentication]);

  let textContent: ReactNode;
  if (kind === MindroomLongTextKind.Emote) {
    textContent = (
      <MEmote
        displayName={displayName ?? ''}
        edited={edited}
        content={resolvedContent}
        renderBody={(props) => renderBody(resolvedContent, props)}
        renderUrlsPreview={renderUrlsPreview}
      />
    );
  } else if (kind === MindroomLongTextKind.Notice) {
    textContent = (
      <MNotice
        edited={edited}
        content={resolvedContent}
        renderBody={(props) => renderBody(resolvedContent, props)}
        renderUrlsPreview={renderUrlsPreview}
      />
    );
  } else {
    textContent = (
      <MText
        edited={edited}
        content={resolvedContent}
        renderBody={(props) => renderBody(resolvedContent, props)}
        renderUrlsPreview={renderUrlsPreview}
      />
    );
  }

  return (
    <>
      {textContent}
      {loading && (
        <Box alignItems="Center" gap="100" style={{ marginTop: config.space.S100 }}>
          <Spinner size="100" variant="Secondary" />
          <FText size="T200">Loading full response...</FText>
        </Box>
      )}
    </>
  );
}
