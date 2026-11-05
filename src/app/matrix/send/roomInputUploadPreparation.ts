import type { Room } from 'matrix-js-sdk';
import type { TUploadItem, TUploadMetadata } from '../state/upload';
import { encryptFile, toMatrixUploadError } from '../matrix';

const defaultMetadata = (): TUploadMetadata => ({ markedAsSpoiler: false });

/**
 * Upload items for files staged in a room's composer, in the order given: encrypted for an
 * encrypted room. A file that cannot be prepared keeps its place with a `prepError` (stage
 * `create`), so its upload card can say so instead of the whole batch failing.
 */
export const createRoomUploadItems = (
  files: File[],
  room: Pick<Room, 'hasEncryptionStateEvent'>,
  getMetadata: (file: File, index: number) => TUploadMetadata = defaultMetadata
): Promise<TUploadItem[]> => {
  const encrypted = room.hasEncryptionStateEvent();
  return Promise.all(
    files.map(async (file, index): Promise<TUploadItem> => {
      const metadata = getMetadata(file, index);
      if (!encrypted) return { file, originalFile: file, encInfo: undefined, metadata };
      try {
        const prepared = await encryptFile(file);
        return { ...prepared, metadata };
      } catch (error) {
        return {
          file,
          originalFile: file,
          encInfo: undefined,
          metadata,
          prepError: toMatrixUploadError(error, 'create'),
        };
      }
    })
  );
};
