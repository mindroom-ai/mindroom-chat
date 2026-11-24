import { decode } from 'heif-js/heic';

export type HeicDecodeRequest = {
  id: number;
  buffer: ArrayBuffer;
};

export type HeicWorkerResponse =
  | { id: number; blob: Blob }
  | { id: number; width: number; height: number; hasAlpha: boolean; buffer: ArrayBuffer }
  | { id: number; error: string };

type WorkerScope = {
  onmessage: ((event: MessageEvent<HeicDecodeRequest>) => void) | null;
  postMessage: (message: HeicWorkerResponse, transfer?: Transferable[]) => void;
};

const JPEG_QUALITY = 0.92;

const hasTransparency = (rgba: Uint8ClampedArray): boolean => {
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] !== 255) return true;
  }
  return false;
};

const workerScope = self as unknown as WorkerScope;

const handleRequest = async ({ id, buffer }: HeicDecodeRequest): Promise<void> => {
  try {
    const { width, height, data } = decode(new Uint8Array(buffer));
    const pixels =
      data.buffer instanceof ArrayBuffer
        ? new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength)
        : new Uint8ClampedArray(data);
    const hasAlpha = hasTransparency(pixels);

    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext('2d');
      if (context) {
        context.putImageData(new ImageData(pixels, width, height), 0, 0);
        const type = hasAlpha ? 'image/png' : 'image/jpeg';
        const blob = await canvas.convertToBlob({ type, quality: JPEG_QUALITY });
        workerScope.postMessage({ id, blob });
        return;
      }
    }

    const full =
      pixels.byteOffset === 0 && pixels.byteLength === pixels.buffer.byteLength
        ? pixels
        : new Uint8ClampedArray(pixels);
    workerScope.postMessage({ id, width, height, hasAlpha, buffer: full.buffer }, [full.buffer]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    workerScope.postMessage({ id, error: message });
  }
};

workerScope.onmessage = (event) => {
  void handleRequest(event.data);
};
