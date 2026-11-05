import { encode } from 'blurhash';

// BlurHash (https://blurha.sh) placeholders for image and video uploads, sent as
// `info["xyz.amorgan.blurhash"]`. Encoding uses the `blurhash` package (MIT) with 4 by 3
// components.

const COMPONENTS_X = 4;
const COMPONENTS_Y = 3;
const SAMPLE_SIZE = 32;

/**
 * The BlurHash of an image or video frame, drawn small first so encoding stays cheap; undefined
 * when the browser cannot draw it (no canvas, or a tainted source).
 */
export const encodeBlurHash = (
  source: HTMLImageElement | HTMLVideoElement,
  width?: number,
  height?: number
): string | undefined => {
  const sourceWidth =
    width ?? ('videoWidth' in source ? source.videoWidth : source.naturalWidth || source.width);
  const sourceHeight =
    height ??
    ('videoHeight' in source ? source.videoHeight : source.naturalHeight || source.height);
  if (!sourceWidth || !sourceHeight) return undefined;

  const scale = Math.min(1, SAMPLE_SIZE / Math.max(sourceWidth, sourceHeight));
  const sampleWidth = Math.max(1, Math.round(sourceWidth * scale));
  const sampleHeight = Math.max(1, Math.round(sourceHeight * scale));
  try {
    const canvas = document.createElement('canvas');
    canvas.width = sampleWidth;
    canvas.height = sampleHeight;
    const context = canvas.getContext('2d');
    if (!context) return undefined;
    context.drawImage(source, 0, 0, sampleWidth, sampleHeight);
    const { data } = context.getImageData(0, 0, sampleWidth, sampleHeight);
    return encode(data, sampleWidth, sampleHeight, COMPONENTS_X, COMPONENTS_Y);
  } catch {
    return undefined;
  }
};
