import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MINDROOM_ACCOUNT_SETTINGS,
  mergeMindroomAccountSettings,
  sanitizeMindroomAccountSettings,
} from './mindroomAccountSettings';

describe('sanitizeMindroomAccountSettings', () => {
  it('falls back to defaults for non-object content', () => {
    expect(sanitizeMindroomAccountSettings(undefined)).toEqual(DEFAULT_MINDROOM_ACCOUNT_SETTINGS);
    expect(sanitizeMindroomAccountSettings(null)).toEqual(DEFAULT_MINDROOM_ACCOUNT_SETTINGS);
    expect(sanitizeMindroomAccountSettings('simple')).toEqual(DEFAULT_MINDROOM_ACCOUNT_SETTINGS);
    expect(sanitizeMindroomAccountSettings([true])).toEqual(DEFAULT_MINDROOM_ACCOUNT_SETTINGS);
  });

  it('defaults to the full interface', () => {
    expect(DEFAULT_MINDROOM_ACCOUNT_SETTINGS.simpleMode).toBe(false);
    expect(sanitizeMindroomAccountSettings({}).simpleMode).toBe(false);
  });

  it('enables simple mode only for a strict boolean true', () => {
    expect(sanitizeMindroomAccountSettings({ simpleMode: true }).simpleMode).toBe(true);
    expect(sanitizeMindroomAccountSettings({ simpleMode: false }).simpleMode).toBe(false);
    // Truthy garbage from another client must not strip the UI.
    expect(sanitizeMindroomAccountSettings({ simpleMode: 1 }).simpleMode).toBe(false);
    expect(sanitizeMindroomAccountSettings({ simpleMode: 'true' }).simpleMode).toBe(false);
  });

  it('ignores unknown keys when reading', () => {
    expect(sanitizeMindroomAccountSettings({ simpleMode: true, futureKey: 'x' })).toEqual({
      simpleMode: true,
    });
  });
});

describe('mergeMindroomAccountSettings', () => {
  it('overlays the patch onto stored content', () => {
    expect(mergeMindroomAccountSettings({ simpleMode: false }, { simpleMode: true })).toEqual({
      simpleMode: true,
    });
  });

  it('preserves unknown keys written by other clients', () => {
    expect(
      mergeMindroomAccountSettings({ simpleMode: false, futureKey: { nested: 1 } }, { simpleMode: true })
    ).toEqual({ simpleMode: true, futureKey: { nested: 1 } });
  });

  it('treats malformed stored content as empty', () => {
    expect(mergeMindroomAccountSettings(undefined, { simpleMode: true })).toEqual({
      simpleMode: true,
    });
    expect(mergeMindroomAccountSettings('garbage', { simpleMode: true })).toEqual({
      simpleMode: true,
    });
  });
});
