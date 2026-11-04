import { describe, expect, it } from 'vitest';
import { isExportPasswordLongEnough, MIN_EXPORT_PASSWORD_LENGTH } from './exportPassword';

describe('isExportPasswordLongEnough', () => {
  it('refuses a password too short to protect every room key in the export', () => {
    expect(MIN_EXPORT_PASSWORD_LENGTH).toBe(12);
    expect(isExportPasswordLongEnough('')).toBe(false);
    expect(isExportPasswordLongEnough('a')).toBe(false);
    expect(isExportPasswordLongEnough('elevenchars')).toBe(false);
    expect(isExportPasswordLongEnough('twelve chars')).toBe(true);
  });

  it('counts characters, not UTF-16 units', () => {
    expect(isExportPasswordLongEnough('🔑'.repeat(6))).toBe(false);
    expect(isExportPasswordLongEnough('🔑'.repeat(12))).toBe(true);
  });
});
