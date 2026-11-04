import { describe, expect, it } from 'vitest';
import { isExportPasswordLongEnough, MIN_EXPORT_PASSWORD_LENGTH } from './exportPassword';

describe('isExportPasswordLongEnough', () => {
  it('refuses a password too short to protect every room key in the export', () => {
    expect(MIN_EXPORT_PASSWORD_LENGTH).toBe(12);
    expect(isExportPasswordLongEnough('')).toBe(false);
    expect(isExportPasswordLongEnough('a')).toBe(false);
    expect(isExportPasswordLongEnough('elevenchars')).toBe(false);
    expect(isExportPasswordLongEnough('twelvechars!')).toBe(true);
  });

  it('counts characters, not UTF-16 units', () => {
    expect(isExportPasswordLongEnough('🔑'.repeat(6))).toBe(false);
    expect(isExportPasswordLongEnough('🔑'.repeat(12))).toBe(true);
  });

  it('leaves out spaces and invisible characters', () => {
    expect(isExportPasswordLongEnough(' '.repeat(12))).toBe(false);
    expect(isExportPasswordLongEnough(' '.repeat(40))).toBe(false);
    // Eleven letters padded with spaces, tabs, a no-break space and an ideographic space.
    expect(isExportPasswordLongEnough(' eleven\tchars 　 ')).toBe(false);
    // Zero-width space, zero-width joiner, word joiner, byte order mark.
    expect(isExportPasswordLongEnough('elevenchars​‍⁠﻿')).toBe(false);
    expect(isExportPasswordLongEnough('twelve chars')).toBe(false);
    expect(isExportPasswordLongEnough('twelve chars!')).toBe(true);
  });
});
