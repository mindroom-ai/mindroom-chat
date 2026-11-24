import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MINDROOM_ACCOUNT_SETTINGS,
  mergeAccountSettings,
  sanitizeAccountSettings,
  setPluginEnabledPreference,
} from './accountSettings';

describe('sanitizeAccountSettings', () => {
  it('falls back to defaults for non-object content', () => {
    expect(sanitizeAccountSettings(undefined)).toEqual(DEFAULT_MINDROOM_ACCOUNT_SETTINGS);
    expect(sanitizeAccountSettings(null)).toEqual(DEFAULT_MINDROOM_ACCOUNT_SETTINGS);
    expect(sanitizeAccountSettings('simple')).toEqual(DEFAULT_MINDROOM_ACCOUNT_SETTINGS);
    expect(sanitizeAccountSettings([true])).toEqual(DEFAULT_MINDROOM_ACCOUNT_SETTINGS);
  });

  it('hides Canvases in the sidebar by default while preserving explicit booleans', () => {
    expect(DEFAULT_MINDROOM_ACCOUNT_SETTINGS.showCanvasesInSidebar).toBe(false);
    expect(sanitizeAccountSettings({}).showCanvasesInSidebar).toBe(false);
    expect(sanitizeAccountSettings({ showCanvasesInSidebar: true }).showCanvasesInSidebar).toBe(
      true
    );
    expect(sanitizeAccountSettings({ showCanvasesInSidebar: 'no' }).showCanvasesInSidebar).toBe(
      false
    );
  });

  it('reads whether the tour was offered, which it was not unless a boolean says so', () => {
    expect(DEFAULT_MINDROOM_ACCOUNT_SETTINGS.tourOffered).toBe(false);
    expect(sanitizeAccountSettings({}).tourOffered).toBe(false);
    expect(sanitizeAccountSettings({ tourOffered: true }).tourOffered).toBe(true);
    expect(sanitizeAccountSettings({ tourOffered: 'yes' }).tourOffered).toBe(false);
    expect(sanitizeAccountSettings({ tourOffered: 1 }).tourOffered).toBe(false);
  });

  it('reads whether the Mac app was offered, which it was not unless a boolean says so', () => {
    expect(DEFAULT_MINDROOM_ACCOUNT_SETTINGS.macAppOffered).toBe(false);
    expect(sanitizeAccountSettings({}).macAppOffered).toBe(false);
    expect(sanitizeAccountSettings({ macAppOffered: true }).macAppOffered).toBe(true);
    expect(sanitizeAccountSettings({ macAppOffered: 'yes' }).macAppOffered).toBe(false);
  });

  it.each(['disabledPlugins', 'enabledPlugins'] as const)(
    'sanitizes %s as deduplicated non-empty string IDs',
    (key) => {
      expect(DEFAULT_MINDROOM_ACCOUNT_SETTINGS[key]).toEqual([]);
      expect(sanitizeAccountSettings({})[key]).toEqual([]);
      expect(sanitizeAccountSettings({ [key]: 'example' })[key]).toEqual([]);
      expect(sanitizeAccountSettings({ [key]: { example: true } })[key]).toEqual([]);
      expect(
        sanitizeAccountSettings({
          [key]: [
            'pull-requests',
            '',
            '  ',
            42,
            null,
            'thread-usage',
            'pull-requests',
            ' thread-usage ',
          ],
        })[key]
      ).toEqual(['pull-requests', 'thread-usage']);
    }
  );

  it('ignores unknown keys when reading', () => {
    expect(
      sanitizeAccountSettings({
        simpleMode: true,
        futureKey: 'x',
        expandLongMessagesByDefault: true,
      })
    ).toEqual(DEFAULT_MINDROOM_ACCOUNT_SETTINGS);
  });
});

describe('mergeAccountSettings', () => {
  it('overlays the patch onto stored content', () => {
    expect(
      mergeAccountSettings({ showCanvasesInSidebar: false }, { showCanvasesInSidebar: true })
    ).toEqual({
      showCanvasesInSidebar: true,
    });
  });

  it('preserves unknown keys written by other clients', () => {
    expect(
      mergeAccountSettings(
        { showCanvasesInSidebar: false, futureKey: { nested: 1 } },
        { showCanvasesInSidebar: true }
      )
    ).toEqual({ showCanvasesInSidebar: true, futureKey: { nested: 1 } });
  });

  it('records the tour as offered beside the switches and the keys of other clients', () => {
    expect(
      mergeAccountSettings({ showThreadsInSidebar: true, futureKey: 'x' }, { tourOffered: true })
    ).toEqual({ showThreadsInSidebar: true, futureKey: 'x', tourOffered: true });
  });

  it('preserves unknown keys when updating plugin preferences', () => {
    expect(
      mergeAccountSettings(
        { showThreadsInSidebar: true, futureKey: 'x' },
        { disabledPlugins: ['pull-requests'], enabledPlugins: ['opt-in'] }
      )
    ).toEqual({
      showThreadsInSidebar: true,
      futureKey: 'x',
      disabledPlugins: ['pull-requests'],
      enabledPlugins: ['opt-in'],
    });
  });

  it('treats malformed stored content as empty', () => {
    expect(mergeAccountSettings(undefined, { showCanvasesInSidebar: true })).toEqual({
      showCanvasesInSidebar: true,
    });
    expect(mergeAccountSettings('garbage', { showCanvasesInSidebar: true })).toEqual({
      showCanvasesInSidebar: true,
    });
  });
});

describe('setPluginEnabledPreference', () => {
  it('moves plugin IDs between enabledPlugins and disabledPlugins without duplicates', () => {
    expect(
      setPluginEnabledPreference({ disabledPlugins: [], enabledPlugins: [] }, 'opt-in', true)
    ).toEqual({ disabledPlugins: [], enabledPlugins: ['opt-in'] });
    expect(
      setPluginEnabledPreference(
        { disabledPlugins: ['pull-requests', 'thread-usage'], enabledPlugins: ['opt-in'] },
        ' pull-requests ',
        true
      )
    ).toEqual({ disabledPlugins: ['thread-usage'], enabledPlugins: ['opt-in', 'pull-requests'] });
    expect(
      setPluginEnabledPreference(
        { disabledPlugins: ['thread-usage'], enabledPlugins: ['opt-in', 'pull-requests'] },
        'opt-in',
        false
      )
    ).toEqual({ disabledPlugins: ['thread-usage', 'opt-in'], enabledPlugins: ['pull-requests'] });
    expect(
      setPluginEnabledPreference(
        { disabledPlugins: ['a', 'a', ''], enabledPlugins: [' b ', 'b'] },
        '  ',
        true
      )
    ).toEqual({ disabledPlugins: ['a'], enabledPlugins: ['b'] });
  });
});
