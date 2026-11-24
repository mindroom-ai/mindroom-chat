// Young single-maintainer MIT decoder (pinned exactly in package.json); revisit on upgrade.
import { decode } from 'heif-js/heic';

export type HeicWorkerResponse = { blob: Blob } | { error: string };

const JPEG_QUALITY = 0.92;
const DECODE_LIMITS = { maxPixels: 50_000_000, maxTotalPixels: 100_000_000 };
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ArrayBuffer>) => void) | null;
  postMessage: (message: HeicWorkerResponse) => void;
};

const hasTransparency = (rgba: Uint8ClampedArray): boolean => {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) return true;
  return false;
};

scope.onmessage = ({ data: buffer }) => {
  void (async () => {
    try {
      const { width, height, data } = decode(new Uint8Array(buffer), DECODE_LIMITS);
      const pixels =
        data.buffer instanceof ArrayBuffer
          ? new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength)
          : new Uint8ClampedArray(data);
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Unable to create OffscreenCanvas 2D context');
      context.putImageData(new ImageData(pixels, width, height), 0, 0);
      const type = hasTransparency(pixels) ? 'image/png' : 'image/jpeg';
      scope.postMessage({ blob: await canvas.convertToBlob({ type, quality: JPEG_QUALITY }) });
    } catch (error) {
      scope.postMessage({ error: error instanceof Error ? error.message : String(error) });
    }
  })();
};
