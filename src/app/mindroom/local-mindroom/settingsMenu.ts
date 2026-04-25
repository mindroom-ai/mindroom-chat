import { Icons, type IconSrc } from 'folds';
import { MINDROOM_APP_NAME } from '../branding/branding';
import { LOCAL_MINDROOM_SETTINGS_PAGE, type LocalMindroomSettingsPage } from './settingsPage';

export type LocalMindroomSettingsMenuItem = {
  page: LocalMindroomSettingsPage;
  name: string;
  icon: IconSrc;
};

export const getLocalMindroomSettingsMenuItem = (): LocalMindroomSettingsMenuItem => ({
  page: LOCAL_MINDROOM_SETTINGS_PAGE,
  name: `Local ${MINDROOM_APP_NAME}`,
  icon: Icons.Link,
});

export const getLocalMindroomSettingsMenuItems = (
  enabled: boolean
): LocalMindroomSettingsMenuItem[] => (enabled ? [getLocalMindroomSettingsMenuItem()] : []);
