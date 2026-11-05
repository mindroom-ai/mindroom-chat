import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import type { EventAttachmentOwner } from '../../matrix/protocol/eventAttachments';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { AsyncState, AsyncStatus } from '../../lib/hooks/useAsyncCallback';
import { revokeBlobUrl, useBlobUrlCleanup } from '../../lib/hooks/useBlobUrlCleanup';
import { downloadCachedAttachment } from '../../event-store/cache/attachmentRepository';
import { useAlive } from '../../lib/hooks/useAlive';

type AudioContentSourceOptions = {
  owner?: EventAttachmentOwner;
  mimeType: string;
  url: string;
  encInfo?: EncryptedAttachmentInfo;
};

export const getAudioContentSourceIdentity = ({
  mimeType,
  url,
  encInfo,
  owner,
}: AudioContentSourceOptions): string =>
  JSON.stringify([
    owner,
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
  owner,
}: AudioContentSourceOptions): [AsyncState<string>, () => Promise<string>] => {
  const mx = useMatrixClient();
  const alive = useAlive();
  const mediaIdentity = getAudioContentSourceIdentity({ mimeType, url, encInfo, owner });
  const mediaIdentityRef = useRef(mediaIdentity);
  const requestRef = useRef(0);
  const pendingSrcRef = useRef<string>();
  const [srcState, setSrcState] = useState<AsyncState<string>>({
    status: AsyncStatus.Idle,
  });

  const discardPendingSrc = useCallback(() => {
    const pendingSrc = pendingSrcRef.current;
    if (!pendingSrc) return;

    pendingSrcRef.current = undefined;
    revokeBlobUrl(pendingSrc);
  }, []);

  useLayoutEffect(() => {
    if (mediaIdentityRef.current === mediaIdentity) return;

    discardPendingSrc();
    mediaIdentityRef.current = mediaIdentity;
    requestRef.current += 1;
    setSrcState({ status: AsyncStatus.Idle });
  }, [discardPendingSrc, mediaIdentity]);

  const loadSrc = useCallback(async () => {
    discardPendingSrc();
    const request = requestRef.current + 1;
    requestRef.current = request;
    const requestIdentity = mediaIdentity;
    setSrcState({ status: AsyncStatus.Loading });

    try {
      const fileContent = await downloadCachedAttachment(mx, {
        owner,
        mxcUri: url,
        mimeType,
        encryptedFile: encInfo ? { ...encInfo, url } : undefined,
      });
      const blobUrl = URL.createObjectURL(fileContent);
      if (
        request !== requestRef.current ||
        requestIdentity !== mediaIdentityRef.current ||
        !alive()
      ) {
        revokeBlobUrl(blobUrl);
        throw new Error('AudioContentSource: Request replaced!');
      }

      pendingSrcRef.current = blobUrl;
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
  }, [owner, alive, discardPendingSrc, encInfo, mediaIdentity, mimeType, mx, url]);

  useLayoutEffect(
    () => () => {
      discardPendingSrc();
    },
    [discardPendingSrc]
  );

  useEffect(() => {
    if (srcState.status === AsyncStatus.Success && pendingSrcRef.current === srcState.data) {
      pendingSrcRef.current = undefined;
    }
  }, [srcState]);

  useBlobUrlCleanup(srcState);

  return [srcState, loadSrc];
};
