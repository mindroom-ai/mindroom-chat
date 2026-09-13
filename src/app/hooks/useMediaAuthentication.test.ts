import { describe, expect, it } from 'vitest';
import {
  hasMediaAuthTransportSupport,
  shouldUseMediaAuthentication,
} from './useMediaAuthentication';

describe('shouldUseMediaAuthentication', () => {
  it('returns false when spec supports authenticated media but service worker is disabled', () => {
    expect(
      shouldUseMediaAuthentication(
        {
          versions: ['v1.11'],
        },
        false
      )
    ).toBe(false);
  });

  it('returns true when spec supports authenticated media and service worker is enabled', () => {
    expect(
      shouldUseMediaAuthentication(
        {
          versions: ['v1.11'],
        },
        true
      )
    ).toBe(true);
  });

  it('returns true when service worker is unavailable but Capacitor transport fallback is available', () => {
    expect(hasMediaAuthTransportSupport(false, true)).toBe(true);
    expect(
      shouldUseMediaAuthentication(
        {
          versions: ['v1.11'],
        },
        true
      )
    ).toBe(true);
  });
});
