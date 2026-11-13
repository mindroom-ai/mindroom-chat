// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ app: false }));
vi.mock('../../native/nativeSso', () => ({ isNativeApp: () => native.app }));

import {
  claimSsoLogin,
  createSsoNonce,
  rememberIssuedLoginToken,
  rememberSsoAttempt,
  SSO_ATTEMPT_LIFETIME_MS,
  SSO_NONCE_PARAM,
  withSsoNonce,
} from './ssoReturn';

const HOMESERVER = 'https://matrix.example.org';

describe('withSsoNonce', () => {
  it('adds the nonce to the query of a browser return address, keeping add-account', () => {
    expect(withSsoNonce('https://chat.example/login/example.org/?addAccount=1', 'n1')).toBe(
      `https://chat.example/login/example.org/?addAccount=1&${SSO_NONCE_PARAM}=n1`
    );
    expect(withSsoNonce('https://chat.example/login/example.org/', 'n1')).toBe(
      `https://chat.example/login/example.org/?${SSO_NONCE_PARAM}=n1`
    );
  });

  it('puts it in the route of a hash router address, where the login page reads it', () => {
    expect(withSsoNonce('https://chat.example/#/login/example.org/?addAccount=1', 'n1')).toBe(
      `https://chat.example/#/login/example.org/?addAccount=1&${SSO_NONCE_PARAM}=n1`
    );
  });

  it('works for the native app address', () => {
    expect(withSsoNonce('mindroom://auth/login/example.org', 'n1')).toBe(
      `mindroom://auth/login/example.org?${SSO_NONCE_PARAM}=n1`
    );
  });
});

describe('createSsoNonce', () => {
  it('is random and long enough not to be guessed', () => {
    const nonces = new Set(Array.from({ length: 20 }, createSsoNonce));
    expect(nonces.size).toBe(20);
    nonces.forEach((nonce) => expect(nonce).toMatch(/^[0-9a-f]{32}$/));
  });
});

describe('claimSsoLogin', () => {
  beforeEach(() => {
    native.app = false;
    sessionStorage.clear();
    localStorage.clear();
  });
  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('refuses a token that no sign-in from this tab asked for', () => {
    expect(claimSsoLogin('token', null)).toBeUndefined();
    expect(claimSsoLogin('token', 'guessed-nonce')).toBeUndefined();
  });

  it('refuses a token whose nonce belongs to no sign-in started here', () => {
    rememberSsoAttempt('real-nonce', HOMESERVER);
    expect(claimSsoLogin('token', 'other-nonce')).toBeUndefined();
    expect(claimSsoLogin('token', null)).toBeUndefined();
  });

  it('gives the homeserver the sign-in went to, whatever server the address names', () => {
    rememberSsoAttempt('n1', HOMESERVER);
    expect(claimSsoLogin('token', 'n1')).toBe(HOMESERVER);
  });

  it('lets each sign-in return once', () => {
    rememberSsoAttempt('n1', HOMESERVER);
    expect(claimSsoLogin('token', 'n1')).toBe(HOMESERVER);
    expect(claimSsoLogin('token-2', 'n1')).toBeUndefined();
  });

  it('refuses a return after the sign-in lifetime', () => {
    rememberSsoAttempt('n1', HOMESERVER, 1_000);
    expect(claimSsoLogin('token', 'n1', 1_000 + SSO_ATTEMPT_LIFETIME_MS)).toBeUndefined();
  });

  it('keeps sign-ins of other pages apart', () => {
    rememberSsoAttempt('n1', HOMESERVER);
    rememberSsoAttempt('n2', 'https://other.example.net');
    expect(claimSsoLogin('token', 'n2')).toBe('https://other.example.net');
    expect(claimSsoLogin('token', 'n1')).toBe(HOMESERVER);
  });

  it('accepts a token the app received itself, only that token', () => {
    rememberIssuedLoginToken('issued', HOMESERVER);
    expect(claimSsoLogin('someone-elses', null)).toBeUndefined();
    expect(claimSsoLogin('issued', null)).toBe(HOMESERVER);
    expect(claimSsoLogin('issued', null)).toBeUndefined();
  });

  it('keeps the note in this tab on the web and in the app storage natively', () => {
    rememberSsoAttempt('web', HOMESERVER);
    expect(sessionStorage.length).toBe(1);
    expect(localStorage.length).toBe(0);

    native.app = true;
    rememberSsoAttempt('native', HOMESERVER);
    expect(localStorage.length).toBe(1);
    expect(claimSsoLogin('token', 'native')).toBe(HOMESERVER);
  });

  it('ignores a damaged note', () => {
    sessionStorage.setItem('mindroom_sso_attempts', '{not json');
    expect(claimSsoLogin('token', 'n1')).toBeUndefined();
    sessionStorage.setItem(
      'mindroom_sso_attempts',
      JSON.stringify([{ nonce: 'n1', baseUrl: 42, startedAt: Date.now() }])
    );
    expect(claimSsoLogin('token', 'n1')).toBeUndefined();
  });
});
