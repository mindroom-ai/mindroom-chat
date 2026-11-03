import React, { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, IconButton, Icons, Text, color } from 'folds';
import { UploadCard } from './UploadCard';
import { UploadStatusLine, getFileTypeIcon, getTooLargeError } from './UploadCardRenderer';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaConfig } from '../../hooks/useMediaConfig';
import { type TUploadAtom, UploadStatus, useBindUploadAtom } from '../../state/upload';

type CompactUploadCardRendererProps = {
  uploadAtom: TUploadAtom;
  onRemove: () => void;
  /** Called with the mxc URI once the upload finishes. */
  onComplete?: (mxc: string) => void;
  /** Avatars get their own size copy. */
  uploadKind?: 'file' | 'avatar';
};

/** A one-file upload (avatar, room icon): starts at once, then reports the result. */




  uploadKind = 'file',




  const maxUploadSize = mediaConfig['m.upload.size'];
  const { upload, startUpload, cancelUpload } = useBindUploadAtom(mx, uploadAtom);
  const { file } = upload;
  const tooLargeError = useMemo(
    () => getTooLargeError(file.size, maxUploadSize),
    [file.size, maxUploadSize]
  );

  useEffect(() => {
    if (tooLargeError || upload.status !== UploadStatus.Idle) return;
    startUpload();
  }, [tooLargeError, upload.status, startUpload]);

  const mxc = upload.status === UploadStatus.Success ? upload.mxc : undefined;
  useEffect(() => {
    if (mxc) onComplete?.(mxc);
  }, [mxc, onComplete]);

  const handleRemove = () => {
    cancelUpload();
    onRemove();
  };

  const name = file instanceof File ? file.name : (file as { name?: string }).name ?? '';

  return (
    <UploadCard
      compact
      outlined
      before={<Icon src={getFileTypeIcon(file.type)} size="100" />}
      after={
        <>



          <IconButton
            type="button"
            size="300"
            radii="Pill"
            aria-label={t('sharedUi.uploadCard.removeFile', { name })}







        <UploadStatusLine
          upload={upload}
          blockedError={tooLargeError}
          uploadKind={uploadKind}
          maxUploadSize={maxUploadSize}
          onRetry={startUpload}
        />
      }
    >
      <Text size="T300" truncate title={name}>
        {name}
      </Text>
    </UploadCard>
  );
}
