import { describe, expect, it, vi } from 'vitest';
import { ClientConfig, clientAutoDiscovery, clientConfiguredDiscovery } from './useClientConfig';

const configuredDiscovery = {
  'm.homeserver': {
    base_url: 'https://matrix.example.com',
  },
  'org.matrix.msc4143.rtc_foci': [
    {
      type: 'livekit' as const,
      livekit_service_url: 'https://rtc.example.com/jwt',
    },
  ],
};

const clientConfig: ClientConfig = {
  homeserverDiscovery: {
    'example.com': configuredDiscovery,
  },
};

describe('clientConfiguredDiscovery', () => {
  it('matches equivalent server names and URLs', () => {
    expect(clientConfiguredDiscovery(clientConfig, 'https://example.com/')).toBe(
      configuredDiscovery
    );
  });

  it('matches an active session by configured homeserver base URL', () => {
    expect(
      clientConfiguredDiscovery(
        clientConfig,
        'different.example.com',
        'https://matrix.example.com/'
      )
    ).toBe(configuredDiscovery);
  });

  it('does not apply configuration to an unrelated homeserver', () => {
    expect(clientConfiguredDiscovery(clientConfig, 'other.example.com')).toBeUndefined();
  });

  it('does not trust the server name over an active homeserver base URL', () => {
    expect(
      clientConfiguredDiscovery(clientConfig, 'example.com', 'https://other.example.com')
    ).toBeUndefined();
  });

  it('ignores a malformed configured entry while matching an active session', () => {
    const malformedConfig = {
      homeserverDiscovery: {
        'example.com': {},
      },
    } as unknown as ClientConfig;

    expect(() =>
      clientConfiguredDiscovery(malformedConfig, 'example.com', 'https://matrix.example.com')
    ).not.toThrow();
    expect(
      clientConfiguredDiscovery(malformedConfig, 'example.com', 'https://matrix.example.com')
    ).toBeUndefined();
  });
});

describe('clientAutoDiscovery', () => {
  it('uses matching client configuration without a network request', async () => {
    const request = vi.fn();

    const [, discovery] = await clientAutoDiscovery(
      clientConfig,
      request as unknown as typeof fetch,
      'example.com'
    );

    expect(discovery).toEqual(configuredDiscovery);
    expect(request).not.toHaveBeenCalled();
  });
});
