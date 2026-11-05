import { describe, expect, it } from 'vitest';
import { createClient } from 'matrix-js-sdk';
import { authenticatedMediaRequestInit } from './mediaUrl';

// The access token goes only to the homeserver's own authenticated media endpoints: the media path
// must start right after the homeserver's base path, as the service worker requires.
describe('authenticatedMediaRequestInit path matching', () => {
  const header = { headers: { Authorization: 'Bearer test-token' } };

  it('adds no header when the media path appears later in the URL path', () => {
    const mx = createClient({
      baseUrl: 'https://matrix.example.org',
      userId: '@alice:example.org',
      accessToken: 'test-token',
    });
    expect(
      authenticatedMediaRequestInit(
        mx,
        'https://matrix.example.org/uploads/_matrix/client/v1/media/download/example.org/media'
      )
    ).toBeUndefined();
  });

  it('matches only under the base path of a homeserver served under a path', () => {
    const mx = createClient({
      baseUrl: 'https://example.org/matrix/',
      userId: '@alice:example.org',
      accessToken: 'test-token',
    });
    expect(
      authenticatedMediaRequestInit(
        mx,
        'https://example.org/matrix/_matrix/client/v1/media/thumbnail/example.org/media'
      )
    ).toEqual(header);
    expect(
      authenticatedMediaRequestInit(
        mx,
        'https://example.org/_matrix/client/v1/media/download/example.org/media'
      )
    ).toBeUndefined();
    expect(
      authenticatedMediaRequestInit(
        mx,
        'https://example.org/other/matrix/_matrix/client/v1/media/download/example.org/media'
      )
    ).toBeUndefined();
  });

  it('adds no header for another origin', () => {
    const mx = createClient({
      baseUrl: 'https://matrix.example.org',
      userId: '@alice:example.org',
      accessToken: 'test-token',
    });
    expect(
      authenticatedMediaRequestInit(
        mx,
        'https://evil.example/_matrix/client/v1/media/download/example.org/media'
      )
    ).toBeUndefined();
  });
});
