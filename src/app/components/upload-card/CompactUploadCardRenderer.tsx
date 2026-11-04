import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Icons, Text, color } from 'folds';
import { UploadCard, UploadCardCancel } from './UploadCard';
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
export function CompactUploadCardRenderer({
  uploadAtom,
  uploadKind = 'file',
  onComplete,
  onRemove,
}: CompactUploadCardRendererProps) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const maxUploadSize = useMediaConfig()['m.upload.size'];
  const { upload, startUpload, cancelUpload } = useBindUploadAtom(client, uploadAtom);
  const { file } = upload;
  const tooLargeError = useMemo(
    () => getTooLargeError(file.size, maxUploadSize),
    [file.size, maxUploadSize]
  );

  useEffect(() => {
    if (tooLargeError || upload.status !== UploadStatus.Idle) return;
    void startUpload();
  }, [tooLargeError, upload.status, startUpload]);

  const mxc = upload.status === UploadStatus.Success ? upload.mxc : undefined;
  useEffect(() => {
    if (mxc) onComplete?.(mxc);
  }, [mxc, onComplete]);

  const handleRemove = () => {
    void cancelUpload();
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
          {upload.status === UploadStatus.Success && (
            <Icon size="100" src={Icons.Check} style={{ color: color.Success.Main }} />
          )}
          <UploadCardCancel
            label={t('sharedUi.compactUploadCardRenderer.cancelUpload')}
            onClick={handleRemove}
          />
        </>
      }
      bottom={
        <UploadStatusLine
          upload={upload}
          blockedError={tooLargeError}
          uploadKind={uploadKind}
          maxUploadSize={maxUploadSize}
          onRetry={() => void startUpload()}
          retryLabel={t('sharedUi.compactUploadCardRenderer.retry')}
        />
      }
    >
      <Text size="T300" truncate title={name}>
        {name}
      </Text>
    </UploadCard>
  );
}
