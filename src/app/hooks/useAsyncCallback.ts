import { Dispatch, SetStateAction, useCallback, useLayoutEffect, useRef, useState } from 'react';

/** Where an async request stands; `useAsyncCallback` holds the latest outcome. */





}

type AsyncIdle = { status: AsyncStatus.Idle };
type AsyncLoading = { status: AsyncStatus.Loading };
type AsyncSuccess<D> = { status: AsyncStatus.Success; data: D };






/** Releases a result nobody will own, such as a blob URL whose state never committed. */
export type AsyncDiscardCallback<D> = (data: D) => void;

const REQUEST_REPLACED_ERROR = 'AsyncCallbackHook: Request replaced!';

type PendingPublication<D> = {
  state: AsyncSuccess<D>;
  resolve: (data: D) => void;
  reject: (error: Error) => void;
};

/**
 * Runs `asyncCallback` and keeps its latest outcome in state.
 *
 * A result belongs to whoever ends up holding it. Once the success state commits, the state owns
 * the data (see `useBlobUrlCleanup`). Until then the hook does: when a newer request replaces it,
 * the result is discarded and its promise rejects with "Request replaced"; when the component
 * unmounts first, the result is discarded and the promise still resolves with it. `onDiscard`
 * releases discarded results.
 */
export function useAsyncCallback<D, E = unknown, A extends unknown[] = []>(
  asyncCallback: AsyncCallback<A, D>,
  onDiscard?: AsyncDiscardCallback<D>
): [AsyncState<D, E>, AsyncCallback<A, D>, Dispatch<SetStateAction<AsyncState<D, E>>>] {
  const [state, setState] = useState<AsyncState<D, E>>({ status: AsyncStatus.Idle });
  const requestRef = useRef(0);
  const aliveRef = useRef(true);
  const pendingRef = useRef<PendingPublication<D>>();
  const onDiscardRef = useRef(onDiscard);
  onDiscardRef.current = onDiscard;

  const discard = useCallback((data: D) => {
    onDiscardRef.current?.(data);
  }, []);

  const replacePending = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = undefined;
    discard(pending.state.data);
    pending.reject(new Error(REQUEST_REPLACED_ERROR));
  }, [discard]);

  useLayoutEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      const pending = pendingRef.current;
      if (!pending) return;
      pendingRef.current = undefined;
      discard(pending.state.data);
      pending.resolve(pending.state.data);
    };
  }, [discard]);

  // The success state committed: it owns the data from here on. A layout effect runs in the same
  // commit, so a request started after the commit never discards data the state already owns.
  useLayoutEffect(() => {
    const pending = pendingRef.current;
    if (!pending || pending.state !== state) return;
    pendingRef.current = undefined;
    pending.resolve(pending.state.data);
  }, [state]);

  const callback: AsyncCallback<A, D> = useCallback(
    async (...args: A) => {
      replacePending();
      requestRef.current += 1;
      const request = requestRef.current;
      setState({ status: AsyncStatus.Loading });

      let data: D;
      try {
        data = await asyncCallback(...args);
      } catch (error) {
        if (request === requestRef.current && aliveRef.current) {
          setState({ status: AsyncStatus.Error, error: error as E });
        }
        throw error;
      }

      if (!aliveRef.current) {
        discard(data);
        return data;
      }
      if (request !== requestRef.current) {
        discard(data);
        throw new Error(REQUEST_REPLACED_ERROR);
      }

      // Publish on the next microtask, so a request or unmount in the same turn still finds the
      // result unowned and discards it instead of leaving it to a state that never commits.
      const success: AsyncSuccess<D> = { status: AsyncStatus.Success, data };
      return new Promise<D>((resolve, reject) => {
        const publication: PendingPublication<D> = { state: success, resolve, reject };
        pendingRef.current = publication;
        queueMicrotask(() => {
          if (pendingRef.current === publication && aliveRef.current) setState(success);
        });
      });
    },
    [asyncCallback, discard, replacePending]
  );

  return [state, callback, setState];
}
