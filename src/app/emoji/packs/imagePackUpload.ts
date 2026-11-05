import type { IImageInfo } from '../../matrix/types/common';
import { type Upload, UploadStatus } from '../../matrix/state/upload';
import { loadImageElement } from '../../lib/dom';
import { getImageInfo } from '../../matrix/matrix';
import { getFileNameWithoutExt } from '../../lib/mimeTypes';

/** An uploaded image, ready to add to an image pack under `shortcode`. */
type ImagePackUploadImage = {
  shortcode: string;
  url: string;
  body: string;
  info: IImageInfo;
};

/** A shortcode from a file name: the name without its extension, spaces and colons replaced. */
const shortcodeFromFileName = (fileName: string): string =>
  getFileNameWithoutExt(fileName).trim().replace(/:/g, '').replace(/\s+/g, '-');

/**
 * Reads what a pack entry needs from a finished upload: its mxc URI, a shortcode from the file
 * name, and the image dimensions. Resolves undefined until the upload has succeeded; the object
 * URL used to measure the image is revoked whether that works or not.
 */
export const readImagePackUpload = async (
  upload: Upload
): Promise<ImagePackUploadImage | undefined> => {
  if (upload.status !== UploadStatus.Success) return undefined;
  const { file, mxc } = upload;
  const fileName = file instanceof File ? file.name : 'image';
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImageElement(objectUrl);
    return {
      shortcode: shortcodeFromFileName(fileName),
      url: mxc,
      // The description other clients show, such as alt text: the name without its extension.
      body: getFileNameWithoutExt(fileName).trim() || fileName,
      info: getImageInfo(img, file),
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};
