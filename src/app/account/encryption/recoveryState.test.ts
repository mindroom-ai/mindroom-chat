import { describe, expect, it } from 'vitest';
import type { SecretStorageKeyTuple } from 'matrix-js-sdk/lib/secret-storage';
import type { OwnDeviceTrust } from '../verification/useOwnDeviceTrust';
import { classifyRecovery } from './recoveryState';

const trust = (crossSigning: boolean, thisDeviceVerified = false): OwnDeviceTrust => ({
  crossSigning,
  thisDeviceVerified,
  otherDevices: new Map(),
});
const withPassphrase = [
  'KEY',
  { algorithm: 'a', passphrase: { algorithm: 'm.pbkdf2' } },
] as unknown as SecretStorageKeyTuple;
const withoutPassphrase = ['KEY', { algorithm: 'a' }] as unknown as SecretStorageKeyTuple;

describe('classifyRecovery', () => {
  it('is unknown while trust is unread', () => {
    expect(classifyRecovery({ trust: undefined, defaultKey: null, backup: 'absent' })).toEqual({
      kind: 'unknown',
    });
  });
  it('is unknown while the default key is unread', () => {
    expect(
      classifyRecovery({ trust: trust(false), defaultKey: undefined, backup: 'absent' })
    ).toEqual({ kind: 'unknown' });
  });
  it('is ready with no key when this device is verified and the account has no key', () => {
    expect(
      classifyRecovery({ trust: trust(true, true), defaultKey: null, backup: 'unknown' })
    ).toEqual({ kind: 'ready', key: null });
  });
  it('is ready with the key when this device is verified', () => {
    expect(
      classifyRecovery({ trust: trust(true, true), defaultKey: withPassphrase, backup: 'present' })
    ).toEqual({
      kind: 'ready',
      key: { keyId: 'KEY', keyContent: withPassphrase[1], hasPassphrase: true },
    });
  });
  it('is locked with a password when cross-signing and a passphrase key exist', () => {
    expect(
      classifyRecovery({ trust: trust(true), defaultKey: withPassphrase, backup: 'present' })
    ).toMatchObject({
      kind: 'locked',
      key: { keyId: 'KEY', hasPassphrase: true },
    });
  });
  it('is locked without a password when the key has no passphrase', () => {
    expect(
      classifyRecovery({ trust: trust(true), defaultKey: withoutPassphrase, backup: 'absent' })
    ).toMatchObject({
      kind: 'locked',
      key: { hasPassphrase: false },
    });
  });
  it('is unknown when backup is unknown and nothing else decides', () => {
    expect(classifyRecovery({ trust: trust(false), defaultKey: null, backup: 'unknown' })).toEqual({
      kind: 'unknown',
    });
  });
  it('is none without cross-signing, key or backup', () => {
    expect(classifyRecovery({ trust: trust(false), defaultKey: null, backup: 'absent' })).toEqual({
      kind: 'none',
    });
  });
  it('is other with cross-signing but no key', () => {
    expect(classifyRecovery({ trust: trust(true), defaultKey: null, backup: 'absent' })).toEqual({
      kind: 'other',
    });
  });
  it('is other with a key but no cross-signing', () => {
    expect(
      classifyRecovery({ trust: trust(false), defaultKey: withPassphrase, backup: 'absent' })
    ).toEqual({ kind: 'other' });
  });
  it('is other with no cross-signing or key but a backup', () => {
    expect(classifyRecovery({ trust: trust(false), defaultKey: null, backup: 'present' })).toEqual({
      kind: 'other',
    });
  });
});
