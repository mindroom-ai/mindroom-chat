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

  it('shows Canvases in the sidebar by default while preserving explicit booleans', () => {
    expect(DEFAULT_MINDROOM_ACCOUNT_SETTINGS.showCanvasesInSidebar).toBe(true);
    expect(sanitizeMindroomAccountSettings({}).showCanvasesInSidebar).toBe(true);
    expect(
      sanitizeMindroomAccountSettings({ showCanvasesInSidebar: false }).showCanvasesInSidebar
    ).toBe(false);
    expect(
      sanitizeMindroomAccountSettings({ showCanvasesInSidebar: 'no' }).showCanvasesInSidebar
    ).toBe(true);
  });

  it('ignores unknown keys when reading', () => {
    expect(
      sanitizeMindroomAccountSettings({
        simpleMode: true,
        futureKey: 'x',
        expandLongMessagesByDefault: true,
      })
    ).toEqual({
      showCanvasesInSidebar: true,
    });
  });
});

describe('mergeMindroomAccountSettings', () => {
  it('overlays the patch onto stored content', () => {
    expect(
      mergeMindroomAccountSettings(
        { showCanvasesInSidebar: false },
        { showCanvasesInSidebar: true }
      )
    ).toEqual({
      showCanvasesInSidebar: true,
    });
  });

  it('preserves unknown keys written by other clients', () => {
    expect(
      mergeMindroomAccountSettings(
        { showCanvasesInSidebar: false, futureKey: { nested: 1 } },
        { showCanvasesInSidebar: true }
      )
    ).toEqual({ showCanvasesInSidebar: true, futureKey: { nested: 1 } });
  });

  it('treats malformed stored content as empty', () => {
    expect(mergeMindroomAccountSettings(undefined, { showCanvasesInSidebar: true })).toEqual({
      showCanvasesInSidebar: true,
    });
    expect(mergeMindroomAccountSettings('garbage', { showCanvasesInSidebar: true })).toEqual({
      showCanvasesInSidebar: true,
    });
  });
});
