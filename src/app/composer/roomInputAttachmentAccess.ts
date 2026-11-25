import type { IContent, MatrixError, Room } from 'matrix-js-sdk';
import { createPasteMarker } from '../matrix/protocol/pasteAttachmentMarker';
import { UploadStatus, type TUploadItem, type Upload } from '../matrix/state/upload';
import { toMatrixUploadError, type TUploadContent } from '../matrix/matrix';

export const MEDIA_UPLOAD_SIZE_KEY = 'm.upload.size' as const;

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
    (item) =>
      item.compression?.status === 'compressing' ||
      (!item.prepError && uploadByFile.get(item.file)?.status !== UploadStatus.Error)
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

/** Whether `textContent` references a large-paste marker belonging to any item in `items`. */
export const hasPasteMarkerInText = (
  textContent: IContent | undefined,
  items: readonly TUploadItem[]
): boolean => {
  if (!textContent) return false;
  const textValues = [textContent.body, textContent.formatted_body].filter(
    (value): value is string => typeof value === 'string'
  );
  if (textValues.length === 0) return false;

  return items.some((item) => {
    const paste = item.metadata.mindroomPasteAttachment;
    if (!paste) return false;
    let marker: string;
    try {
      marker = createPasteMarker({
        id: paste.id,
        chars: paste.chars,
        fileName: paste.fileName,
      });
    } catch {
      return false;
    }
    return textValues.some((text) => text.includes(marker));
  });
};

/**
 * Whether `textContent` references a large-paste marker whose file was in `batchItems` (staged
 * or prepared for this send) but is not among `uploadedItems` ready to send.
 */
export const hasMissingPasteAttachmentForText = (
  textContent: IContent | undefined,
  batchItems: readonly TUploadItem[],
  uploadedItems: readonly TUploadItem[]
): boolean => {
  const uploadedPasteFiles = new Set(
    uploadedItems
      .filter((item) => !item.prepError)
      .map((item) => item.metadata.mindroomPasteAttachment?.fileName)
      .filter((name): name is string => name !== undefined)
  );
  return hasPasteMarkerInText(
    textContent,
    batchItems.filter((item) => {
      const fileName = item.metadata.mindroomPasteAttachment?.fileName;
      return fileName !== undefined && !uploadedPasteFiles.has(fileName);
    })
  );
};

export type DeferredAttachmentSendResult = {
  aborted: boolean;
  prepared: TUploadItem[];
  uploadedItems: TUploadItem[];
  missingPasteMarker: boolean;
};

/**
 * Commits deferred staged attachments for `room` at Send time: prepares/encrypts them, uploads
 * each prepared item in parallel, and checks whether `textContent` still references any paste
 * marker whose attachment failed preparation or upload.
 */
export const prepareAndUploadDeferredAttachments = async ({
  room,
  items,
  batchItems,
  textContent,
  prepareForSend,
  uploadItem,
  onPrepared,
  isAborted,
}: {
  room: Room;
  items?: TUploadItem[];
  batchItems: readonly TUploadItem[];
  textContent: IContent | undefined;
  prepareForSend: (room: Room, items?: TUploadItem[]) => Promise<TUploadItem[]>;
  uploadItem?: (item: TUploadItem) => Promise<TUploadItem | undefined>;
  onPrepared?: (prepared: TUploadItem[]) => void;
  isAborted?: () => boolean;
}): Promise<DeferredAttachmentSendResult> => {
  const prepared = await prepareForSend(room, items);
  onPrepared?.(prepared);
  if (isAborted?.()) {
    return { aborted: true, prepared, uploadedItems: [], missingPasteMarker: false };
  }
  const uploaded = uploadItem
    ? await Promise.all(prepared.map((item) => uploadItem(item)))
    : prepared;
  const uploadedItems = uploaded.filter(
    (item): item is TUploadItem => item !== undefined && !item.prepError
  );
  if (isAborted?.()) {
    return { aborted: true, prepared, uploadedItems, missingPasteMarker: false };
  }
  const missingPasteMarker = hasMissingPasteAttachmentForText(
    textContent,
    [...batchItems, ...prepared],
    uploadedItems
  );
  return { aborted: false, prepared, uploadedItems, missingPasteMarker };
};
