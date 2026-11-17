import type { MatrixClient } from 'matrix-js-sdk';
import type { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import type { EventAttachmentOwner } from '../../matrix/protocol/eventAttachments';
import { downloadCachedAttachment } from '../../event-store/cache/attachmentRepository';
import { FALLBACK_MIMETYPE, getBlobSafeMimeType } from '../../lib/mimeTypes';

type ImageFile = {
  url: string;
  mimeType?: string;
  encInfo?: EncryptedAttachmentInfo;
  owner?: EventAttachmentOwner;
};

/**
 * Loads an `m.image` attachment's original picture through the attachment cache, under the
 * event that owns it, and returns a blob URL the caller revokes.
 */
export const loadImageOriginal = async (
  mx: MatrixClient,
  { url, mimeType, encInfo, owner }: ImageFile
): Promise<string> => {
  const blob = await downloadCachedAttachment(mx, {
    owner,
    mxcUri: url,
    encryptedFile: encInfo ? { ...encInfo, url } : undefined,
    // A type the browser would run (SVG) is loaded as plain bytes instead.
    mimeType: getBlobSafeMimeType(mimeType ?? FALLBACK_MIMETYPE),
  });
  return URL.createObjectURL(blob);
};
