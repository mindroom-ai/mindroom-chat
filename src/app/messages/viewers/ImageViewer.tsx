import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import { Box, Button, Icon, Icons, Spinner, Text, as } from 'folds';
import { Header, IconButton } from '../../ui/glass/GlassPrimitives';
import { useZoom } from '../../lib/hooks/useZoom';
import { usePan } from '../../lib/hooks/usePan';
import { downloadMedia } from '../../matrix/matrix';
import { saveFile } from '../../native/nativeFileSave';
import { DOWNLOAD_MIME_TYPE } from '../content/attachmentDownload';
import { revealDirectionControls } from '../../ui/directional';
import { PINCH_SURFACE_ATTRIBUTE } from '../../theme/usePinchToZoom';
import * as css from './ImageViewer.css';

const ZOOM_STEP = 0.2;
const PINCH_SURFACE = { [PINCH_SURFACE_ATTRIBUTE]: '' };
// The zoom percentage switches between fitting the image and this closer look.
const CLOSE_LOOK_ZOOM = 2;

type DownloadState = 'idle' | 'saving' | 'failed';

/**
 * Downloads `src` once and saves it as `fileName`. A failed save keeps the downloaded blob, so
 * Retry only saves again.
 */
const useSaveMedia = (src: string, fileName: string) => {
  const [state, setState] = useState<DownloadState>('idle');
  const blobRef = useRef<{ src: string; blob: Blob }>();

  const save = async () => {
    if (state === 'saving') return;
    setState('saving');
    try {
      if (blobRef.current?.src !== src) {
        blobRef.current = { src, blob: await downloadMedia(src) };
      }
      await saveFile(new Blob([blobRef.current.blob], { type: DOWNLOAD_MIME_TYPE }), fileName);
      setState('idle');
    } catch {
      setState('failed');
    }
  };

  return [state, save] as const;
};

type ImageViewerProps = {
  alt: string;
  src: string;
  requestClose: () => void;
};

const DOWNLOAD_LABEL_KEY = {
  idle: 'sharedUi.imageViewer.download',
  saving: 'sharedUi.imageViewer.saving',
  failed: 'sharedUi.imageViewer.retryDownload',
} as const satisfies Record<DownloadState, string>;

/** Highlights a zoom control while the image is zoomed in its direction. */
const zoomTone = (active: boolean): 'Success' | 'Surface' => (active ? 'Success' : 'Surface');

/** Shows an image full size with zoom, pan, and a download that can be retried. */
export const ImageViewer = as<'div', ImageViewerProps>(
  ({ requestClose, alt, src, className, ...props }, ref) => {
    const { t } = useTranslation();
    const [downloadState, download] = useSaveMedia(src, alt);
    // The name shows its direction controls; the download keeps it as it is.
    const shownAlt = revealDirectionControls(alt);
    const { zoom, zoomIn, zoomOut, setZoom, zoomTargetRef, isZooming } = useZoom(ZOOM_STEP);
    const panning = usePan(zoom !== 1);
    const { pan, cursor, isPanning } = panning;
    const saving = downloadState === 'saving';

    let downloadIcon = <Icon size="50" src={Icons.Download} />;
    if (saving) downloadIcon = <Spinner size="50" variant="Primary" fill="Solid" />;
    else if (downloadState === 'failed') downloadIcon = <Icon size="50" src={Icons.Warning} />;

    const imageTransform = `translate(${pan.translateX}px, ${pan.translateY}px) scale(${zoom})`;

    // The viewer pinches its own picture, so the page zoom leaves pinches over it alone
    // (theme/usePinchToZoom.ts); the e2e media spec finds the viewer by `data-image-viewer`.
    return (
      <Box
        {...PINCH_SURFACE}
        data-image-viewer="true"
        direction="Column"
        className={classNames(css.ImageViewer, className)}
        {...props}
        ref={ref}
      >
        <Header size="400" className={css.ImageViewerHeader}>
          <IconButton
            aria-label={t('sharedUi.imageViewer.close')}
            onClick={requestClose}
            radii="300"
            size="300"
          >
            <Icon src={Icons.ArrowLeft} size="50" data-directional />
          </IconButton>
          <Box grow="Yes" style={{ minWidth: 0 }}>
            <Text truncate size="T300">
              {shownAlt}
            </Text>
          </Box>
          <Box alignItems="Center" shrink="No" gap="200">
            <IconButton
              aria-label={t('sharedUi.imageViewer.zoomOut')}
              onClick={zoomOut}
              variant={zoomTone(zoom < 1)}
              radii="Pill"
              size="300"
            >
              <Icon src={Icons.Minus} size="50" />
            </IconButton>
            <Button
              type="button"
              onClick={() => setZoom(zoom === 1 ? CLOSE_LOOK_ZOOM : 1)}
              variant={zoom === 1 ? 'Secondary' : 'Success'}
              fill="Soft"
              radii="Pill"
              size="300"
            >
              <Text as="span" size="B300">{`${Math.round(zoom * 100)}%`}</Text>
            </Button>
            <IconButton
              aria-label={t('sharedUi.imageViewer.zoomIn')}
              onClick={zoomIn}
              variant={zoomTone(zoom > 1)}
              radii="Pill"
              size="300"
            >
              <Icon src={Icons.Plus} size="50" />
            </IconButton>
            <Button
              type="button"
              before={downloadIcon}
              disabled={saving}
              onClick={() => void download()}
              variant={downloadState === 'failed' ? 'Critical' : 'Primary'}
              fill="Solid"
              radii="300"
              size="300"
            >
              <Text as="span" size="B300">
                {t(DOWNLOAD_LABEL_KEY[downloadState])}
              </Text>
            </Button>
          </Box>
        </Header>
        <Box
          ref={zoomTargetRef}
          className={css.ImageViewerContent}
          style={{ cursor }}
          onPointerDown={panning.onPointerDown}
          onPointerMove={panning.onPointerMove}
          onPointerUp={panning.onPointerUp}
          onPointerCancel={panning.onPointerCancel}
          onLostPointerCapture={panning.onLostPointerCapture}
        >
          <img
            className={css.ImageViewerImg}
            data-gesture={isZooming || isPanning}
            style={{ transform: imageTransform }}
            src={src}
            alt={shownAlt}
            draggable={false}
          />
        </Box>
      </Box>
    );
  }
);
