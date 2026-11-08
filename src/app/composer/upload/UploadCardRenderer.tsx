import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Chip, Icon, IconButton, IconSrc, Icons, Text, color } from 'folds';
import type { MatrixError } from 'matrix-js-sdk';
import { UploadCard, UploadCardCancel, UploadCardError, UploadCardProgress } from './UploadCard';
import * as css from './UploadCard.css';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useMediaConfig } from '../../matrix/hooks/useMediaConfig';
import { useObjectURL } from '../../lib/hooks/useObjectURL';
import {
  type TUploadItem,
  type TUploadMetadata,
  type Upload,
  UploadStatus,
  useBindUploadAtom,
} from '../../matrix/state/upload';
import { roomUploadAtomFamily } from '../roomInputDrafts';
import { getMatrixUploadErrorMessage, toMatrixUploadError } from '../../matrix/matrix';
import { bytesToSize } from '../../lib/common';
import { revealDirectionControls } from '../../ui/directional';

const MEDIA_UPLOAD_SIZE_KEY = 'm.upload.size';

/** The icon for a file by its MIME type. */
export const getFileTypeIcon = (mimeType: string): IconSrc => {
  if (mimeType.startsWith('image/')) return Icons.Photo;
  if (mimeType.startsWith('video/')) return Icons.Vlc;
  if (mimeType.startsWith('audio/')) return Icons.Play;
  return Icons.File;
};

const fileNameOf = (file: { name?: string }): string => file.name ?? '';

/**
 * An error that blocks the upload before it starts: the file is larger than the server accepts.
 * The message names both sizes.
 */
export const getTooLargeError = (
  fileSize: number,
  maxUploadSize: number | undefined
): MatrixError | undefined =>
  maxUploadSize !== undefined && fileSize > maxUploadSize
    ? toMatrixUploadError({ httpStatus: 413, message: 'File too large' }, 'upload')
    : undefined;

type UploadStatusLineProps = {
  upload: Upload;
  blockedError?: MatrixError;
  maxUploadSize?: number;
  onRetry?: () => void;
  /** Text of the retry action. */
  retryLabel?: string;
};

/** Progress, error, or nothing, for the bottom of an upload card. */
export function UploadStatusLine({
  upload,
  blockedError,
  maxUploadSize,
  onRetry,
  retryLabel,
}: UploadStatusLineProps) {
  const error = blockedError ?? (upload.status === UploadStatus.Error ? upload.error : undefined);

  if (error) {
    const message = getMatrixUploadErrorMessage(error, undefined, {
      fileSize: upload.file.size,
      maxUploadSize,
    });
    return (
      <Box alignItems="Center" gap="200" justifyContent="SpaceBetween">
        <UploadCardError>{message}</UploadCardError>
        {!blockedError && onRetry && (
          <Chip type="button" variant="Critical" radii="Pill" onClick={onRetry}>
            <Text as="span" size="B300">
              {retryLabel}
            </Text>
          </Chip>
        )}
      </Box>
    );
  }

  if (upload.status === UploadStatus.Loading) {
    return (
      <UploadCardProgress sentBytes={upload.progress.loaded} totalBytes={upload.progress.total} />
    );
  }

  return null;
}

type UploadHandlers = {
  /** Stores new metadata (such as the spoiler flag) for the item. */
  setMetadata: (item: TUploadItem, metadata: TUploadMetadata) => void;
  onRemove: (file: TUploadItem['file']) => void;
};

// With `isEncrypted`, a file that is not encrypted must never upload.
type UploadCardRendererProps = UploadHandlers & { fileItem: TUploadItem; isEncrypted?: boolean };

/** A staged composer attachment: uploads it at once and shows progress, errors and options. */
export const UploadCardRenderer = ({
  fileItem,
  isEncrypted,
  setMetadata,
  onRemove,
}: UploadCardRendererProps) => {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const maxUploadSize = useMediaConfig()[MEDIA_UPLOAD_SIZE_KEY];
  const { file, originalFile, metadata, encInfo, prepError } = fileItem;

  // Encryption failed or never happened in an encrypted room: refuse to send plaintext.
  const blockUploadError = useMemo(
    () =>
      prepError ??
      (isEncrypted && !encInfo
        ? toMatrixUploadError(new Error('The file was not encrypted.'), 'create')
        : undefined),
    [prepError, isEncrypted, encInfo]
  );
  const tooLargeError = useMemo(
    () => getTooLargeError(file.size, maxUploadSize),
    [file.size, maxUploadSize]
  );

  const blocked = blockUploadError ?? tooLargeError;
  const { upload, startUpload, cancelUpload } = useBindUploadAtom(
    client,
    roomUploadAtomFamily(file),
    {
      // Only the encrypted blob is uploaded without its name; the name travels inside the event.
      hideFilename: encInfo !== undefined,
      // A file over the server's limit fails at once instead of waiting: a send in progress
      // skips failed files and goes on with the rest and the caption.
      blockUploadError: blocked,
    }
  );

  useEffect(() => {
    // A file that could not be prepared already carries its error and must never start.
    if (blockUploadError || upload.status !== UploadStatus.Idle) return;
    void startUpload();
  }, [blockUploadError, upload.status, startUpload]);

  const cancelAndRemove = () => {
    void cancelUpload();
    onRemove(file);
  };

  const mimeType = originalFile.type || file.type;
  // A staged picture shows itself instead of its type icon; the bytes never leave the browser.
  const previewUrl = useObjectURL(
    mimeType.startsWith('image/') && originalFile instanceof Blob ? originalFile : undefined
  );
  // Pictures and videos can be sent as spoilers (MSC4193); other files have no preview to hide.
  const canBeSpoiler = mimeType.startsWith('image/') || mimeType.startsWith('video/');
  // Direction controls in the name show as code points; the upload keeps the name as it is.
  const name = revealDirectionControls(fileNameOf(originalFile) || fileNameOf(file));

  return (
    <UploadCard
      outlined
      before={
        previewUrl ? (
          <img className={css.UploadCardPreview} src={previewUrl} alt="" />
        ) : (
          <Icon src={getFileTypeIcon(mimeType)} />
        )
      }
      after={
        <>
          {upload.status === UploadStatus.Success && (
            <Icon size="100" src={Icons.Check} style={{ color: color.Success.Main }} />
          )}
          {canBeSpoiler && (
            <IconButton
              type="button"
              size="300"
              radii="Pill"
              variant={metadata.markedAsSpoiler ? 'Warning' : 'SurfaceVariant'}
              aria-pressed={metadata.markedAsSpoiler}
              aria-label={t('sharedUi.uploadCardRenderer.spoiler')}
              onClick={() =>
                setMetadata(fileItem, { ...metadata, markedAsSpoiler: !metadata.markedAsSpoiler })
              }
            >
              <Icon src={Icons.EyeBlind} size="50" />
            </IconButton>
          )}
          <UploadCardCancel
            label={t('sharedUi.uploadCardRenderer.cancelUpload')}
            onClick={cancelAndRemove}
          />
        </>
      }
      bottom={
        <UploadStatusLine
          upload={upload}
          blockedError={blocked}
          maxUploadSize={maxUploadSize}
          onRetry={() => void startUpload()}
          retryLabel={t('sharedUi.uploadCardRenderer.retry')}
        />
      }
    >
      <Text size="H6" truncate title={name}>
        {name}
      </Text>
      <Text size="T200" priority="300">
        {bytesToSize(originalFile.size)}
      </Text>
    </UploadCard>
  );
};
