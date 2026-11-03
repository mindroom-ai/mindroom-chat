import React, { useCallback, useEffect, useState } from 'react';
import { Box, Button, Spinner, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import type { IMyDevice } from 'matrix-js-sdk';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { SequenceCard } from '../../../components/sequence-card';
import { SettingTile } from '../../../components/setting-tile';
import { SettingsPageFrame } from '../SettingsPageFrame';
import { SequenceCardStyle } from '../styles.css';

type DevicesProps = {
  requestClose: () => void;
};

const formatLastSeen = (device: IMyDevice, language: string): string | undefined => {
  if (!device.last_seen_ts) return undefined;
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(device.last_seen_ts)
  );
};

/** The account's sessions; the current one first. Signing out others needs the account manager or UIA. */
export function Devices({ requestClose }: DevicesProps) {
  const { t, i18n } = useTranslation();
  const mx = useMatrixClient();
  const [devices, setDevices] = useState<IMyDevice[] | null>();
  const currentDeviceId = mx.getDeviceId();

  const load = useCallback(async () => {
    setDevices(undefined);
    try {
      const { devices: list } = await mx.getDevices();
      setDevices(
        [...list].sort((a, b) => {
          if (a.device_id === currentDeviceId) return -1;
          if (b.device_id === currentDeviceId) return 1;
          return (b.last_seen_ts ?? 0) - (a.last_seen_ts ?? 0);
        })
      );
    } catch {
      setDevices(null);
    }
  }, [mx, currentDeviceId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SettingsPageFrame title={t('settings.nav.devices')} requestClose={requestClose}>
      <Box direction="Column" gap="100">
        <Text size="L400">{t('featureUi.settings.devices.devices')}</Text>
        <SequenceCard
          className={SequenceCardStyle}
          variant="SurfaceVariant"
          direction="Column"
          gap="400"
        >
          {devices === undefined && <Spinner variant="Secondary" />}
          {devices === null && (
            <SettingTile
              title={t('featureUi.settings.devices.loadFailed')}
              after={
                <Button size="300" radii="300" fill="Soft" onClick={() => void load()}>
                  <Text size="B300">{t('sharedUi.clientRoot.retry')}</Text>
                </Button>
              }
            />
          )}
          {devices?.map((device) => {
            const lastSeen = formatLastSeen(device, i18n.language);
            return (
              <SettingTile
                key={device.device_id}
                title={device.display_name || device.device_id}
                description={[
                  device.device_id,
                  device.device_id === currentDeviceId
                    ? t('featureUi.settings.devices.current')
                    : lastSeen &&
                      `${t('featureUi.settings.devices.deviceTile.lastActivity')} ${lastSeen}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
            );
          })}
        </SequenceCard>
      </Box>
    </SettingsPageFrame>
  );
}
