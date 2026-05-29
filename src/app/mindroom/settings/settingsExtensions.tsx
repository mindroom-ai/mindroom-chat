import React from 'react';
import { type SettingsPage } from '../../features/settings/settingsPages';
import { renderLocalMindroomSettingsPage } from '../local-mindroom/settingsRenderer';
import { MindroomMessagePreloadLimitSetting } from './MindroomMessagePreloadLimitSetting';

type MindroomGeneralMessageSettingsProps = {
  className?: string;
};

export const renderMindroomSettingsPage = (
  activePage: SettingsPage | undefined,
  enabled: boolean,
  requestClose: () => void
): React.ReactNode => renderLocalMindroomSettingsPage(activePage, enabled, requestClose);

export function MindroomGeneralMessageSettings({ className }: MindroomGeneralMessageSettingsProps) {
  return <MindroomMessagePreloadLimitSetting className={className} />;
}
