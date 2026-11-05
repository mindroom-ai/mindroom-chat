import { MatrixClient } from 'matrix-js-sdk';
import { IEncryptedFile } from '../../matrix/types/common';
import {
  downloadCachedAttachment,
  type CachedAttachmentDownloadOptions,
} from './attachmentRepository';

export const downloadSidecarBlob = async (
  mx: MatrixClient,
  source: { mxcUri: string; encryptedFile?: IEncryptedFile },
  mimeType = 'application/json',
  options: CachedAttachmentDownloadOptions = {}
): Promise<Blob> => {
  return downloadCachedAttachment(mx, { ...source, mimeType }, options);
};
