import { describe, expect, it } from 'vitest';
import { AutoDiscoveryInfo } from '../cs-api';
import { getLivekitServiceUrl, livekitSupport } from './useLivekitSupport';

const discoveryWithFocus = (livekitServiceUrl: string): AutoDiscoveryInfo => ({
  'm.homeserver': {
    base_url: 'https://matrix.example.com',
  },
  'org.matrix.msc4143.rtc_foci': [
    {
      type: 'livekit',
      livekit_service_url: livekitServiceUrl,
    },
  ],
});

describe('getLivekitServiceUrl', () => {
  it('returns a secure configured endpoint', () => {
    const discovery = discoveryWithFocus('https://rtc.example.com/jwt');

    expect(getLivekitServiceUrl(discovery)).toBe('https://rtc.example.com/jwt');
    expect(livekitSupport(discovery)).toBe(true);
  });

  it('rejects an insecure public endpoint', () => {
    const discovery = discoveryWithFocus('http://rtc.example.com/jwt');

    expect(getLivekitServiceUrl(discovery)).toBeUndefined();
    expect(livekitSupport(discovery)).toBe(false);
  });

  it('allows a local development endpoint', () => {
    expect(getLivekitServiceUrl(discoveryWithFocus('http://localhost:7880/jwt'))).toBe(
      'http://localhost:7880/jwt'
    );
  });

  it('ignores malformed focus entries', () => {
    const discovery = {
      'm.homeserver': { base_url: 'https://matrix.example.com' },
      'org.matrix.msc4143.rtc_foci': [null, 'invalid'],
    } as unknown as AutoDiscoveryInfo;

    expect(getLivekitServiceUrl(discovery)).toBeUndefined();
    expect(livekitSupport(discovery)).toBe(false);
  });
});
