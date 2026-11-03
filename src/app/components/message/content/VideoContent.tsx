import React, { ReactNode, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import { Box, Button, Icon, Icons, Spinner, Text } from 'folds';
import type { IVideoInfo } from '../../../../types/matrix/common';
import type { EventAttachmentOwner } from '../../../mindroom/messages/eventAttachments';
import { getBlobSafeMimeType } from '../../../utils/mimeTypes';
import { useAttachmentAction } from '../attachmentDownload';

export type RenderVideoProps = {
  src: string;
  title: string;
  autoPlay: boolean;
  controls: boolean;
};

type VideoContentProps = {
  body: string;
  mimeType: string;
  url: string;
  /** Dimensions and duration, for callers that size the player box. */
  info?: IVideoInfo;
  encInfo?: EncryptedAttachmentInfo;
  owner?: EventAttachmentOwner;
  /** Load the video right away instead of on a click. */



};

/** An `m.video` attachment: a thumbnail until the video is loaded, then the player. */
export function VideoContent({
  body,
  mimeType,
  url,
  encInfo,
  owner,
  autoPlay = false,
  renderThumbnail,
  renderVideo,
}: VideoContentProps) {
  const { t } = useTranslation();
  const [src, setSrc] = useState<string>();
  const [playRequested, setPlayRequested] = useState(false);
  const toUrl = useCallback(
    async (blob: Blob) =>
      URL.createObjectURL(new Blob([blob], { type: getBlobSafeMimeType(mimeType) })),
    [mimeType]
  );
  const [status, load] = useAttachmentAction({ owner, url, mimeType, encInfo }, toUrl);

  const start = useCallback(() => {
    load().then(
      (objectUrl) => {
        if (objectUrl) setSrc(objectUrl);
      },
      () => undefined
    );
  }, [load]);

  useEffect(() => {
    if (autoPlay) start();
  }, [autoPlay, start]);

  useEffect(
    () => () => {
      if (src) URL.revokeObjectURL(src);
    },
    [src]
  );

  if (src) return <>{renderVideo({ src, title: body, autoPlay: playRequested, controls: true })}</>;

  return (
    <Box
      alignItems="Center"
      justifyContent="Center"
      style={{ position: 'relative', width: '100%', height: '100%', minHeight: '8rem' }}
    >
      {renderThumbnail?.()}
      <Box style={{ position: 'absolute' }} direction="Column" alignItems="Center" gap="200">
        {status === 'loading' ? (
          <Spinner variant="Secondary" size="400" />
        ) : (
          <Button
            variant={status === 'error' ? 'Critical' : 'Secondary'}
            fill="Solid"
            radii="300"
            size="300"
            before={
              <Icon size="100" src={status === 'error' ? Icons.Warning : Icons.Play} filled />
            }
            onClick={() => {
              setPlayRequested(true);
              start();
            }}
          >
            <Text size="B300">
              {status === 'error'
                ? t('sharedUi.videoContent.retry')
                : t('sharedUi.videoContent.watch')}
            </Text>
          </Button>
        )}
      </Box>
    </Box>
  );
}
