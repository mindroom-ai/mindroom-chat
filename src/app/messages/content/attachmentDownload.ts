import { useCallback, useEffect, useRef, useState } from 'react';
import type { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import type { EventAttachmentOwner } from '../../matrix/protocol/eventAttachments';
import { downloadCachedAttachment } from '../../event-store/cache/attachmentRepository';
import { saveFile } from '../../native/nativeFileSave';
import { useAlive } from '../../lib/hooks/useAlive';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';

type AttachmentSource = {
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
  const alive = useAlive();
  const [status, setStatus] = useState<AttachmentActionStatus>('idle');
  const sourceRef = useRef(source);
  // Read by `run`, which stays stable for one source while the caller rebuilds the object.
  sourceRef.current = source;

  // Another attachment starts fresh, without the error state of the previous one.
  useEffect(() => {
    setStatus('idle');
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
      // Status updates after an await are dropped once the component is gone.
      const result = await action(blob);
      if (alive()) setStatus('idle');
      return result;
    } catch {
      if (alive()) setStatus('error');
      return undefined;
    } finally {
      busyRef.current = false;
    }
  }, [action, alive, key, mx]);

  return [status, run];
};

type AttachmentObjectUrl = {
  status: AttachmentActionStatus;
  /** The loaded URL while it is shown; undefined before loading and after `close`. */
  src: string | undefined;
  load: () => void;
  close: () => void;
};

/**
 * Loads an attachment into a `blob:` URL that lives as long as the component shows it: the URL
 * is revoked when it is closed or replaced, when the component unmounts, and right away when it
 * arrives after the unmount (a virtualized row that scrolled away while its file loaded).
 */
export const useAttachmentObjectUrl = (
  source: AttachmentSource,
  toObjectUrl: (blob: Blob) => Promise<string>
): AttachmentObjectUrl => {
  const alive = useAlive();
  const [src, setSrc] = useState<string>();
  const [status, run] = useAttachmentAction(source, toObjectUrl);

  useEffect(
    () => () => {
      if (src) URL.revokeObjectURL(src);
    },
    [src]
  );

  const load = useCallback(() => {
    run().then(
      (objectUrl) => {
        if (!objectUrl) return;
        if (alive()) setSrc(objectUrl);
        else URL.revokeObjectURL(objectUrl);
      },
      () => undefined
    );
  }, [alive, run]);
  const close = useCallback(() => setSrc(undefined), []);

  return { status, src, load, close };
};

/**
 * Type of every saved attachment. The sender declares the real type, so a save never keeps it:
 * a browser that opens a save instead of downloading it (FileSaver's fallback) then cannot
 * render HTML or SVG from this origin.
 */
export const DOWNLOAD_MIME_TYPE = 'application/octet-stream';

/** Saves an attachment as `fileName`, with the bytes typed as {@link DOWNLOAD_MIME_TYPE}. */
export const useAttachmentSave = (
  source: AttachmentSource,
  fileName: string
): [AttachmentActionStatus, () => Promise<boolean | undefined>] => {
  const save = useCallback((blob: Blob) => saveFile(blob, fileName), [fileName]);
  return useAttachmentAction({ ...source, mimeType: DOWNLOAD_MIME_TYPE }, save);
};
