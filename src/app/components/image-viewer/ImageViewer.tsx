import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import { Box, Button, Icon, Icons, Spinner, Text, as } from 'folds';
import { Header, IconButton } from '../glass/GlassPrimitives';
import { useZoom } from '../../hooks/useZoom';
import { usePan } from '../../hooks/usePan';
import { downloadMedia } from '../../utils/matrix';
import { saveFile } from '../../mindroom/native/nativeFileSave';
import * as css from './ImageViewer.css';

const ZOOM_STEP = 0.2;

type DownloadState = 'idle' | 'saving' | 'failed';

/**
 * Downloads `src` once and saves it as `fileName`. A failed save keeps the downloaded blob, so
 * Retry only saves again.
 */
export const useSaveMedia = (src: string, fileName: string) => {
  const [state, setState] = useState<DownloadState>('idle');
  const blobRef = useRef<{ src: string; blob: Blob }>();

  const save = async () => {
    if (state === 'saving') return;
    setState('saving');
    try {
      if (blobRef.current?.src !== src) {
        blobRef.current = { src, blob: await downloadMedia(src) };
      }
      await saveFile(blobRef.current.blob, fileName);
      setState('idle');
    } catch {
      setState('failed');
    }
  };

  return [state, save] as const;
};











    const { zoom, zoomIn, zoomOut, setZoom, zoomTargetRef, isZooming } = useZoom(ZOOM_STEP);
    const {
      pan,
      cursor,
      isPanning,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onLostPointerCapture,
    } = usePan(zoom !== 1);
    const [downloadState, download] = useSaveMedia(src, alt);











            <IconButton
              size="300"
              radii="300"
              onClick={requestClose}














              aria-label={t('sharedUi.imageViewer.zoomOut')}
            >
              <Icon size="50" src={Icons.Minus} />
            </IconButton>
            <Button
              type="button"
              variant={zoom === 1 ? 'Secondary' : 'Success'}
              fill="Soft"
              size="300"
              radii="Pill"
              onClick={() => setZoom(1)}
            >
              <Text as="span" size="B300">{`${Math.round(zoom * 100)}%`}</Text>
            </Button>
            <IconButton
              variant={zoom > 1 ? 'Success' : 'SurfaceVariant'}
              size="300"
              radii="Pill"
              onClick={zoomIn}
              aria-label={t('sharedUi.imageViewer.zoomIn')}
            >
              <Icon size="50" src={Icons.Plus} />
            </IconButton>
            <Button
              type="button"
              variant={failed ? 'Critical' : 'Primary'}
              fill="Solid"
              size="300"
              radii="300"
              disabled={downloadState === 'saving'}
              onClick={download}
              before={
                downloadState === 'saving' ? (
                  <Spinner size="50" variant="Primary" fill="Solid" />
                ) : (
                  <Icon size="50" src={failed ? Icons.Warning : Icons.Download} />
                )
              }
            >
              <Text as="span" size="B300">
                {downloadState === 'saving' && t('sharedUi.imageViewer.saving')}
                {downloadState === 'failed' && t('sharedUi.imageViewer.retryDownload')}
                {downloadState === 'idle' && t('sharedUi.imageViewer.download')}
              </Text>
            </Button>
          </Box>
        </Header>
        <Box
          ref={zoomTargetRef}
          className={css.ImageViewerContent}
          style={{ cursor }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onLostPointerCapture={onLostPointerCapture}
        >
          <img
            className={css.ImageViewerImg}
            data-gesture={isZooming || isPanning}
            style={{
              transform: `translate(${pan.translateX}px, ${pan.translateY}px) scale(${zoom})`,
            }}
            src={src}
            alt={alt}
            draggable={false}
          />
        </Box>
      </Box>
    );
  }
);
