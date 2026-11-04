import React from 'react';
import { Icon, Icons, color } from 'folds';
import { useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { SidebarAvatar, SidebarItem, SidebarItemTooltip } from '../../../components/sidebar';
import { countUnverifiedOtherDevices, useOwnDeviceTrust } from '../../../hooks/useOwnDeviceTrust';
import { settingsModalAtom } from '../../../state/settingsModal';
import { SettingsPages } from '../../../features/settings/settingsPages';

/**
 * The shield in the rail. It shows while this session is not verified against the account's
 * cross-signing keys, and on a verified session while another of the account's sessions is not;
 * either way it opens the device settings. An account without cross-signing has nothing to
 * verify against, so the shield stays away and the welcome page offers to set up backup instead.
 */
export function UnverifiedTab() {
  const { t } = useTranslation();
  const setSettingsModal = useSetAtom(settingsModalAtom);
  const trust = useOwnDeviceTrust();

  if (!trust?.crossSigning) return null;
  const thisDevice = !trust.thisDeviceVerified;
  if (!thisDevice && countUnverifiedOtherDevices(trust) === 0) return null;
  const label = thisDevice ? t('nav.unverifiedDevice') : t('nav.unverifiedDevices');

  return (
    <SidebarItem>
      <SidebarItemTooltip tooltip={label}>
        {(triggerRef) => (
          <SidebarAvatar
            as="button"
            ref={triggerRef}
            outlined
            aria-label={label}
            onClick={() => setSettingsModal({ initialPage: SettingsPages.DevicesPage })}
          >
            <Icon
              src={Icons.ShieldUser}
              style={{ color: thisDevice ? color.Critical.Main : color.Warning.Main }}
            />
          </SidebarAvatar>
        )}
      </SidebarItemTooltip>
    </SidebarItem>
  );
}
