import { ReactNode, useEffect, useRef, useState } from 'react';
import type { IThumbnailContent } from '../../matrix/types/common';
import type { EventAttachmentOwner } from '../../matrix/protocol/eventAttachments';
import { downloadCachedAttachment } from '../../event-store/cache/attachmentRepository';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { FALLBACK_MIMETYPE, getBlobSafeMimeType } from '../../lib/mimeTypes';

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
  // Callers rebuild the owner and file objects on each render; the load follows what they
  // identify (the event revision and the file), not their identity.
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const fileRef = useRef(encryptedFile);
  fileRef.current = encryptedFile;
  const ownerKey = owner ? `${owner.roomId}|${owner.eventId}|${owner.revisionTs}` : '';
  const fileKey = encryptedFile ? `${encryptedFile.iv}|${encryptedFile.hashes?.sha256 ?? ''}` : '';

  useEffect(() => {
    if (!mxcUri) return undefined;
    let active = true;
    let objectUrl: string | undefined;
    downloadCachedAttachment(mx, {
      owner: ownerRef.current,
      mxcUri,
      mimeType,
      encryptedFile: fileRef.current,
    }).then(
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
  }, [mx, mxcUri, mimeType, fileKey, ownerKey]);

  return src ? renderImage(src) : null;
}
