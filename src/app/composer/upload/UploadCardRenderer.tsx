import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAtomValue, type Atom } from 'jotai';
import { Box, Chip, Icon, IconButton, IconSrc, Icons, Text, color } from 'folds';
import type { MatrixError } from 'matrix-js-sdk';
import {
  UploadCard,
  UploadCardCancel,
  UploadCardCompressionProgress,
  UploadCardError,
  UploadCardProgress,
} from './UploadCard';
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
import { getTooLargeError, MEDIA_UPLOAD_SIZE_KEY } from '../roomInputAttachmentAccess';
import { roomUploadAtomFamily } from '../roomInputDrafts';
import { getMatrixUploadErrorMessage, toMatrixUploadError } from '../../matrix/matrix';
import { bytesToSize } from '../../lib/common';
import { revealDirectionControls } from '../../ui/directional';

/** The icon for a file by its MIME type. */
export const getFileTypeIcon = (mimeType: string): IconSrc => {
  if (mimeType.startsWith('image/')) return Icons.Photo;
  if (mimeType.startsWith('video/')) return Icons.Vlc;
  if (mimeType.startsWith('audio/')) return Icons.Play;
  return Icons.File;
};

const fileNameOf = (file: { name?: string }): string => file.name ?? '';

export { getTooLargeError };

function CompressingProgressLine({
  progressAtom,
  label,
}: {
  progressAtom: Atom<number>;
  label: string;
}) {
  const progress = useAtomValue(progressAtom);
  return <UploadCardCompressionProgress progress={progress} label={label} />;
}

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
  /** Swaps a compressing or compressed attachment back to its original source file. */
  onUseOriginal?: (item: TUploadItem) => void;
  /** Whether the Use original action is allowed (false once enrolled in an active send). */
  canUseOriginal?: boolean;
};

// With `isEncrypted`, a file that is not encrypted must never upload.
type UploadCardRendererProps = UploadHandlers & {
  fileItem: TUploadItem;
  isEncrypted?: boolean;
  /** Starts uploading on mount; false defers encryption and upload until Send (Home). */
  autoUpload?: boolean;
};

/** A staged composer attachment: uploads on mount (unless deferred) and shows progress, errors and options. */
export const UploadCardRenderer = ({
  fileItem,
  isEncrypted,
  autoUpload = true,
  setMetadata,
  onRemove,
  onUseOriginal,
  canUseOriginal = true,
}: UploadCardRendererProps) => {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const maxUploadSize = useMediaConfig()[MEDIA_UPLOAD_SIZE_KEY];
  const { file, originalFile, metadata, encInfo, prepError, compression } = fileItem;
  const isCompressing = compression?.status === 'compressing';

  const compressingError = useMemo(
    () =>
      isCompressing
        ? toMatrixUploadError(new Error('The file is still compressing.'), 'create')
        : undefined,
    [isCompressing]
  );

  // Encryption failed or never happened in an encrypted room: refuse to send plaintext.
  const unencryptedError = useMemo(
    () =>
      !isCompressing && isEncrypted && !encInfo
        ? toMatrixUploadError(new Error('The file was not encrypted.'), 'create')
        : undefined,
    [isCompressing, isEncrypted, encInfo]
  );
  const tooLargeError = useMemo(
    () => (isCompressing ? undefined : getTooLargeError(file.size, maxUploadSize)),
    [isCompressing, file.size, maxUploadSize]
  );

  const bindBlockError = compressingError ?? prepError ?? unencryptedError ?? tooLargeError;
  const { upload, startUpload, cancelUpload } = useBindUploadAtom(
    client,
    roomUploadAtomFamily(file),
    {
      // Only the encrypted blob is uploaded without its name; the name travels inside the event.
      hideFilename: encInfo !== undefined,
      // A file over the server's limit fails at once instead of waiting: a send in progress
      // skips failed files and goes on with the rest and the caption.
      blockUploadError: bindBlockError,
    }
  );

  // Deferred uploads stay unencrypted while Idle until Send commits to the destination room.
  const blockUploadError =
    prepError ??
    (autoUpload || upload.status === UploadStatus.Loading || upload.status === UploadStatus.Success
      ? unencryptedError
      : undefined);
  const blocked = blockUploadError ?? tooLargeError;

  useEffect(() => {
    // Compressing placeholders and files that could not be prepared must never auto-upload.
    if (!autoUpload || isCompressing || blockUploadError || upload.status !== UploadStatus.Idle) {
      return;
    }
    void startUpload();
  }, [autoUpload, isCompressing, blockUploadError, upload.status, startUpload]);

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
  const showUseOriginal =
    onUseOriginal !== undefined &&
    canUseOriginal &&
    !prepError &&
    (isCompressing || compression?.status === 'compressed');

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
          {!isCompressing && upload.status === UploadStatus.Success && (
            <Icon size="100" src={Icons.Check} style={{ color: color.Success.Main }} />
          )}
          {showUseOriginal && (
            <Chip
              type="button"
              variant="SurfaceVariant"
              radii="Pill"
              style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
              onClick={() => onUseOriginal(fileItem)}
            >
              <Text as="span" size="B300">
                {t('sharedUi.uploadCardRenderer.useOriginal')}
              </Text>
            </Chip>
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
        compression?.status === 'compressing' ? (
          <CompressingProgressLine
            progressAtom={compression.progressAtom}
            label={t('sharedUi.uploadCardRenderer.compressing')}
          />
        ) : (
          <UploadStatusLine
            upload={upload}
            blockedError={blocked}
            maxUploadSize={maxUploadSize}
            onRetry={autoUpload ? () => void startUpload() : undefined}
            retryLabel={t('sharedUi.uploadCardRenderer.retry')}
          />
        )
      }
    >
      <Text size="H6" truncate title={name}>
        {name}
      </Text>
      <Text size="T200" priority="300">
        {compression?.status === 'compressed'
          ? t('sharedUi.uploadCardRenderer.compressedSize', {
              originalSize: bytesToSize(compression.originalSize),
              compressedSize: bytesToSize(originalFile.size),
            })
          : bytesToSize(originalFile.size)}
      </Text>
    </UploadCard>
  );
};
