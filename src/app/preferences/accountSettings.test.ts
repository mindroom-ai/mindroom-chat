import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MINDROOM_ACCOUNT_SETTINGS,
  mergeAccountSettings,
  sanitizeAccountSettings,
} from './accountSettings';

describe('sanitizeAccountSettings', () => {
  it('falls back to defaults for non-object content', () => {
    expect(sanitizeAccountSettings(undefined)).toEqual(DEFAULT_MINDROOM_ACCOUNT_SETTINGS);
    expect(sanitizeAccountSettings(null)).toEqual(DEFAULT_MINDROOM_ACCOUNT_SETTINGS);
    expect(sanitizeAccountSettings('simple')).toEqual(DEFAULT_MINDROOM_ACCOUNT_SETTINGS);
    expect(sanitizeAccountSettings([true])).toEqual(DEFAULT_MINDROOM_ACCOUNT_SETTINGS);
  });

  it('shows Canvases in the sidebar by default while preserving explicit booleans', () => {
    expect(DEFAULT_MINDROOM_ACCOUNT_SETTINGS.showCanvasesInSidebar).toBe(true);
    expect(sanitizeAccountSettings({}).showCanvasesInSidebar).toBe(true);
    expect(
      sanitizeAccountSettings({ showCanvasesInSidebar: false }).showCanvasesInSidebar
    ).toBe(false);
    expect(
      sanitizeAccountSettings({ showCanvasesInSidebar: 'no' }).showCanvasesInSidebar
    ).toBe(true);
  });

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
      mergeAccountSettings(
        { showCanvasesInSidebar: false },
        { showCanvasesInSidebar: true }
      )
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

  it('treats malformed stored content as empty', () => {
    expect(mergeAccountSettings(undefined, { showCanvasesInSidebar: true })).toEqual({
      showCanvasesInSidebar: true,
    });
    expect(mergeAccountSettings('garbage', { showCanvasesInSidebar: true })).toEqual({
      showCanvasesInSidebar: true,
    });
  });
});
