import React, { useEffect, useState } from 'react';
import { Icon, Icons } from 'folds';
import { useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { CryptoEvent } from 'matrix-js-sdk/lib/crypto-api';
import { SidebarAvatar, SidebarItem, SidebarItemTooltip } from '../../../components/sidebar';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { settingsModalAtom } from '../../../state/settingsModal';
import { SettingsPages } from '../../../features/settings/settingsPages';

/**
 * Shown while the account has cross-signing keys that have not verified this device; opens the
 * device settings. An account without cross-signing has nothing to verify against, so the tab
 * stays away and the welcome page offers to set up backup instead.
 */
export function UnverifiedTab() {
  const client = useMatrixClient();
  const { t } = useTranslation();
  const setSettingsModal = useSetAtom(settingsModalAtom);
  const [unverified, setUnverified] = useState(false);

  useEffect(() => {
    const userId = client.getUserId();
    const deviceId = client.getDeviceId();
    const crypto = client.getCrypto();
    if (!crypto || !userId || !deviceId) return undefined;
    let cancelled = false;
    const isUnverified = async (): Promise<boolean> => {
      if (!(await crypto.userHasCrossSigningKeys(userId))) return false;
      const status = await crypto.getDeviceVerificationStatus(userId, deviceId);
      return !!status && !status.crossSigningVerified;
    };
    const check = () => {
      isUnverified()
        .then((result) => {
          if (!cancelled) setUnverified(result);
        })
        .catch(() => undefined);
    };
    check();
    const events = [
      CryptoEvent.UserTrustStatusChanged,
      CryptoEvent.DevicesUpdated,
      CryptoEvent.KeysChanged,
    ] as const;
    events.forEach((event) => client.on(event, check));
    return () => {
      cancelled = true;
      events.forEach((event) => client.removeListener(event, check));
    };
  }, [client]);

  if (!unverified) return null;

  return (
    <SidebarItem>
      <SidebarItemTooltip tooltip={t('nav.unverifiedDevice')}>
        {(triggerRef) => (
          <SidebarAvatar
            as="button"
            ref={triggerRef}
            outlined
            aria-label={t('nav.unverifiedDevice')}
            onClick={() => setSettingsModal({ initialPage: SettingsPages.DevicesPage })}
          >
            <Icon src={Icons.ShieldUser} />
          </SidebarAvatar>
        )}
      </SidebarItemTooltip>
    </SidebarItem>
  );
}
