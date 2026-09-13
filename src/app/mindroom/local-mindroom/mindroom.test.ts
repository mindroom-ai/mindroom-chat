import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MINDROOM_DOCS_URL,
  getConnectionRevokedAt,
  getMindroomDocsUrl,
  getMindroomPairingCommand,
  getPairingSecondsRemaining,
  getWelcomeSetupFirstSeenStorageKey,
  isConnectionRevoked,
  resolveMindroomProvisioningRequest,
  shouldShowWelcomeSetupPrompt,
} from './mindroom';

describe('local mindroom helpers', () => {
  it('falls back to default docs url when value is empty', () => {
    expect(getMindroomDocsUrl('   ')).toBe(DEFAULT_MINDROOM_DOCS_URL);
  });

  it('builds expected pairing command', () => {
    expect(getMindroomPairingCommand('ABC123')).toBe('uvx mindroom connect --pair-code ABC123');
  });

  it('returns 0 seconds for expired pairing windows', () => {
    const nowMs = Date.parse('2026-02-27T12:00:00.000Z');
    expect(getPairingSecondsRemaining('2026-02-27T11:59:59.000Z', nowMs)).toBe(0);
  });

  it('uses active session homeserver origin for provisioning by default', () => {
    const result = resolveMindroomProvisioningRequest({
      sessionHomeserverUrl: 'https://matrix.example.org',
      accessToken: 'session-token',
    });

    expect(result).toEqual({
      provisioningBaseUrl: 'https://matrix.example.org',
      accessToken: 'session-token',
    });
    expect(result.provisioningBaseUrl).not.toBe('https://mindroom.chat');
  });

  it('does not forward token to mismatched override origin by default', () => {
    const result = resolveMindroomProvisioningRequest({
      sessionHomeserverUrl: 'https://matrix.example.org',
      provisioningOverrideUrl: 'https://provisioning.other.example',
      accessToken: 'session-token',
    });

    expect(result.provisioningBaseUrl).toBe('https://provisioning.other.example');
    expect(result.accessToken).toBeUndefined();
    expect(result.warning).toContain('Access token forwarding is blocked by default');
  });

  it('forwards token when provisioning origin matches session homeserver origin', () => {
    const result = resolveMindroomProvisioningRequest({
      sessionHomeserverUrl: 'https://matrix.example.org',
      provisioningOverrideUrl: 'https://matrix.example.org',
      accessToken: 'session-token',
    });

    expect(result).toEqual({
      provisioningBaseUrl: 'https://matrix.example.org',
      accessToken: 'session-token',
    });
  });

  it('reads revoked timestamp from snake_case responses', () => {
    expect(getConnectionRevokedAt({ revoked_at: '2026-02-28T12:00:00.000Z' })).toBe(
      '2026-02-28T12:00:00.000Z'
    );
    expect(isConnectionRevoked({ revoked_at: '2026-02-28T12:00:00.000Z' })).toBe(true);
  });

  it('reads revoked timestamp from camelCase responses', () => {
    expect(getConnectionRevokedAt({ revokedAt: '2026-02-28T12:00:00.000Z' })).toBe(
      '2026-02-28T12:00:00.000Z'
    );
    expect(isConnectionRevoked({ revokedAt: '2026-02-28T12:00:00.000Z' })).toBe(true);
  });

  it('treats active connections as not revoked', () => {
    expect(getConnectionRevokedAt({ id: 'conn-1' })).toBeUndefined();
    expect(isConnectionRevoked({ id: 'conn-1' })).toBe(false);
  });

  it('scopes welcome setup prompt first-seen storage by user id', () => {
    expect(getWelcomeSetupFirstSeenStorageKey('@alice:mindroom.chat')).toBe(
      'mindroom_welcome_setup_first_seen_at::@alice:mindroom.chat'
    );
  });

  it('shows welcome setup prompt only after one day without active connections', () => {
    const firstSeenAtMs = Date.parse('2026-05-13T12:00:00.000Z');

    expect(
      shouldShowWelcomeSetupPrompt({
        activeConnectionCount: 0,
        firstSeenAtMs,
        nowMs: Date.parse('2026-05-14T12:00:00.000Z'),
      })
    ).toBe(true);
    expect(
      shouldShowWelcomeSetupPrompt({
        activeConnectionCount: 0,
        firstSeenAtMs,
        nowMs: Date.parse('2026-05-14T11:59:59.000Z'),
      })
    ).toBe(false);
    expect(
      shouldShowWelcomeSetupPrompt({
        activeConnectionCount: 1,
        firstSeenAtMs,
        nowMs: Date.parse('2026-05-15T12:00:00.000Z'),
      })
    ).toBe(false);
    expect(
      shouldShowWelcomeSetupPrompt({
        activeConnectionCount: 0,
        firstSeenAtMs: undefined,
        nowMs: Date.parse('2026-05-15T12:00:00.000Z'),
      })
    ).toBe(false);
  });
});
