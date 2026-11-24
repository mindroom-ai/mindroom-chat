import type { HeicWorkerResponse } from './heicDecodeWorker';

const DECODE_TIMEOUT_MS = 20_000;
type QueuedJob = {
  blob: Blob;
  signal?: AbortSignal;
  resolve: (b: Blob) => void;
  reject: (e: Error) => void;
};
const queue: QueuedJob[] = [];
let running = false;
const abortError = () => Object.assign(new Error('HEIC decode aborted'), { name: 'AbortError' });

const runWorkerDecode = async (blob: Blob, signal?: AbortSignal): Promise<Blob> => {
  const buffer = await blob.arrayBuffer();
  if (signal?.aborted) throw abortError();
  return new Promise<Blob>((resolve, reject) => {
    const worker = new Worker(new URL('./heicDecodeWorker.ts', import.meta.url), {
      type: 'module',
    });
    const finish = (value: Blob | Error) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      worker.terminate();
      if (value instanceof Error) reject(value);
      else resolve(value);
    };
    const onAbort = () => finish(abortError());
    const timer = setTimeout(() => finish(new Error('HEIC decode timed out')), DECODE_TIMEOUT_MS);
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.onmessage = ({ data }: MessageEvent<HeicWorkerResponse>) =>
      finish('blob' in data ? data.blob : new Error(data.error));
    worker.onerror = (event) => finish(new Error(event.message || 'HEIC decode worker failed'));
    worker.postMessage(buffer, [buffer]);
  });
};

const drain = (): void => {
  const next = running ? undefined : queue.pop(); // LIFO: newest tile in view decodes first.
  if (!next) return;
  if (next.signal?.aborted) {
    next.reject(abortError());
    drain();
    return;
  }
  running = true;
  void runWorkerDecode(next.blob, next.signal)
    .then(next.resolve, next.reject)
    .finally(() => {
      running = false;
      drain();
    });
};

/** Decodes HEIC/HEIF in a short-lived worker (serialized LIFO, abortable, 20 s watchdog). */
export const decodeHeicBlob = (blob: Blob, signal?: AbortSignal): Promise<Blob> => {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise<Blob>((resolve, reject) => {
    const job: QueuedJob = { blob, signal, resolve, reject };
    signal?.addEventListener(
      'abort',
      () => {
        const i = queue.indexOf(job);
        if (i >= 0) {
          queue.splice(i, 1);
          reject(abortError());
        }
      },
      { once: true }
    );
    queue.push(job);
    drain();
  });
};
