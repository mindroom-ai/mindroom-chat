import { describe, expect, it } from 'vitest';
import { ScreenSize } from '../../hooks/useScreenSize';
import { SettingsPages } from './settingsPages';
import { getSettingsMenuItems, resolveSettingsInitialPage } from './settingsMenu';

describe('getSettingsMenuItems', () => {
  it('omits the Local MindRoom entry when disabled', () => {
    const items = getSettingsMenuItems(false);

    expect(items.some((item) => item.page === SettingsPages.LocalMindroomPage)).toBe(false);
  });

  it('keeps the Local MindRoom entry when enabled', () => {
    const items = getSettingsMenuItems(true);

    expect(items.find((item) => item.page === SettingsPages.LocalMindroomPage)).toMatchObject({
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
        SettingsPages.LocalMindroomPage,
        ScreenSize.Desktop,
        false
      )
    ).toBe(SettingsPages.GeneralPage);
  });

  it('keeps mobile settings closed when no initial page is requested', () => {
    expect(resolveSettingsInitialPage(undefined, ScreenSize.Mobile, false)).toBeUndefined();
  });
});
