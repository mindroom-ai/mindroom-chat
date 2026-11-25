import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DESKTOP_DISCONNECT_CONFIRMED_EVENT,
  DESKTOP_DISCONNECT_REQUEST_EVENT,
  DESKTOP_MAC_DEVICES_ACCOUNT_DATA,
  DESKTOP_PAIRING_CONFIRMED_EVENT,
  DESKTOP_PAIRING_CONFIRM_EVENT,
  DESKTOP_PAIR_INVITE_CONFIRMED_EVENT,
  DESKTOP_PAIR_INVITE_EVENT,
  DESKTOP_PAIR_INVITE_RESULT_EVENT,
  DESKTOP_SETUP_OFFER_EVENT,
  DESKTOP_SETUP_REQUEST_EVENT,
  controllerKeyOf,
  createPairingNonce,
  derivePairInviteSas,
  parseDesktopDisconnectConfirmed,
  parseDesktopDisconnectRequest,
  parseDesktopPairInvite,
  parseDesktopPairInviteConfirmed,
  parseDesktopPairInviteResult,
  parseDesktopPairingConfirm,
  parseDesktopPairingConfirmed,
  parseDesktopSetupOffer,
  parseDesktopSetupRequest,
  parseMacDevicesAccountData,
} from './desktopPairingProtocol';

const VALID_NONCE = 'abcdef0123456789abcdef0123456789';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('desktopPairingProtocol constants and helpers', () => {
  it('defines exact wire event type constants', () => {
    expect(DESKTOP_SETUP_REQUEST_EVENT).toBe('io.mindroom.desktop.setup_request.v1');
    expect(DESKTOP_SETUP_OFFER_EVENT).toBe('io.mindroom.desktop.setup_offer.v1');
    expect(DESKTOP_PAIRING_CONFIRM_EVENT).toBe('io.mindroom.desktop.pairing_confirm.v1');
    expect(DESKTOP_PAIRING_CONFIRMED_EVENT).toBe('io.mindroom.desktop.pairing_confirmed.v1');
    expect(DESKTOP_DISCONNECT_REQUEST_EVENT).toBe('io.mindroom.desktop.disconnect_request.v1');
    expect(DESKTOP_DISCONNECT_CONFIRMED_EVENT).toBe('io.mindroom.desktop.disconnect_confirmed.v1');
    expect(DESKTOP_MAC_DEVICES_ACCOUNT_DATA).toBe('io.mindroom.desktop.mac_devices');
    expect(DESKTOP_PAIR_INVITE_EVENT).toBe('io.mindroom.desktop.pair_invite.v1');
    expect(DESKTOP_PAIR_INVITE_RESULT_EVENT).toBe('io.mindroom.desktop.pair_invite_result.v1');
    expect(DESKTOP_PAIR_INVITE_CONFIRMED_EVENT).toBe(
      'io.mindroom.desktop.pair_invite_confirmed.v1'
    );
  });

  it('creates unique 32-char non-blank pairing nonces', () => {
    const a = createPairingNonce();
    const b = createPairingNonce();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(b).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });

  it('matches Python controller_journal_key formatting verbatim', () => {
    expect(
      controllerKeyOf({
        user_id: '@mindroom_general:mindroom.chat',
        device_id: 'DEV123',
        ed25519: 'ed25519Key+/=',
      })
    ).toBe('["@mindroom_general:mindroom.chat", "DEV123", "ed25519Key+/="]');

    expect(
      controllerKeyOf({
        user_id: '@u\u0080:example.org',
        device_id: 'a"b\\c',
        ed25519: '\x7f',
      })
    ).toBe('["@u\\u0080:example.org", "a\\"b\\\\c", "\\u007f"]');
  });

  it('derives deterministic 6-digit SAS matching SHA-256 with and without crypto.subtle', async () => {
    const expectedDigest = createHash('sha256')
      .update(`${VALID_NONCE}\0code-123\0BROWSER_DEV`)
      .digest();
    const expectedNum = expectedDigest.readUInt32BE(0) % 1_000_000;
    const expectedSas = String(expectedNum).padStart(6, '0');

    const withSubtle = await derivePairInviteSas(VALID_NONCE, 'code-123', 'BROWSER_DEV');
    expect(withSubtle).toBe(expectedSas);
    expect(withSubtle).toMatch(/^\d{6}$/);

    // Distinct inputs (including shifted boundaries) produce distinct SAS values.
    const shifted = await derivePairInviteSas(`${VALID_NONCE}c`, 'ode-123', 'BROWSER_DEV');
    expect(shifted).not.toBe(withSubtle);

    // Pure-JS SHA-256 fallback produces the exact same digest when crypto.subtle is unavailable.
    vi.stubGlobal('crypto', {
      getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
    });
    const withoutSubtle = await derivePairInviteSas(VALID_NONCE, 'code-123', 'BROWSER_DEV');
    expect(withoutSubtle).toBe(expectedSas);
  });
});

describe('Phase 1 backend Olm event parsers', () => {
  it('parses valid setup_request.v1 and rejects invalid version or nonce', () => {
    expect(parseDesktopSetupRequest({ v: 1, nonce: VALID_NONCE, agent_name: 'general' })).toEqual({
      v: 1,
      nonce: VALID_NONCE,
      agent_name: 'general',
    });

    expect(
      parseDesktopSetupRequest({ v: 2, nonce: VALID_NONCE, agent_name: 'general' })
    ).toBeNull();
    expect(parseDesktopSetupRequest({ v: 1, nonce: 'short', agent_name: 'general' })).toBeNull();
    expect(
      parseDesktopSetupRequest({ v: 1, nonce: `${VALID_NONCE} space`, agent_name: 'general' })
    ).toBeNull();
    expect(parseDesktopSetupRequest({ v: 1, nonce: VALID_NONCE, agent_name: '  ' })).toBeNull();
  });

  it('parses eligible and ineligible setup_offer.v1 enforcing backend invariants', () => {
    expect(
      parseDesktopSetupOffer({
        v: 1,
        nonce: VALID_NONCE,
        agent_name: 'general',
        eligible: true,
        homeserver: 'https://mindroom.chat',
        user_id: '@bas:mindroom.chat',
        code: 'pair-token-xyz',
        cloudflare_access: false,
      })
    ).toEqual({
      v: 1,
      nonce: VALID_NONCE,
      agent_name: 'general',
      eligible: true,
      homeserver: 'https://mindroom.chat',
      user_id: '@bas:mindroom.chat',
      code: 'pair-token-xyz',
      cloudflare_access: false,
      error: null,
    });

    // Localhost HTTP homeserver and omitted cloudflare_access default to false.
    expect(
      parseDesktopSetupOffer({
        v: 1,
        nonce: VALID_NONCE,
        agent_name: 'general',
        eligible: true,
        homeserver: 'http://127.0.0.1:8008',
        user_id: '@bas:localhost',
        code: 'pair-token-xyz',
      })
    ).toMatchObject({ eligible: true, cloudflare_access: false });

    // Ineligible offer omits code/homeserver/user_id and carries error.
    expect(
      parseDesktopSetupOffer({
        v: 1,
        nonce: VALID_NONCE,
        agent_name: 'general',
        eligible: false,
        cloudflare_access: false,
        error: 'Desktop tool is disabled for this agent.',
      })
    ).toEqual({
      v: 1,
      nonce: VALID_NONCE,
      agent_name: 'general',
      eligible: false,
      homeserver: null,
      user_id: null,
      code: null,
      cloudflare_access: false,
      error: 'Desktop tool is disabled for this agent.',
    });

    // Reject invariant violations:
    // 1. Eligible with error
    expect(
      parseDesktopSetupOffer({
        v: 1,
        nonce: VALID_NONCE,
        agent_name: 'general',
        eligible: true,
        homeserver: 'https://mindroom.chat',
        user_id: '@bas:mindroom.chat',
        code: 'abc',
        error: 'unexpected',
      })
    ).toBeNull();
    // 2. Eligible with plain remote HTTP or userinfo '@' in homeserver
    expect(
      parseDesktopSetupOffer({
        v: 1,
        nonce: VALID_NONCE,
        agent_name: 'general',
        eligible: true,
        homeserver: 'http://evil.example.com',
        user_id: '@bas:mindroom.chat',
        code: 'abc',
      })
    ).toBeNull();
    expect(
      parseDesktopSetupOffer({
        v: 1,
        nonce: VALID_NONCE,
        agent_name: 'general',
        eligible: true,
        homeserver: 'https://mindroom.chat@evil.example.com',
        user_id: '@bas:mindroom.chat',
        code: 'abc',
      })
    ).toBeNull();
    // 3. Ineligible without error or with code present
    expect(
      parseDesktopSetupOffer({
        v: 1,
        nonce: VALID_NONCE,
        agent_name: 'general',
        eligible: false,
      })
    ).toBeNull();
    expect(
      parseDesktopSetupOffer({
        v: 1,
        nonce: VALID_NONCE,
        agent_name: 'general',
        eligible: false,
        code: 'leaked',
        error: 'Denied.',
      })
    ).toBeNull();
  });

  it('parses pairing_confirm.v1, pairing_confirmed.v1, disconnect_request.v1, and disconnect_confirmed.v1', () => {
    expect(
      parseDesktopPairingConfirm({
        v: 1,
        nonce: VALID_NONCE,
        token: 'tok-1',
        verification: 'ABCD1234EFGH5678',
        device_id: 'HELPER_DEV',
        device_ed25519: 'helper-ed25519',
      })
    ).toEqual({
      v: 1,
      nonce: VALID_NONCE,
      token: 'tok-1',
      verification: 'ABCD1234EFGH5678',
      device_id: 'HELPER_DEV',
      device_ed25519: 'helper-ed25519',
    });
    expect(
      parseDesktopPairingConfirm({
        v: 1,
        nonce: VALID_NONCE,
        token: '',
        verification: 'ABCD',
        device_id: 'D',
        device_ed25519: 'K',
      })
    ).toBeNull();

    expect(
      parseDesktopPairingConfirmed({ v: 1, nonce: VALID_NONCE, agent_name: 'general', ok: true })
    ).toEqual({ v: 1, nonce: VALID_NONCE, agent_name: 'general', ok: true, error: null });
    expect(
      parseDesktopPairingConfirmed({
        v: 1,
        nonce: VALID_NONCE,
        agent_name: 'general',
        ok: false,
        error: 'Token expired.',
      })
    ).toEqual({
      v: 1,
      nonce: VALID_NONCE,
      agent_name: 'general',
      ok: false,
      error: 'Token expired.',
    });
    expect(
      parseDesktopPairingConfirmed({
        v: 1,
        nonce: VALID_NONCE,
        agent_name: 'general',
        ok: true,
        error: 'nope',
      })
    ).toBeNull();
    expect(
      parseDesktopPairingConfirmed({ v: 1, nonce: VALID_NONCE, agent_name: 'general', ok: false })
    ).toBeNull();

    expect(
      parseDesktopDisconnectRequest({ v: 1, nonce: VALID_NONCE, agent_name: 'general' })
    ).toEqual({ v: 1, nonce: VALID_NONCE, agent_name: 'general' });
    expect(
      parseDesktopDisconnectConfirmed({ v: 1, nonce: VALID_NONCE, agent_name: 'general', ok: true })
    ).toEqual({ v: 1, nonce: VALID_NONCE, agent_name: 'general', ok: true, error: null });
    expect(
      parseDesktopDisconnectConfirmed({
        v: 1,
        nonce: VALID_NONCE,
        agent_name: 'general',
        ok: false,
        error: 'Not paired.',
      })
    ).toEqual({
      v: 1,
      nonce: VALID_NONCE,
      agent_name: 'general',
      ok: false,
      error: 'Not paired.',
    });
  });
});

describe('Browser-to-Mac relay and mac_devices parsers', () => {
  it('parses valid mac_devices account data and rejects malformed entries', () => {
    expect(
      parseMacDevicesAccountData({
        v: 1,
        devices: [{ device_id: 'MAC1', label: 'MacBook Pro', updated_at: 1_700_000_000_000 }],
      })
    ).toEqual({
      v: 1,
      devices: [{ device_id: 'MAC1', label: 'MacBook Pro', updated_at: 1_700_000_000_000 }],
    });

    expect(parseMacDevicesAccountData({ v: 2, devices: [] })).toBeNull();
    expect(
      parseMacDevicesAccountData({
        v: 1,
        devices: [{ device_id: 'MAC1', label: 'Mac', updated_at: Number.NaN }],
      })
    ).toBeNull();
  });

  it('parses valid pair_invite.v1, pair_invite_result.v1, and pair_invite_confirmed.v1', () => {
    const validInvite = {
      v: 1,
      nonce: VALID_NONCE,
      agent_name: 'general',
      agent_user_id: '@mindroom_general:mindroom.chat',
      controller: {
        user_id: '@mindroom_general:mindroom.chat',
        device_id: 'AGENT_DEV',
        ed25519: 'agent-ed25519',
      },
      homeserver: 'https://mindroom.chat',
      user_id: '@bas:mindroom.chat',
      code: 'pair-code-123',
      cloudflare_access: false,
      requester_label: 'Safari on macOS',
      sas_code: '042918',
    };
    expect(parseDesktopPairInvite(validInvite)).toEqual(validInvite);
    expect(parseDesktopPairInvite({ ...validInvite, sas_code: '12345' })).toBeNull();
    expect(parseDesktopPairInvite({ ...validInvite, homeserver: 'http://evil.test' })).toBeNull();

    expect(
      parseDesktopPairInviteResult({
        v: 1,
        nonce: VALID_NONCE,
        ok: true,
        device_id: 'HELPER_DEV',
        device_ed25519: 'helper-ed',
        verification: 'ABCD1234',
      })
    ).toEqual({
      v: 1,
      nonce: VALID_NONCE,
      ok: true,
      device_id: 'HELPER_DEV',
      device_ed25519: 'helper-ed',
      verification: 'ABCD1234',
      error: null,
    });
    expect(
      parseDesktopPairInviteResult({ v: 1, nonce: VALID_NONCE, ok: true, device_id: 'HELPER_DEV' })
    ).toBeNull();
    expect(
      parseDesktopPairInviteResult({
        v: 1,
        nonce: VALID_NONCE,
        ok: false,
        error: 'Declined on Mac.',
      })
    ).toEqual({
      v: 1,
      nonce: VALID_NONCE,
      ok: false,
      error: 'Declined on Mac.',
    });

    expect(parseDesktopPairInviteConfirmed({ v: 1, nonce: VALID_NONCE, ok: true })).toEqual({
      v: 1,
      nonce: VALID_NONCE,
      ok: true,
      error: null,
    });
    expect(
      parseDesktopPairInviteConfirmed({
        v: 1,
        nonce: VALID_NONCE,
        ok: false,
        error: 'Confirmation rejected.',
      })
    ).toEqual({
      v: 1,
      nonce: VALID_NONCE,
      ok: false,
      error: 'Confirmation rejected.',
    });
    expect(parseDesktopPairInviteConfirmed({ v: 1, nonce: VALID_NONCE, ok: false })).toBeNull();
  });
});
