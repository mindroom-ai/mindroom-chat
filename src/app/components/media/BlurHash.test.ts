import { describe, expect, it } from 'vitest';
import { encode } from 'blurhash';
import { getInfoBlurHash } from './BlurHash';

const solidHash = (): string => {
  const pixels = new Uint8ClampedArray(4 * 4 * 4).fill(200);
  return encode(pixels, 4, 4, 4, 3);
};

describe('getInfoBlurHash', () => {
  it('reads the hash an image info carries', () => {
    const hash = solidHash();
    expect(getInfoBlurHash({ w: 4, h: 4, 'xyz.amorgan.blurhash': hash })).toBe(hash);
  });

  it('ignores a missing, malformed or non-string hash', () => {
    expect(getInfoBlurHash(undefined)).toBeUndefined();
    expect(getInfoBlurHash({ w: 4 })).toBeUndefined();
    expect(getInfoBlurHash({ 'xyz.amorgan.blurhash': 'not a hash' })).toBeUndefined();
    expect(getInfoBlurHash({ 'xyz.amorgan.blurhash': 42 })).toBeUndefined();
  });
});
