import { Icons, type IconSrc } from 'folds';
import { SettingsPages } from '../../features/settings/settingsPages';
import { MINDROOM_APP_NAME } from '../branding/branding';

export type LocalMindroomSettingsMenuItem = {
  page: SettingsPages;
  name: string;
  icon: IconSrc;
};

export const getLocalMindroomSettingsMenuItem = (): LocalMindroomSettingsMenuItem => ({
  page: SettingsPages.LocalMindroomPage,
  name: `Local ${MINDROOM_APP_NAME}`,
  icon: Icons.Link,
});
