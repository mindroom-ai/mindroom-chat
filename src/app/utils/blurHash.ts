// BlurHash (https://blurha.sh) placeholders for image and video uploads, sent as
// `info["xyz.amorgan.blurhash"]`. The encoder follows the published algorithm: a few DCT
// components of the linear-light image, quantised and written in base 83.

const BASE83 =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';

const encode83 = (value: number, length: number): string => {
  let result = '';
  for (let digit = 1; digit <= length; digit += 1) {
    const index = Math.floor(value / 83 ** (length - digit)) % 83;
    result += BASE83[index];
  }
  return result;
};

const sRGBToLinear = (value: number): number => {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

const linearToSRGB = (value: number): number => {
  const v = Math.max(0, Math.min(1, value));
  const encoded = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.min(255, Math.floor(encoded * 255 + 0.5));
};

const signPow = (value: number, exponent: number): number =>
  Math.sign(value) * Math.abs(value) ** exponent;

/** Encodes RGBA pixels (4 bytes each) with `componentsX` by `componentsY` components (1 to 9). */
export const encodeBlurHashPixels = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  componentsX = 4,
  componentsY = 3
): string => {
  if (componentsX < 1 || componentsX > 9 || componentsY < 1 || componentsY > 9) {
    throw new Error('BlurHash components must be between 1 and 9');
  }
  if (pixels.length < width * height * 4) throw new Error('Not enough pixel data');

  const factors: Array<[number, number, number]> = [];
  for (let j = 0; j < componentsY; j += 1) {
    for (let i = 0; i < componentsX; i += 1) {
      const normalisation = i === 0 && j === 0 ? 1 : 2;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let y = 0; y < height; y += 1) {
        const basisY = Math.cos((Math.PI * j * y) / height);
        for (let x = 0; x < width; x += 1) {
          const basis = normalisation * Math.cos((Math.PI * i * x) / width) * basisY;
          const offset = 4 * (y * width + x);
          r += basis * sRGBToLinear(pixels[offset]);
          g += basis * sRGBToLinear(pixels[offset + 1]);
          b += basis * sRGBToLinear(pixels[offset + 2]);
        }
      }
      const scale = 1 / (width * height);
      factors.push([r * scale, g * scale, b * scale]);
    }
  }

  const [dc, ...ac] = factors;
  let hash = encode83(componentsX - 1 + (componentsY - 1) * 9, 1);

  let maximumValue = 1;
  if (ac.length > 0) {
    const actualMaximum = Math.max(...ac.flat().map(Math.abs));
    const quantisedMaximum = Math.max(0, Math.min(82, Math.floor(actualMaximum * 166 - 0.5)));
    maximumValue = (quantisedMaximum + 1) / 166;
    hash += encode83(quantisedMaximum, 1);
  } else {
    hash += encode83(0, 1);
  }

  hash += encode83(
    (linearToSRGB(dc[0]) << 16) + (linearToSRGB(dc[1]) << 8) + linearToSRGB(dc[2]),
    4
  );

  const quantise = (value: number) =>
    Math.max(0, Math.min(18, Math.floor(signPow(value / maximumValue, 0.5) * 9 + 9.5)));
  ac.forEach(([r, g, b]) => {
    hash += encode83(quantise(r) * 19 * 19 + quantise(g) * 19 + quantise(b), 2);
  });
  return hash;
};

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
    return encodeBlurHashPixels(data, sampleWidth, sampleHeight);
  } catch {
    return undefined;
  }
};

/** Whether a string can be a BlurHash: the size flag fixes its length. */
export const isValidBlurHash = (hash: unknown): hash is string => {
  if (typeof hash !== 'string' || hash.length < 6) return false;
  const sizeFlag = BASE83.indexOf(hash[0]);
  if (sizeFlag < 0) return false;
  const componentsX = (sizeFlag % 9) + 1;
  const componentsY = Math.floor(sizeFlag / 9) + 1;
  return (
    hash.length === 4 + 2 * componentsX * componentsY && [...hash].every((c) => BASE83.includes(c))
  );
};
