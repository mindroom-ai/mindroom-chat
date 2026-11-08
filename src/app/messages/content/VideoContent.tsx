import { CSSProperties, ReactNode, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import { Box, Button, Chip, Icon, Icons, Spinner, Text } from 'folds';
import { revealDirectionControls } from '../../ui/directional';
import type { IVideoInfo } from '../../matrix/types/common';
import type { EventAttachmentOwner } from '../../matrix/protocol/eventAttachments';
import { getBlobSafeMimeType } from '../../lib/mimeTypes';
import { useAttachmentObjectUrl } from './attachmentDownload';
import { BlurHash, getInfoBlurHash } from '../../ui/media/BlurHash';

type RenderVideoProps = {
  src: string;
  title: string;
  autoPlay: boolean;
  controls: boolean;
};

/** Draws the player once the video is loaded. */
type RenderVideo = (props: RenderVideoProps) => ReactNode;

type VideoContentProps = {
  body: string;
  mimeType: string;
  url: string;
  /** The sender marked it as a spoiler: the preview stays blurred and nothing loads until revealed. */
  markedAsSpoiler?: boolean;
  /** Dimensions and duration, for callers that size the player box. */
  info?: IVideoInfo;
  encInfo?: EncryptedAttachmentInfo;
  owner?: EventAttachmentOwner;
  /** Load the video right away instead of on a click. */
  autoPlay?: boolean;
  /** Shown behind the Watch button and the spinner until the video is ready. */
  renderThumbnail?: () => ReactNode;
  renderVideo: RenderVideo;
};

/** The thumbnail and BlurHash under the controls; a spoiler keeps them blurred. */
const previewLayerStyle = (revealed: boolean): CSSProperties => ({
  position: 'absolute',
  inset: 0,
  overflow: 'hidden',
  filter: revealed ? undefined : 'blur(44px)',
});

/** An `m.video` attachment: a thumbnail until the video is loaded, then the player. */
export function VideoContent({
  body,
  mimeType,
  url,
  info,
  encInfo,
  owner,
  autoPlay = false,
  markedAsSpoiler = false,
  renderThumbnail,
  renderVideo,
}: VideoContentProps) {
  const { t } = useTranslation();
  const [playRequested, setPlayRequested] = useState(false);
  const [revealed, setRevealed] = useState(!markedAsSpoiler);
  const toUrl = useCallback(
    async (blob: Blob) =>
      URL.createObjectURL(new Blob([blob], { type: getBlobSafeMimeType(mimeType) })),
    [mimeType]
  );
  const {
    status,
    src,
    load: start,
  } = useAttachmentObjectUrl({ owner, url, mimeType, encInfo }, toUrl);

  useEffect(() => {
    if (autoPlay && revealed) start();
  }, [autoPlay, revealed, start]);

  const blurHash = getInfoBlurHash(info);

  if (src && revealed)
    return (
      <>
        {renderVideo({
          src,
          title: revealDirectionControls(body),
          autoPlay: playRequested,
          controls: true,
        })}
      </>
    );

  return (
    <Box
      alignItems="Center"
      justifyContent="Center"
      style={{ position: 'relative', width: '100%', height: '100%', minHeight: '8rem' }}
    >
      <div style={previewLayerStyle(revealed)}>
        {blurHash && <BlurHash hash={blurHash} />}
        {renderThumbnail?.()}
      </div>
      <Box style={{ position: 'absolute' }} direction="Column" alignItems="Center" gap="200">
        {!revealed && (
          <Chip variant="Secondary" radii="Pill" onClick={() => setRevealed(true)}>
            <Text size="B300">{t('sharedUi.videoContent.spoiler')}</Text>
          </Chip>
        )}
        {revealed && status === 'loading' && <Spinner variant="Secondary" size="400" />}
        {revealed && status !== 'loading' && (
          <Button
            variant={status === 'error' ? 'Critical' : 'Secondary'}
            fill="Solid"
            radii="300"
            size="300"
            title={status === 'error' ? t('sharedUi.videoContent.failedToLoadVideo') : undefined}
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
