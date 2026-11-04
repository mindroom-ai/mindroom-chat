import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ImagePack } from '../../../plugins/custom-emoji';
import { ImagePackView } from '../../../components/image-pack-view';
import { SettingsPageFrame, type SettingsPageProps } from '../SettingsPageFrame';
import { GlobalPacks } from './GlobalPacks';
import { ServerPack } from './ServerPack';
import { UserPack } from './UserPack';

/**
 * The account's own pack, the room packs it uses everywhere and the server's, or the pack being
 * viewed, whose header leads back here.
 */
export function EmojisStickers({ requestClose }: SettingsPageProps) {
  const { t } = useTranslation();
  const [viewPack, setViewPack] = useState<ImagePack>();

  if (viewPack) {
    return <ImagePackView address={viewPack.address} requestClose={() => setViewPack(undefined)} />;
  }

  return (
    <SettingsPageFrame title={t('settings.nav.emojisStickers')} requestClose={requestClose}>
      <UserPack onViewPack={setViewPack} />
      <GlobalPacks onViewPack={setViewPack} />
      <ServerPack onViewPack={setViewPack} />
    </SettingsPageFrame>
  );
}
