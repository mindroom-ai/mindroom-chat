import { useCallback } from 'react';
import { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { AsyncState, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import { useBlobUrlCleanup } from '../../../hooks/useBlobUrlCleanup';
import {
  decryptFile,
  downloadEncryptedMedia,
  downloadMedia,
  mxcUrlToHttp,
} from '../../../utils/matrix';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';

type AudioContentSourceOptions = {
  mimeType: string;
  url: string;
  encInfo?: EncryptedAttachmentInfo;
};

export const useAudioContentSource = ({
  mimeType,
  url,
  encInfo,
}: AudioContentSourceOptions): [AsyncState<string>, () => Promise<string>] => {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();

  const [srcState, loadSrc] = useAsyncCallback(
    useCallback(async () => {
      const mediaUrl = mxcUrlToHttp(mx, url, useAuthentication);
      if (!mediaUrl) throw new Error('Invalid media URL');
      const fileContent = encInfo
        ? await downloadEncryptedMedia(mediaUrl, (encBuf) => decryptFile(encBuf, mimeType, encInfo))
        : await downloadMedia(mediaUrl);
      return URL.createObjectURL(fileContent);
    }, [mx, url, useAuthentication, mimeType, encInfo])
  );
  useBlobUrlCleanup(srcState);

  return [srcState, loadSrc];
};
