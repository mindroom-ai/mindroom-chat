import { ReactNode, useCallback, useEffect } from 'react';
import { IThumbnailContent } from '../../../../types/matrix/common';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import { useBlobUrlCleanup } from '../../../hooks/useBlobUrlCleanup';
import { decryptFile, downloadEncryptedMedia, mxcUrlToHttp } from '../../../utils/matrix';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { FALLBACK_MIMETYPE } from '../../../utils/mimeTypes';

export type ThumbnailContentProps = {
  info: IThumbnailContent;
  preloadedSrc?: string;
  renderImage: (src: string) => ReactNode;
};
export function ThumbnailContent({ info, preloadedSrc, renderImage }: ThumbnailContentProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();

  const [thumbSrcState, loadThumbSrc] = useAsyncCallback(
    useCallback(async () => {
      const thumbInfo = info.thumbnail_info;
      const thumbMxcUrl = info.thumbnail_file?.url ?? info.thumbnail_url;
      const encInfo = info.thumbnail_file;
      if (typeof thumbMxcUrl !== 'string' || typeof thumbInfo?.mimetype !== 'string') {
        throw new Error('Failed to load thumbnail');
      }

      const mediaUrl = mxcUrlToHttp(mx, thumbMxcUrl, useAuthentication);
      if (!mediaUrl) throw new Error('Invalid media URL');
      if (encInfo) {
        const fileContent = await downloadEncryptedMedia(mediaUrl, (encBuf) =>
          decryptFile(encBuf, thumbInfo.mimetype ?? FALLBACK_MIMETYPE, encInfo)
        );
        return URL.createObjectURL(fileContent);
      }

      return mediaUrl;
    }, [mx, info, useAuthentication])
  );
  useBlobUrlCleanup(thumbSrcState);

  useEffect(() => {
    if (preloadedSrc) return;
    loadThumbSrc();
  }, [loadThumbSrc, preloadedSrc]);

  const resolvedSrc =
    preloadedSrc ?? (thumbSrcState.status === AsyncStatus.Success ? thumbSrcState.data : undefined);

  return resolvedSrc ? renderImage(resolvedSrc) : null;
}
