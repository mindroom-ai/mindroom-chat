/**
 * Upload state for one file: an atom that moves from idle through loading to success or error.
 * Setting `{ promise }` starts tracking an upload request and settles the atom when the request
 * does; `{ progress }`, `{ mxc }`, and `{ error }` report the outcome directly. `TUploadItem` is a
 * file staged for upload with what is sent for it.
 */
import { useCallback, useEffect, useRef } from 'react';
import { atom, useAtomValue, useStore, type Atom, type WritableAtom } from 'jotai';
import type { MatrixClient, MatrixError, UploadProgress, UploadResponse } from 'matrix-js-sdk';
import type { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import type { MindroomPasteMarker } from '../protocol/pasteAttachmentMarker';
import { toMatrixUploadError, uploadContent, type TUploadContent } from '../matrix';

/** Where one file's upload stands. String values keep logged and stored states readable. */
export enum UploadStatus {
  Idle = 'idle', // not started, or cancelled
  Loading = 'loading', // the request is in flight
  Success = 'success', // the homeserver returned a content URI
  Error = 'error', // the request failed or returned no content URI
}

/** The fields each status adds to the file and the status itself. */
type StatusFields = {
  [UploadStatus.Error]: { error: Error };
  [UploadStatus.Idle]: Record<never, never>;
  [UploadStatus.Loading]: { promise: Promise<UploadResponse>; progress: UploadProgress };
  [UploadStatus.Success]: { mxc: string };
};

type UploadAt<S extends UploadStatus> = { file: TUploadContent; status: S } & StatusFields[S];

/** One file's upload in any status; `status` tells the variants apart. */
export type Upload = { [S in UploadStatus]: UploadAt<S> }[UploadStatus];

type UploadAtomAction =
  | { promise: Promise<UploadResponse> }
  | { progress: UploadProgress }
  | { mxc: string }
  | { error: Error }
  | { status: UploadStatus.Idle };

export type TUploadAtom = WritableAtom<Upload, [UploadAtomAction], void>;

/** A read-only list of the uploads of several files, as the upload board shows them. */
export type TUploadFamilyObserverAtom = Atom<Upload[]>;

export type TUploadMetadata = {
  markedAsSpoiler: boolean;
  /** Set when the file holds text the composer turned into an attachment. */
  mindroomPasteAttachment?: Pick<MindroomPasteMarker, 'id' | 'chars' | 'fileName'>;
  /** Set when the file is a recorded voice message. */
  voiceMessage?: {
    /** Length in milliseconds. */
    duration: number;
    waveform?: number[];
  };
};

/** What is sent for a staged file: the bytes and, when they are encrypted, how to decrypt them. */
type UploadPayload = {
  /** The bytes sent to the media repository: `originalFile` or its encrypted copy. */
  file: TUploadContent;
  /** Present when `file` is the encrypted form of `originalFile`. */
  encInfo: EncryptedAttachmentInfo | undefined;
};

/** A file staged in the composer: what the user chose, what is uploaded for it, and how. */
export type TUploadItem = UploadPayload & {
  originalFile: TUploadContent;
  metadata: TUploadMetadata;
  /** Preparing the file (for example encrypting it) failed; it cannot be uploaded. */
  prepError?: MatrixError;
};

export const createUploadAtom = (file: TUploadContent): TUploadAtom => {
  const uploadAtom = atom<Upload>({ file, status: UploadStatus.Idle });

  return atom<Upload, [UploadAtomAction], void>(
    (get) => get(uploadAtom),
    (get, set, action) => {
      if ('promise' in action) {
        const { promise } = action;
        set(uploadAtom, {
          file,
          status: UploadStatus.Loading,
          promise,
          progress: { loaded: 0, total: file.size },
        });
        // Settle only if this request is still the one the atom tracks.
        const isCurrent = () => {
          const current = get(uploadAtom);
          return current.status === UploadStatus.Loading && current.promise === promise;
        };
        promise.then(
          ({ content_uri: mxc }) => {
            if (!isCurrent()) return;
            set(
              uploadAtom,
              mxc
                ? { file, status: UploadStatus.Success, mxc }
                : {
                    file,
                    status: UploadStatus.Error,
                    error: toMatrixUploadError(
                      new Error('The upload returned no content URI.'),
                      'upload'
                    ),
                  }
            );
          },
          (error: unknown) => {
            if (!isCurrent()) return;
            set(uploadAtom, {
              file,
              status: UploadStatus.Error,
              error: toMatrixUploadError(error, 'upload'),
            });
          }
        );
        return;
      }
      if ('progress' in action) {
        const current = get(uploadAtom);
        if (current.status !== UploadStatus.Loading) return;
        set(uploadAtom, { ...current, progress: action.progress });
        return;
      }
      if ('mxc' in action) {
        set(uploadAtom, { file, status: UploadStatus.Success, mxc: action.mxc });
        return;
      }
      if ('error' in action) {
        set(uploadAtom, { file, status: UploadStatus.Error, error: action.error });
        return;
      }
      set(uploadAtom, { file, status: UploadStatus.Idle });
    }
  );
};

/** Observes the uploads of `files` in order, through the atom family that owns them. */
export const createUploadFamilyObserverAtom = (
  uploadFamily: (file: TUploadContent) => Atom<Upload>,
  files: TUploadContent[]
): TUploadFamilyObserverAtom => atom((get) => files.map((file) => get(uploadFamily(file))));

type BindUploadOptions = {
  /** Upload without the file name, as encrypted rooms require. */
  hideFilename?: boolean;
  /** A preparation failure (such as encryption) that turns any start into this error. */
  blockUploadError?: MatrixError;
};

type BoundUpload = {
  upload: Upload;
  startUpload: () => Promise<void>;
  cancelUpload: () => Promise<void>;
};

/** Connects an upload atom to the media repository: start, progress, result, and cancel. */
export const useBindUploadAtom = (
  client: MatrixClient,
  uploadAtom: TUploadAtom,
  { hideFilename, blockUploadError }: BindUploadOptions = {}
): BoundUpload => {
  const store = useStore();
  const upload = useAtomValue(uploadAtom);
  const requestRef = useRef<Promise<UploadResponse>>();

  useEffect(
    () => () => {
      requestRef.current = undefined;
    },
    [uploadAtom]
  );

  const startUpload = useCallback(async (): Promise<void> => {
    const current = store.get(uploadAtom);
    if (current.status === UploadStatus.Loading || current.status === UploadStatus.Success) return;
    if (blockUploadError) {
      store.set(uploadAtom, { error: blockUploadError });
      return;
    }

    const { file } = current;
    let request: Promise<UploadResponse> | undefined;
    const isCurrent = () => request !== undefined && requestRef.current === request;
    await uploadContent(client, file, {
      name: file instanceof File ? file.name : undefined,
      fileType: file.type || undefined,
      hideFilename,
      onPromise: (promise) => {
        request = promise;
        requestRef.current = request;
        store.set(uploadAtom, { promise: request });
      },
      onProgress: (progress) => {
        if (isCurrent()) store.set(uploadAtom, { progress });
      },
      // The atom settles itself from the request it was given (success, no URI, or failure).
    });
  }, [client, store, uploadAtom, hideFilename, blockUploadError]);

  const cancelUpload = useCallback(async (): Promise<void> => {
    const current = store.get(uploadAtom);
    requestRef.current = undefined;
    if (current.status !== UploadStatus.Loading) return;
    store.set(uploadAtom, { status: UploadStatus.Idle });
    client.cancelUpload(current.promise);
  }, [client, store, uploadAtom]);

  return { upload, startUpload, cancelUpload };
};
