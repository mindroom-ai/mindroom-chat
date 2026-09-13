import { describe, expect, it } from 'vitest';
import { validMediaRequest } from './swMediaAuth';

describe('validMediaRequest', () => {
  it('accepts root media URLs when base URL has subpath', () => {
    expect(
      validMediaRequest(
        'https://example.com/_matrix/client/v1/media/download/server/mediaId',
        'https://example.com/mindroom'
      )
    ).toBe(true);
  });

  it('accepts subpath media URLs when base URL is root', () => {
    expect(
      validMediaRequest(
        'https://example.com/mindroom/_matrix/client/v1/media/thumbnail/server/mediaId',
        'https://example.com'
      )
    ).toBe(true);
  });

  it('rejects cross-origin media URLs', () => {
    expect(
      validMediaRequest(
        'https://evil.example/_matrix/client/v1/media/download/server/mediaId',
        'https://example.com/mindroom'
      )
    ).toBe(false);
  });
});
