// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isBlurhashValid } from 'blurhash';
import { encodeBlurHash } from './blurHash';

const solidPixels = (width: number, height: number, [r, g, b]: [number, number, number]) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data.set([r, g, b, 255], offset);
  }
  return data;
};

const BASE83 =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';
const decode83 = (text: string) =>
  [...text].reduce((value, character) => value * 83 + BASE83.indexOf(character), 0);

const stubCanvas = (context: Partial<CanvasRenderingContext2D> | null) => {
  const createElement = document.createElement.bind(document);
  const drawn: { width: number; height: number }[] = [];
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const element = createElement(tag);
    if (tag === 'canvas') {
      const canvas = element as HTMLCanvasElement;
      vi.spyOn(canvas, 'getContext').mockImplementation(() => {
        drawn.push({ width: canvas.width, height: canvas.height });
        return context as CanvasRenderingContext2D;
      });
    }
    return element;
  });
  return drawn;
};

const image = (width: number, height: number) =>
  Object.assign(document.createElement('img'), { width, height });

afterEach(() => vi.restoreAllMocks());

describe('encodeBlurHash', () => {
  it('encodes a 4 by 3 hash of the image drawn at most 32 pixels wide', () => {
    const source = image(640, 320);
    const drawn = stubCanvas({
      drawImage: vi.fn(),
      getImageData: vi.fn(
        (_x: number, _y: number, width: number, height: number) =>
          ({ data: solidPixels(width, height, [200, 40, 40]) } as ImageData)
      ),
    });

    const hash = encodeBlurHash(source);

    expect(drawn).toEqual([{ width: 32, height: 16 }]);
    expect(hash).toBeDefined();
    expect(isBlurhashValid(hash as string)).toEqual({ result: true });
    // 1 size character (4 by 3 is 21, 'L'), 1 maximum, 4 for the average colour, 2 for each of the
    // 11 AC components.
    expect(hash).toHaveLength(28);
    expect(hash?.[0]).toBe('L');
    const average = decode83((hash as string).slice(2, 6));
    expect([average >> 16, (average >> 8) & 255, average & 255]).toEqual([200, 40, 40]);
  });

  it('returns undefined when the source has no size', () => {
    expect(encodeBlurHash(image(0, 0))).toBeUndefined();
  });

  it('returns undefined without a 2D context or when drawing throws', () => {
    stubCanvas(null);
    expect(encodeBlurHash(image(10, 10))).toBeUndefined();

    vi.restoreAllMocks();
    stubCanvas({
      drawImage: vi.fn(() => {
        throw new DOMException('tainted', 'SecurityError');
      }),
    });
    expect(encodeBlurHash(image(10, 10))).toBeUndefined();
  });
});
