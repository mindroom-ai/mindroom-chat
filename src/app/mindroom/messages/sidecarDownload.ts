import { MatrixClient } from 'matrix-js-sdk';
import { IEncryptedFile } from '../../../types/matrix/common';
import { validMediaRequest } from '../../../swMediaAuth';
import {
  decryptFile,
  downloadEncryptedMedia,
  downloadMedia,
  mxcUrlToHttp,
} from '../../utils/matrix';

export const downloadMindroomSidecarBlob = async (
  mx: MatrixClient,
  source: { mxcUri: string; encryptedFile?: IEncryptedFile },
  useAuthentication: boolean,
  mimeType = 'application/json'
): Promise<Blob> => {
  const url = mxcUrlToHttp(mx, source.mxcUri, useAuthentication);
  if (!url) throw new Error('Unable to resolve sidecar URL');
  const token = useAuthentication ? mx.getAccessToken() : undefined;
  const requestInit =
    token && validMediaRequest(url, mx.getHomeserverUrl())
      ? { headers: { Authorization: `Bearer ${token}` } }
      : undefined;
  const file = source.encryptedFile;
  if (!file) return requestInit ? downloadMedia(url, requestInit) : downloadMedia(url);
  const decrypt = (bytes: ArrayBuffer) => decryptFile(bytes, mimeType, file);
  return requestInit
    ? downloadEncryptedMedia(url, decrypt, requestInit)
    : downloadEncryptedMedia(url, decrypt);
};
