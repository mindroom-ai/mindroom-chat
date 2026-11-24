import type { MatrixError } from 'matrix-js-sdk';
import { UploadStatus, type TUploadItem, type Upload } from '../matrix/state/upload';
import { toMatrixUploadError, type TUploadContent } from '../matrix/matrix';

/**
 * An error that blocks the upload before it starts: the file is larger than the server accepts.
 * The message names both sizes.
 */
export const MEDIA_UPLOAD_SIZE_KEY = 'm.upload.size' as const;

export const getTooLargeError = (
  fileSize: number,
  maxUploadSize: number | undefined
): MatrixError | undefined =>
  maxUploadSize !== undefined && fileSize > maxUploadSize
    ? toMatrixUploadError({ httpStatus: 413, message: 'File too large' }, 'upload')
    : undefined;

export type AttachmentSnapshot = {
  staged: TUploadItem[];
  enrolled: TUploadItem[];
  uploads: Upload[];
};

/** Whether a composer attachment snapshot holds at least one file without a prep or upload error. */
export const hasSendableStagedFiles = ({
  staged,
  uploads,
}: Pick<AttachmentSnapshot, 'staged' | 'uploads'>): boolean => {
  if (staged.length === 0) return false;
  const uploadByFile = new Map(uploads.map((upload) => [upload.file, upload]));
  return staged.some(
    (item) => !item.prepError && uploadByFile.get(item.file)?.status !== UploadStatus.Error
  );
};

export type RoomInputAttachmentAccess = {
  /** Without a room, returns the active composer; explicit rooms include all staged drafts. */
  snapshot: (roomId?: string) => AttachmentSnapshot;
  append: (roomId: string, items: TUploadItem[]) => void;
  remove: (roomId: string, files: TUploadContent[]) => void;
  /** Takes files off the board without cancelling their uploads: another composer took them. */
  release: (roomId: string, files: TUploadContent[]) => void;
  enroll: (items: TUploadItem[]) => void;
  /** Releases the files a send session claimed with `enroll`. */
  clearEnrollment: (files: TUploadContent[]) => void;
  protectPasteItems: (items: TUploadItem[]) => () => void;
  subscribe: (listener: () => void) => () => void;
};
