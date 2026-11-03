import React, { useEffect, useState } from 'react';
import { Icon, Icons } from 'folds';
import { useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { CryptoEvent } from 'matrix-js-sdk/lib/crypto-api';
import { SidebarAvatar, SidebarItem, SidebarItemTooltip } from '../../../components/sidebar';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { settingsModalAtom } from '../../../state/settingsModal';
import { SettingsPages } from '../../../features/settings/settingsPages';

/** Shown while this device is not verified; opens the device settings. */



  const setSettingsModal = useSetAtom(settingsModalAtom);
  const [unverified, setUnverified] = useState(false);

  useEffect(() => {



    if (!crypto || !userId || !deviceId) return undefined;
    let cancelled = false;
    const check = () => {
      crypto
        .getDeviceVerificationStatus(userId, deviceId)
        .then((status) => {
          if (!cancelled) setUnverified(!!status && !status.crossSigningVerified);
        })
        .catch(() => undefined);
    };
    check();
    mx.on(CryptoEvent.UserTrustStatusChanged, check);
    mx.on(CryptoEvent.DevicesUpdated, check);
    return () => {
      cancelled = true;
      mx.removeListener(CryptoEvent.UserTrustStatusChanged, check);
      mx.removeListener(CryptoEvent.DevicesUpdated, check);
    };
  }, [mx]);

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
