import React, { ReactNode, useEffect, useMemo, useState } from 'react';
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
import { MindroomLongTextSource, resolveMindroomLongTextContent } from './mindroomLongText';

export enum MindroomLongTextKind {
  Text = 'text',
  Emote = 'emote',
  Notice = 'notice',
}

type MindroomLongTextTextProps = {
  kind: MindroomLongTextKind;
  displayName?: string;
  edited?: boolean;
  content: Record<string, unknown>;
  longTextSource: MindroomLongTextSource;
  renderBody: (props: { body: string; customBody?: string }) => ReactNode;
  renderUrlsPreview?: (urls: string[]) => ReactNode;
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
  const [loading, setLoading] = useState(false);
  const [fullText, setFullText] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    const fetchFullText = async () => {
      const textUrl = mxcUrlToHttp(mx, longTextSource.mxcUri, useAuthentication);
      if (!textUrl) return;
      setLoading(true);
      try {
        const mimeType =
          longTextSource.mimeType ?? (longTextSource.isHtml ? 'text/html' : 'text/plain');
        const encryptedInfo = longTextSource.encInfo;
        const blob = encryptedInfo
          ? await downloadEncryptedMedia(textUrl, (encBuf) =>
              decryptFile(encBuf, mimeType, encryptedInfo)
            )
          : await downloadMedia(textUrl);
        const text = await blob.text();
        if (!cancelled) {
          setFullText(text);
        }
      } catch (error) {
        // Keep preview content when full-text fetch fails.
        // eslint-disable-next-line no-console
        console.warn('MindRoom long-text fetch/decrypt failed', {
          mxcUri: longTextSource.mxcUri,
          error,
        });
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchFullText();

    return () => {
      cancelled = true;
    };
  }, [
    mx,
    longTextSource.mxcUri,
    longTextSource.encInfo,
    longTextSource.mimeType,
    longTextSource.isHtml,
    useAuthentication,
  ]);

  const resolvedContent = useMemo(
    () => resolveMindroomLongTextContent(content, fullText, { isHtml: longTextSource.isHtml }),
    [content, fullText, longTextSource.isHtml]
  );

  let textContent: ReactNode;
  if (kind === MindroomLongTextKind.Emote) {
    textContent = (
      <MEmote
        displayName={displayName ?? ''}
        edited={edited}
        content={resolvedContent}
        renderBody={renderBody}
        renderUrlsPreview={renderUrlsPreview}
      />
    );
  } else if (kind === MindroomLongTextKind.Notice) {
    textContent = (
      <MNotice
        edited={edited}
        content={resolvedContent}
        renderBody={renderBody}
        renderUrlsPreview={renderUrlsPreview}
      />
    );
  } else {
    textContent = (
      <MText
        edited={edited}
        content={resolvedContent}
        renderBody={renderBody}
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
