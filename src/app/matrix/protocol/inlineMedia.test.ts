import { describe, expect, it } from 'vitest';
import { INLINE_MEDIA_CONTENT_KEY, MAX_INLINE_MEDIA_ENTRIES, readInlineMedia } from './inlineMedia';

const validFile = (url: string, extra: Record<string, unknown> = {}) => ({
  url,
  v: 'v2',
  key: { kty: 'oct', key_ops: ['encrypt', 'decrypt'], alg: 'A256CTR', k: 'secret-key', ext: true },
  iv: 'iv-base64',
  hashes: { sha256: 'hash-base64' },
  mimetype: 'image/png',
  size: 1024,
  ...extra,
});

describe('readInlineMedia', () => {
  it('returns undefined when absent, empty, or not a record', () => {
    expect(readInlineMedia(undefined)).toBeUndefined();
    expect(readInlineMedia({})).toBeUndefined();
    expect(readInlineMedia({ [INLINE_MEDIA_CONTENT_KEY]: null })).toBeUndefined();
    expect(readInlineMedia({ [INLINE_MEDIA_CONTENT_KEY]: [] })).toBeUndefined();
    expect(readInlineMedia({ [INLINE_MEDIA_CONTENT_KEY]: {} })).toBeUndefined();
    expect(
      readInlineMedia({
        [INLINE_MEDIA_CONTENT_KEY]: { 'https://example/img': validFile('mxc://a/b') },
      })
    ).toBeUndefined();
  });

  it('reads valid v2 entries and marks mismatched or malformed mxc entries as null', () => {
    const map = readInlineMedia({
      [INLINE_MEDIA_CONTENT_KEY]: {
        'mxc://ex/ok': validFile('mxc://ex/ok'),
        'mxc://ex/mismatch': validFile('mxc://ex/other'),
        'mxc://ex/bad-v': validFile('mxc://ex/bad-v', { v: 'v1' }),
        'mxc://ex/empty-iv': validFile('mxc://ex/empty-iv', { iv: '' }),
        'mxc://ex/bad-shape': 'not-an-object',
      },
    });
    expect(map?.size).toBe(5);
    expect(map?.get('mxc://ex/ok')).toEqual({
      file: {
        url: 'mxc://ex/ok',
        v: 'v2',
        key: {
          kty: 'oct',
          key_ops: ['encrypt', 'decrypt'],
          alg: 'A256CTR',
          k: 'secret-key',
          ext: true,
        },
        iv: 'iv-base64',
        hashes: { sha256: 'hash-base64' },
        mimetype: 'image/png',
      },
      mimeType: 'image/png',
      size: 1024,
    });
    expect(map?.get('mxc://ex/mismatch')).toBeNull();
    expect(map?.get('mxc://ex/bad-v')).toBeNull();
    expect(map?.get('mxc://ex/empty-iv')).toBeNull();
    expect(map?.get('mxc://ex/bad-shape')).toBeNull();
  });

  it('caps the number of parsed entries at MAX_INLINE_MEDIA_ENTRIES', () => {
    const raw: Record<string, unknown> = {};
    for (let i = 0; i < MAX_INLINE_MEDIA_ENTRIES + 5; i += 1) {
      const mxc = `mxc://ex/img-${i}`;
      raw[mxc] = validFile(mxc);
    }
    const map = readInlineMedia({ [INLINE_MEDIA_CONTENT_KEY]: raw });
    expect(map?.size).toBe(MAX_INLINE_MEDIA_ENTRIES);
  });
});
