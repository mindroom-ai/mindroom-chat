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

  it('defaults to Simple Mode while preserving explicit booleans', () => {
    expect(DEFAULT_MINDROOM_ACCOUNT_SETTINGS.simpleMode).toBe(true);
    expect(sanitizeMindroomAccountSettings({}).simpleMode).toBe(true);
    expect(sanitizeMindroomAccountSettings({ simpleMode: true }).simpleMode).toBe(true);
    expect(sanitizeMindroomAccountSettings({ simpleMode: false }).simpleMode).toBe(false);
    expect(sanitizeMindroomAccountSettings({ simpleMode: 1 }).simpleMode).toBe(true);
    expect(sanitizeMindroomAccountSettings({ simpleMode: 'false' }).simpleMode).toBe(true);
  });

  it('defaults long messages to expanded while preserving explicit booleans', () => {
    expect(DEFAULT_MINDROOM_ACCOUNT_SETTINGS.expandLongMessagesByDefault).toBe(true);
    expect(sanitizeMindroomAccountSettings({}).expandLongMessagesByDefault).toBe(true);
    expect(
      sanitizeMindroomAccountSettings({ expandLongMessagesByDefault: true })
        .expandLongMessagesByDefault
    ).toBe(true);
    expect(
      sanitizeMindroomAccountSettings({ expandLongMessagesByDefault: false })
        .expandLongMessagesByDefault
    ).toBe(false);
    expect(
      sanitizeMindroomAccountSettings({ expandLongMessagesByDefault: 1 })
        .expandLongMessagesByDefault
    ).toBe(true);
  });

  it('ignores unknown keys when reading', () => {
    expect(sanitizeMindroomAccountSettings({ simpleMode: true, futureKey: 'x' })).toEqual({
      simpleMode: true,
      expandLongMessagesByDefault: true,
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
      mergeMindroomAccountSettings(
        { simpleMode: false, futureKey: { nested: 1 } },
        { simpleMode: true }
      )
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
