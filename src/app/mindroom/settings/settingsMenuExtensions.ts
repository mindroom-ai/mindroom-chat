import { type IconSrc } from 'folds';
import { ScreenSize } from '../../hooks/useScreenSize';
import { type SettingsPage, SettingsPages } from '../../features/settings/settingsPages';
import { getLocalMindroomSettingsMenuItems } from '../local-mindroom/settingsMenu';
import { resolveLocalMindroomInitialSettingsPage } from '../local-mindroom/settingsPage';

type MindroomSettingsMenuItem = {
  page: SettingsPage;
  name: string;
  icon: IconSrc;
};

export const getMindroomSettingsMenuItems = (enabled: boolean): MindroomSettingsMenuItem[] =>
  getLocalMindroomSettingsMenuItems(enabled);

export const resolveMindroomSettingsInitialPage = (
  initialPage: SettingsPage | undefined,
  screenSize: ScreenSize,
  enabled: boolean
): SettingsPage | undefined => {
  const resolvedInitialPage = resolveLocalMindroomInitialSettingsPage(initialPage, enabled);
  if (resolvedInitialPage !== undefined) return resolvedInitialPage;

  return screenSize === ScreenSize.Mobile ? undefined : SettingsPages.GeneralPage;
};
