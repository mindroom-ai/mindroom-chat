import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { AsyncState, AsyncStatus } from '../../../hooks/useAsyncCallback';
import { revokeBlobUrl, useBlobUrlCleanup } from '../../../hooks/useBlobUrlCleanup';
import {
  decryptFile,
  downloadEncryptedMedia,
  downloadMedia,
  mxcUrlToHttp,
} from '../../../utils/matrix';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { useAlive } from '../../../hooks/useAlive';

type AudioContentSourceOptions = {
  mimeType: string;
  url: string;
  encInfo?: EncryptedAttachmentInfo;
};

export const getAudioContentSourceIdentity = ({
  mimeType,
  url,
  encInfo,
}: AudioContentSourceOptions): string =>
  JSON.stringify([
    mimeType,
    url,
    encInfo?.v ?? '',
    encInfo?.iv ?? '',
    encInfo?.hashes?.sha256 ?? '',
    encInfo?.key?.k ?? '',
  ]);

export const useAudioContentSource = ({
  mimeType,
  url,
  encInfo,
}: AudioContentSourceOptions): [AsyncState<string>, () => Promise<string>] => {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const alive = useAlive();
  const mediaIdentity = getAudioContentSourceIdentity({ mimeType, url, encInfo });
  const mediaIdentityRef = useRef(mediaIdentity);
  const requestRef = useRef(0);
  const [srcState, setSrcState] = useState<AsyncState<string>>({
    status: AsyncStatus.Idle,
  });

  useLayoutEffect(() => {
    if (mediaIdentityRef.current === mediaIdentity) return;

    mediaIdentityRef.current = mediaIdentity;
    requestRef.current += 1;
    setSrcState({ status: AsyncStatus.Idle });
  }, [mediaIdentity]);

  const loadSrc = useCallback(async () => {
    const request = requestRef.current + 1;
    requestRef.current = request;
    const requestIdentity = mediaIdentity;
    setSrcState({ status: AsyncStatus.Loading });

    try {
      const mediaUrl = mxcUrlToHttp(mx, url, useAuthentication);
      if (!mediaUrl) throw new Error('Invalid media URL');
      const fileContent = encInfo
        ? await downloadEncryptedMedia(mediaUrl, (encBuf) => decryptFile(encBuf, mimeType, encInfo))
        : await downloadMedia(mediaUrl);
      const blobUrl = URL.createObjectURL(fileContent);
      if (
        request !== requestRef.current ||
        requestIdentity !== mediaIdentityRef.current ||
        !alive()
      ) {
        revokeBlobUrl(blobUrl);
        throw new Error('AudioContentSource: Request replaced!');
      }

      setSrcState({ status: AsyncStatus.Success, data: blobUrl });
      return blobUrl;
    } catch (error) {
      if (
        request === requestRef.current &&
        requestIdentity === mediaIdentityRef.current &&
        alive()
      ) {
        setSrcState({ status: AsyncStatus.Error, error });
      }
      throw error;
    }
  }, [alive, encInfo, mediaIdentity, mimeType, mx, url, useAuthentication]);

  useBlobUrlCleanup(srcState);

  return [srcState, loadSrc];
};
