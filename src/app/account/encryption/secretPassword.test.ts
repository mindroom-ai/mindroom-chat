import { describe, expect, it } from 'vitest';
import { isSecretPasswordLongEnough, MIN_SECRET_PASSWORD_LENGTH } from './secretPassword';

describe('isSecretPasswordLongEnough', () => {
  it('refuses a password too short to protect every room key in the export', () => {
    expect(MIN_SECRET_PASSWORD_LENGTH).toBe(12);
    expect(isSecretPasswordLongEnough('')).toBe(false);
    expect(isSecretPasswordLongEnough('a')).toBe(false);
    expect(isSecretPasswordLongEnough('elevenchars')).toBe(false);
    expect(isSecretPasswordLongEnough('twelvechars!')).toBe(true);
  });

  it('counts characters, not UTF-16 units', () => {
    expect(isSecretPasswordLongEnough('🔑'.repeat(6))).toBe(false);
    expect(isSecretPasswordLongEnough('🔑'.repeat(12))).toBe(true);
  });

  it('leaves out spaces and invisible characters', () => {
    expect(isSecretPasswordLongEnough(' '.repeat(12))).toBe(false);
    expect(isSecretPasswordLongEnough(' '.repeat(40))).toBe(false);
    // Eleven letters padded with spaces, tabs, a no-break space and an ideographic space.
    expect(isSecretPasswordLongEnough(' eleven\tchars 　 ')).toBe(false);
    // Zero-width space, zero-width joiner, word joiner, byte order mark.
    expect(isSecretPasswordLongEnough('elevenchars​‍⁠﻿')).toBe(false);
    expect(isSecretPasswordLongEnough('twelve chars')).toBe(false);
    expect(isSecretPasswordLongEnough('twelve chars!')).toBe(true);
  });
});
