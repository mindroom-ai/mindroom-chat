/**
 * Upload state for one file: an atom that moves from idle through loading to success or error.
 * Setting `{ promise }` starts tracking an upload request and settles the atom when the request
 * does; `{ progress }`, `{ mxc }`, and `{ error }` report the outcome directly.
 */
import { useCallback, useEffect, useRef } from 'react';
import { type Atom, type WritableAtom, atom, useAtomValue, useStore } from 'jotai';
import type { MatrixClient, MatrixError, UploadProgress, UploadResponse } from 'matrix-js-sdk';
import { type TUploadContent, toMatrixUploadError, uploadContent } from '../utils/matrix';



































  | { promise: Promise<UploadResponse> }
  | { progress: UploadProgress }
  | { mxc: string }
  | { error: Error }
  | { status: UploadStatus.Idle };

export type TUploadAtom = WritableAtom<Upload, [UploadAtomAction], void>;

/** A read-only list of the uploads of several files, as the upload board shows them. */
export type TUploadFamilyObserverAtom = Atom<Upload[]>;

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

export type BindUploadOptions = {
  /** Upload without the file name, as encrypted rooms require. */
  hideFilename?: boolean;
  /** A preparation failure (such as encryption) that turns any start into this error. */
  blockUploadError?: MatrixError;
};

export type BoundUpload = {
  upload: Upload;
  startUpload: () => Promise<void>;
  cancelUpload: () => Promise<void>;
};

/** Connects an upload atom to the media repository: start, progress, result, and cancel. */



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
    await uploadContent(mx, file, {
      name: file instanceof File ? file.name : undefined,
      fileType: file.type || undefined,
      hideFilename,
      onPromise: (promise) => {
        request = promise as Promise<UploadResponse>;
        requestRef.current = request;
        store.set(uploadAtom, { promise: request });
      },
      onProgress: (progress) => {
        if (isCurrent()) store.set(uploadAtom, { progress });
      },
      onSuccess: (mxc) => {
        if (isCurrent()) store.set(uploadAtom, { mxc });
      },
      onError: (error) => {
        if (isCurrent()) store.set(uploadAtom, { error });
      },
    });
  }, [mx, store, uploadAtom, hideFilename, blockUploadError]);

  const cancelUpload = useCallback(async (): Promise<void> => {
    const current = store.get(uploadAtom);
    requestRef.current = undefined;
    if (current.status !== UploadStatus.Loading) return;
    store.set(uploadAtom, { status: UploadStatus.Idle });
    mx.cancelUpload(current.promise);
  }, [mx, store, uploadAtom]);

  return { upload, startUpload, cancelUpload };
};
