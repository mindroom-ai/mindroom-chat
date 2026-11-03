import { useCallback, useEffect, useRef, useState } from 'react';
import type { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import type { EventAttachmentOwner } from '../../mindroom/messages/eventAttachments';
import { downloadCachedAttachment } from '../../mindroom/messages/attachmentRepository';
import { useMatrixClient } from '../../hooks/useMatrixClient';

export type AttachmentSource = {
  owner?: EventAttachmentOwner;
  url: string;
  mimeType: string;
  encInfo?: EncryptedAttachmentInfo;
};

const sourceKey = ({ url, mimeType, encInfo }: AttachmentSource) =>
  JSON.stringify([url, mimeType, encInfo?.iv ?? '', encInfo?.key?.k ?? '']);

export type AttachmentActionStatus = 'idle' | 'loading' | 'error';

/**
 * Runs an action on an attachment's bytes. The bytes are fetched once per source, so retrying
 * a failed save or reopening a viewer does not download the file again.
 */
export const useAttachmentAction = <T>(
  source: AttachmentSource,
  action: (blob: Blob) => Promise<T>
): [AttachmentActionStatus, () => Promise<T | undefined>] => {
  const mx = useMatrixClient();
  const key = sourceKey(source);
  const blobRef = useRef<{ key: string; blob: Blob }>();
  const busyRef = useRef(false);
  const aliveRef = useRef(true);
  const [status, setStatus] = useState<AttachmentActionStatus>('idle');
  const sourceRef = useRef(source);











  }, [key]);

  const run = useCallback(async () => {
    if (busyRef.current) return undefined;
    busyRef.current = true;
    setStatus('loading');
    try {
      let blob = blobRef.current?.key === key ? blobRef.current.blob : undefined;
      if (!blob) {
        const { owner, url, mimeType, encInfo } = sourceRef.current;
        blob = await downloadCachedAttachment(mx, {
          owner,
          mxcUri: url,
          mimeType,
          encryptedFile: encInfo ? { ...encInfo, url } : undefined,
        });
        blobRef.current = { key, blob };
      }
      const result = await action(blob);
      if (aliveRef.current) setStatus('idle');
      return result;
    } catch {
      if (aliveRef.current) setStatus('error');
      return undefined;
    } finally {
      busyRef.current = false;
    }
  }, [action, key, mx]);

  return [status, run];
};
