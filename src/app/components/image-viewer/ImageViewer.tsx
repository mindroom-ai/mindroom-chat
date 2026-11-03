import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import { Box, Button, Icon, Icons, Spinner, Text, as } from 'folds';
import { Header, IconButton } from '../glass/GlassPrimitives';
import { useZoom } from '../../hooks/useZoom';
import { usePan } from '../../hooks/usePan';
import { downloadMedia } from '../../utils/matrix';
import { saveFile } from '../../mindroom/native/nativeFileSave';
import { DOWNLOAD_MIME_TYPE } from '../message/attachmentDownload';
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
      await saveFile(new Blob([blobRef.current.blob], { type: DOWNLOAD_MIME_TYPE }), fileName);
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







































































































