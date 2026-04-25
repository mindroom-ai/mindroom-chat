import { describe, expect, it } from 'vitest';
import { ScreenSize } from '../../hooks/useScreenSize';
import { SettingsPages } from './settingsPages';
import { getSettingsMenuItems, resolveSettingsInitialPage } from './settingsMenu';
import { LOCAL_MINDROOM_SETTINGS_PAGE } from '../../mindroom/local-mindroom/settingsPage';

describe('getSettingsMenuItems', () => {
  it('omits the Local MindRoom entry when disabled', () => {
    const items = getSettingsMenuItems(false);

    expect(items.some((item) => item.page === LOCAL_MINDROOM_SETTINGS_PAGE)).toBe(false);
  });

  it('keeps the Local MindRoom entry when enabled', () => {
    const items = getSettingsMenuItems(true);

    expect(items.find((item) => item.page === LOCAL_MINDROOM_SETTINGS_PAGE)).toMatchObject({
      name: 'Local MindRoom',
    });
  });
});

describe('resolveSettingsInitialPage', () => {
  it('preserves an explicit General page request', () => {
    expect(
      resolveSettingsInitialPage(SettingsPages.GeneralPage, ScreenSize.Desktop, false)
    ).toBe(SettingsPages.GeneralPage);
  });

  it('falls back to General when Local MindRoom is requested but disabled', () => {
    expect(
      resolveSettingsInitialPage(
        LOCAL_MINDROOM_SETTINGS_PAGE,
        ScreenSize.Desktop,
        false
      )
    ).toBe(SettingsPages.GeneralPage);
  });

  it('keeps mobile settings closed when no initial page is requested', () => {
    expect(resolveSettingsInitialPage(undefined, ScreenSize.Mobile, false)).toBeUndefined();
  });
});
