import { describe, expect, it } from 'vitest';
import { MAX_INLINE_MEDIA_ENTRIES, readInlineMedia } from './inlineMedia';

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
  it('returns undefined when absent, empty, or non-mxc', () => {
    expect(readInlineMedia(undefined)).toBeUndefined();
    expect(readInlineMedia({})).toBeUndefined();
    expect(readInlineMedia([])).toBeUndefined();
    expect(readInlineMedia({ 'https://ex/a': validFile('mxc://a/b') })).toBeUndefined();
  });

  it('validates v2 entries, rejects mismatched or malformed ones as null, and caps count', () => {
    const map = readInlineMedia({
      'mxc://ex/ok': validFile('mxc://ex/ok'),
      'mxc://ex/mismatch': validFile('mxc://ex/other'),
      'mxc://ex/bad-v': validFile('mxc://ex/bad-v', { v: 'v1' }),
      'mxc://ex/bad-shape': 'nope',
    });
    expect(map?.get('mxc://ex/ok')).toMatchObject({
      file: { url: 'mxc://ex/ok', v: 'v2', iv: 'iv-base64', hashes: { sha256: 'hash-base64' } },
      mimeType: 'image/png',
      size: 1024,
    });
    expect(map?.get('mxc://ex/mismatch')).toBeNull();
    expect(map?.get('mxc://ex/bad-v')).toBeNull();
    expect(map?.get('mxc://ex/bad-shape')).toBeNull();

    const many: Record<string, unknown> = {};
    for (let i = 0; i < MAX_INLINE_MEDIA_ENTRIES + 5; i += 1) {
      many[`mxc://ex/${i}`] = validFile(`mxc://ex/${i}`);
    }
    const capped = readInlineMedia(many)!;
    expect([...capped.values()].filter(Boolean)).toHaveLength(MAX_INLINE_MEDIA_ENTRIES);
    expect(capped.get(`mxc://ex/${MAX_INLINE_MEDIA_ENTRIES}`)).toBeNull();
  });
});
