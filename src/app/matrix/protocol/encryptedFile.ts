import { isRecord } from '../../lib/isRecord';
import type { IEncryptedFile } from '../types/common';

const isMxc = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith('mxc://');

export const readEncryptedFile = (value: unknown): IEncryptedFile | undefined => {
  if (
    !isRecord(value) ||
    value.v !== 'v2' ||
    !isMxc(value.url) ||
    !isRecord(value.key) ||
    typeof value.key.k !== 'string' ||
    typeof value.iv !== 'string' ||
    !isRecord(value.hashes) ||
    typeof value.hashes.sha256 !== 'string'
  ) {
    return undefined;
  }
  // Copy only the fields decryption uses.
  return {
    url: value.url,
    key: value.key,
    iv: value.iv,
    hashes: { sha256: value.hashes.sha256 },
    v: value.v,
  } as unknown as IEncryptedFile;
};
