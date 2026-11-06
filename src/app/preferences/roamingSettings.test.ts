// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from './settings';
import {
  DATE_FORMAT_MAX_LENGTH,
  ROAMING_KEYS,
  ROAMING_SETTINGS_VERSION,
  forgetOrphanedPendingRoamingSettings,
  loadPendingRoamingSettings,
  mergeRoamingSettings,
  overlayRoamingSettings,
  pendingRoamingSettingsKey,
  readRoamingSettings,
  remainingRoamingEdits,
  roamingEdits,
  roamingMigration,
  savePendingRoamingSettings,
} from './roamingSettings';

const device = (changes: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...changes });

afterEach(() => localStorage.clear());

describe('readRoamingSettings', () => {
  it('reads each roaming key of its version with its exact type', () => {
    expect(
      readRoamingSettings({
        version: ROAMING_SETTINGS_VERSION,
        isMarkdown: false,
        hour24Clock: true,
        hideActivity: 'true',
        urlPreview: 0,
        dateFormatString: 'YYYY-MM-DD',
      })
    ).toEqual({ isMarkdown: false, hour24Clock: true, dateFormatString: 'YYYY-MM-DD' });
  });

  it('takes a date format only when it is a non-empty string within the cap', () => {
    const read = (dateFormatString: unknown) =>
      readRoamingSettings({ version: ROAMING_SETTINGS_VERSION, dateFormatString });
    expect(read('x'.repeat(DATE_FORMAT_MAX_LENGTH))).toEqual({
      dateFormatString: 'x'.repeat(DATE_FORMAT_MAX_LENGTH),
    });
    expect(read('x'.repeat(DATE_FORMAT_MAX_LENGTH + 1))).toEqual({});
    expect(read('')).toEqual({});
    expect(read(42)).toEqual({});
  });

  it('never reads a setting that stays on the device, whatever the content holds', () => {
    // 🔒 Account data is input the homeserver controls: it may not set the zoom, the theme, link
    // previews in encrypted rooms, error reports or the computer server of this device.
    expect(
      readRoamingSettings({
        version: ROAMING_SETTINGS_VERSION,
        pageZoom: 150,
        themeId: 'dark-theme',
        useSystemTheme: false,
        encUrlPreview: true,
        sendErrorReports: false,
        mediaAutoLoad: false,
        developerTools: true,
        computerServiceUrl: 'https://evil.example',
      })
    ).toEqual({});
  });

  it('reads nothing from content of another version or of another shape', () => {
    expect(readRoamingSettings({ version: 2, hour24Clock: true })).toEqual({});
    expect(readRoamingSettings({ hour24Clock: true })).toEqual({});
    expect(readRoamingSettings({ version: '1', hour24Clock: true })).toEqual({});
    expect(readRoamingSettings(undefined)).toEqual({});
    expect(readRoamingSettings([true])).toEqual({});
  });
});

describe('mergeRoamingSettings', () => {
  it('patches the stored content at this version and keeps the keys it does not know', () => {
    expect(
      mergeRoamingSettings(
        { version: 1, hour24Clock: false, isMarkdown: false, laterKey: 'kept' },
        { hour24Clock: true }
      )
    ).toEqual({ version: 1, hour24Clock: true, isMarkdown: false, laterKey: 'kept' });
    expect(mergeRoamingSettings(undefined, { isMarkdown: false })).toEqual({
      version: 1,
      isMarkdown: false,
    });
  });

  it('leaves content of a later version alone', () => {
    expect(mergeRoamingSettings({ version: 2, hour24Clock: 'h23' }, { hour24Clock: true })).toBe(
      undefined
    );
  });
});

describe('overlayRoamingSettings', () => {
  it('shows a pending edit over the account value, and the account value over the device one', () => {
    const shown = overlayRoamingSettings(
      device({
        hour24Clock: false,
        isMarkdown: false,
        dateFormatString: 'DD/MM/YYYY',
        pageZoom: 90,
      }),
      { version: 1, hour24Clock: false, isMarkdown: true, pageZoom: 150 },
      { hour24Clock: true }
    );
    expect(shown.hour24Clock).toBe(true);
    expect(shown.isMarkdown).toBe(true);
    expect(shown.dateFormatString).toBe('DD/MM/YYYY');
    expect(shown.pageZoom).toBe(90);
  });

  it("shows this device's values while the account's content is unknown", () => {
    const own = device({ hideActivity: true });
    expect(overlayRoamingSettings(own, undefined, {})).toEqual(own);
  });
});

describe('roamingEdits', () => {
  it('names the roaming values a write changes, and nothing the account cannot store', () => {
    const shown = device();
    expect(roamingEdits(shown, { ...shown, hour24Clock: true, pageZoom: 120 })).toEqual({
      hour24Clock: true,
    });
    expect(
      roamingEdits(shown, { ...shown, dateFormatString: 'x'.repeat(DATE_FORMAT_MAX_LENGTH + 1) })
    ).toEqual({});
    expect(roamingEdits(shown, shown)).toEqual({});
  });
});

describe('remainingRoamingEdits', () => {
  it('keeps only the edits that changed after they were sent', () => {
    expect(
      remainingRoamingEdits(
        { hour24Clock: false, isMarkdown: false, hideActivity: true },
        { hour24Clock: true, isMarkdown: false }
      )
    ).toEqual({ hour24Clock: false, hideActivity: true });
  });
});

describe('roamingMigration', () => {
  it("uploads this device's non-default values for the keys the account lacks", () => {
    expect(
      roamingMigration(
        { hour24Clock: false },
        device({
          hour24Clock: true,
          hideActivity: true,
          dateFormatString: 'YYYY-MM-DD',
          enterForNewline: false,
          pageZoom: 120,
          encUrlPreview: true,
          themeId: 'dark-theme',
        }),
        DEFAULT_SETTINGS
      )
    ).toEqual({ hideActivity: true, dateFormatString: 'YYYY-MM-DD' });
  });

  it('leaves every key the account holds to the account, even at its default', () => {
    const everything = Object.fromEntries(ROAMING_KEYS.map((key) => [key, DEFAULT_SETTINGS[key]]));
    expect(
      roamingMigration(
        everything,
        device({ hideActivity: true, urlPreview: false, isMarkdown: false }),
        DEFAULT_SETTINGS
      )
    ).toEqual({});
  });

  it('uploads no value the account could not store', () => {
    expect(roamingMigration({}, device({ dateFormatString: '' }), DEFAULT_SETTINGS)).toEqual({});
  });

  it('can only make other devices more private', () => {
    // 🔒 Each privacy setting starts at its less private choice, and only non-default values go
    // up, so the upload never turns receipts back on or link previews back on elsewhere.
    expect(DEFAULT_SETTINGS.hideActivity).toBe(false);
    expect(DEFAULT_SETTINGS.urlPreview).toBe(true);
    const flipped = Object.fromEntries(
      ROAMING_KEYS.map((key) => {
        const value = DEFAULT_SETTINGS[key];
        // The clock has no default (it follows the language), so a choice differs from it.
        if (value === undefined) return [key, true];
        return [key, typeof value === 'boolean' ? !value : 'YYYY-MM-DD'];
      })
    );
    const patch = roamingMigration({}, device(flipped), DEFAULT_SETTINGS);
    expect(patch.hideActivity).toBe(true);
    expect(patch.urlPreview).toBe(false);
    ROAMING_KEYS.forEach((key) => expect(patch[key], key).not.toBe(DEFAULT_SETTINGS[key]));
    expect(roamingMigration({}, device(), DEFAULT_SETTINGS)).toEqual({});
  });
});

describe('pending edits in localStorage', () => {
  const alice = pendingRoamingSettingsKey('@alice:example.org', 'ALICEPHONE');

  it('saves, loads and forgets the edits of one login', () => {
    savePendingRoamingSettings(alice, { hour24Clock: true, dateFormatString: 'YYYY-MM-DD' });
    expect(loadPendingRoamingSettings(alice)).toEqual({
      hour24Clock: true,
      dateFormatString: 'YYYY-MM-DD',
    });
    savePendingRoamingSettings(alice, {});
    expect(localStorage.getItem(alice)).toBeNull();
  });

  it('drops keys that no longer roam, values of the wrong type and unreadable entries', () => {
    localStorage.setItem(alice, JSON.stringify({ hour24Clock: true, pageZoom: 50, isMarkdown: 1 }));
    expect(loadPendingRoamingSettings(alice)).toEqual({ hour24Clock: true });
    localStorage.setItem(alice, '{not json');
    expect(loadPendingRoamingSettings(alice)).toEqual({});
  });

  it('deletes the edits of logins this browser no longer keeps', () => {
    const removed = pendingRoamingSettingsKey('@bob:example.org', 'BOBLAPTOP');
    const earlierLogin = pendingRoamingSettingsKey('@alice:example.org', 'OLDDEVICE');
    [alice, removed, earlierLogin].forEach((key) =>
      savePendingRoamingSettings(key, { hideActivity: true })
    );
    localStorage.setItem('settings', '{}');

    forgetOrphanedPendingRoamingSettings([alice]);

    expect(localStorage.getItem(alice)).not.toBeNull();
    expect(localStorage.getItem(removed)).toBeNull();
    expect(localStorage.getItem(earlierLogin)).toBeNull();
    expect(localStorage.getItem('settings')).toBe('{}');
  });
});
