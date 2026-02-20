import React, { ReactNode, useEffect, useMemo, useState } from 'react';
import { Box, Spinner, Text, config } from 'folds';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { downloadMedia, mxcUrlToHttp } from '../../utils/matrix';
import { MEmote, MNotice, MText } from './MsgTypeRenderers';
import { resolveMindroomLongTextContent } from './mindroomLongText';

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
  longTextMxcUri: string;
  renderBody: (props: { body: string; customBody?: string }) => ReactNode;
  renderUrlsPreview?: (urls: string[]) => ReactNode;
};

export function MindroomLongTextText({
  kind,
  displayName,
  edited,
  content,
  longTextMxcUri,
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
      const textUrl = mxcUrlToHttp(mx, longTextMxcUri, useAuthentication);
      if (!textUrl) return;
      setLoading(true);
      try {
        const blob = await downloadMedia(textUrl);
        const text = await blob.text();
        if (!cancelled) {
          setFullText(text);
        }
      } catch {
        // Keep preview content when full-text fetch fails.
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
  }, [mx, longTextMxcUri, useAuthentication]);

  const resolvedContent = useMemo(() => {
    return resolveMindroomLongTextContent(content, fullText);
  }, [content, fullText]);

  const textContent =
    kind === MindroomLongTextKind.Emote ? (
      <MEmote
        displayName={displayName ?? ''}
        edited={edited}
        content={resolvedContent}
        renderBody={renderBody}
        renderUrlsPreview={renderUrlsPreview}
      />
    ) : kind === MindroomLongTextKind.Notice ? (
      <MNotice
        edited={edited}
        content={resolvedContent}
        renderBody={renderBody}
        renderUrlsPreview={renderUrlsPreview}
      />
    ) : (
      <MText
        edited={edited}
        content={resolvedContent}
        renderBody={renderBody}
        renderUrlsPreview={renderUrlsPreview}
      />
    );

  return (
    <>
      {textContent}
      {loading && (
        <Box alignItems="Center" gap="100" style={{ marginTop: config.space.S100 }}>
          <Spinner size="100" variant="Secondary" />
          <Text size="T200">Loading full response...</Text>
        </Box>
      )}
    </>
  );
}
