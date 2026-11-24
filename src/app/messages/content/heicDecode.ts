import HeicDecodeWorker from './heicDecodeWorker?worker';
import type { HeicDecodeRequest, HeicWorkerResponse } from './heicDecodeWorker';

const JPEG_QUALITY = 0.92;
const WORKER_IDLE_TIMEOUT_MS = 30_000;

type PendingRequest = {
  resolve: (blob: Blob) => void;
  reject: (error: Error) => void;
};

let worker: Worker | undefined;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let nextRequestId = 1;
const pending = new Map<number, PendingRequest>();

const clearIdleTimer = (): void => {
  if (idleTimer !== undefined) {
    clearTimeout(idleTimer);
    idleTimer = undefined;
  }
};

const disposeWorker = (failure?: Error): void => {
  clearIdleTimer();
  const current = worker;
  worker = undefined;
  current?.terminate();
  if (failure) {
    const waiting = [...pending.values()];
    pending.clear();
    waiting.forEach((entry) => entry.reject(failure));
  }
};

const scheduleIdleDispose = (): void => {
  clearIdleTimer();
  if (pending.size > 0) return;
  idleTimer = setTimeout(() => {
    if (pending.size === 0) disposeWorker();
  }, WORKER_IDLE_TIMEOUT_MS);
};

const encodeRgbaOnCanvas = (
  buffer: ArrayBuffer,
  width: number,
  height: number,
  hasAlpha: boolean
): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const canvas = Object.assign(document.createElement('canvas'), { width, height });
    const context = canvas.getContext('2d');
    if (!context) {
      reject(new Error('Unable to create 2D canvas context for HEIC decode'));
      return;
    }
    context.putImageData(new ImageData(new Uint8ClampedArray(buffer), width, height), 0, 0);
    const type = hasAlpha ? 'image/png' : 'image/jpeg';
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Unable to encode decoded HEIC image'))),
      type,
      JPEG_QUALITY
    );
  });

const ensureWorker = (): Worker => {
  if (worker) return worker;
  const instance = new HeicDecodeWorker();
  instance.onmessage = (event: MessageEvent<HeicWorkerResponse>) => {
    const response = event.data;
    const entry = pending.get(response.id);
    if (!entry) return;
    pending.delete(response.id);
    scheduleIdleDispose();

    if ('error' in response) {
      entry.reject(new Error(response.error));
      return;
    }
    if ('blob' in response) {
      entry.resolve(response.blob);
      return;
    }
    encodeRgbaOnCanvas(response.buffer, response.width, response.height, response.hasAlpha).then(
      entry.resolve,
      (error: unknown) => entry.reject(error instanceof Error ? error : new Error(String(error)))
    );
  };
  instance.onerror = (event) => {
    disposeWorker(new Error(event.message || 'HEIC decode worker failed'));
  };
  worker = instance;
  return instance;
};

/**
 * Decodes a HEIC/HEIF blob in a dedicated worker and returns a browser-renderable JPEG (or PNG
 * when the picture has transparency).
 */
export const decodeHeicBlob = async (blob: Blob): Promise<Blob> => {
  const buffer = await blob.arrayBuffer();
  const instance = ensureWorker();
  clearIdleTimer();
  const id = nextRequestId;
  nextRequestId += 1;

  return new Promise<Blob>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const message: HeicDecodeRequest = { id, buffer };
    instance.postMessage(message, [buffer]);
  });
};
