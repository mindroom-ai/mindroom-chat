import { ReactNode, useEffect, useState } from 'react';
import type { IThumbnailContent } from '../../../../types/matrix/common';
import type { EventAttachmentOwner } from '../../../mindroom/messages/eventAttachments';
import { downloadCachedAttachment } from '../../../mindroom/messages/attachmentRepository';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { FALLBACK_MIMETYPE, getBlobSafeMimeType } from '../../../utils/mimeTypes';

type ThumbnailContentProps = {
  info: IThumbnailContent;
  owner?: EventAttachmentOwner;
  renderImage: (src: string) => ReactNode;
};

/**
 * Loads a media thumbnail (plain or encrypted) through the attachment cache and renders it
 * from a blob URL this component owns. Types a browser should not run, such as SVG, load as
 * untyped bytes.
 */
export function ThumbnailContent({ info, owner, renderImage }: ThumbnailContentProps) {
  const mx = useMatrixClient();
  const [src, setSrc] = useState<string>();
  const encryptedFile = info.thumbnail_file;
  const mxcUri = encryptedFile?.url ?? info.thumbnail_url;
  const declaredType = info.thumbnail_info?.mimetype;
  const mimeType = declaredType ? getBlobSafeMimeType(declaredType) : FALLBACK_MIMETYPE;
  const ownerKey = owner ? `${owner.roomId}|${owner.eventId}|${owner.revisionTs}` : '';

  useEffect(() => {
    if (!mxcUri) return undefined;
    let active = true;
    let objectUrl: string | undefined;
    downloadCachedAttachment(mx, { owner, mxcUri, mimeType, encryptedFile }).then(
      (blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (active) setSrc(objectUrl);
        else URL.revokeObjectURL(objectUrl);
      },
      () => undefined
    );
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setSrc(undefined);
    };
    // The owner is identified by its key; a new object for the same event changes nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mx, mxcUri, mimeType, encryptedFile, ownerKey]);

  return src ? renderImage(src) : null;
}
