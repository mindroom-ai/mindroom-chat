import React, { useState } from 'react';
import { Box, Icon, IconButton, Icons, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import type { ImagePack } from '../../../plugins/custom-emoji';
import { ImagePackView } from '../../../components/image-pack-view';
import { SettingsPageFrame, type SettingsPageProps } from '../SettingsPageFrame';
import { GlobalPacks } from './GlobalPacks';
import { ServerPack } from './ServerPack';

/** The packs used everywhere and the server's, or the pack being viewed with a way back. */
export function EmojisStickers({ requestClose }: SettingsPageProps) {
  const { t } = useTranslation();
  const [viewPack, setViewPack] = useState<ImagePack>();

  if (viewPack) {
    return (
      <Box direction="Column" grow="Yes">
        <Box alignItems="Center" gap="200" style={{ padding: '8px' }}>
          <IconButton
            onClick={() => setViewPack(undefined)}
            aria-label={t('mindroomUi.threads.mindroomRoomViewHeader.back')}
          >
            <Icon src={Icons.ArrowLeft} />
          </IconButton>
          <Text size="H4">{t('settings.nav.emojisStickers')}</Text>
        </Box>
        <ImagePackView address={viewPack.address} requestClose={() => setViewPack(undefined)} />
      </Box>
    );
  }

  return (
    <SettingsPageFrame title={t('settings.nav.emojisStickers')} requestClose={requestClose}>
      <GlobalPacks onViewPack={setViewPack} />
      <ServerPack onViewPack={setViewPack} />
    </SettingsPageFrame>
  );
}
