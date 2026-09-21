import React from 'react';
import { ArchivedRooms, ARCHIVED_ROOMS_SETTINGS_PAGE } from '../rooms/ArchivedRoomsPage';
import { type SettingsPage } from '../../features/settings/settingsPages';
import { renderLocalMindroomSettingsPage } from '../local-mindroom/settingsRenderer';
import { MindroomPrefetchSettings } from './MindroomPrefetchSettings';

export { MindroomInterfaceSettings } from './MindroomInterfaceSettings';

type MindroomGeneralMessageSettingsProps = {
  className?: string;
};

export const renderMindroomSettingsPage = (
  activePage: SettingsPage | undefined,
  enabled: boolean,
  requestClose: () => void,
  onNavigate: () => void
): React.ReactNode =>
  activePage === ARCHIVED_ROOMS_SETTINGS_PAGE ? (
    <ArchivedRooms requestClose={requestClose} onNavigate={onNavigate} />
  ) : (
    renderLocalMindroomSettingsPage(activePage, enabled, requestClose)
  );

export function MindroomGeneralMessageSettings({ className }: MindroomGeneralMessageSettingsProps) {
  return <MindroomPrefetchSettings className={className} />;
}
