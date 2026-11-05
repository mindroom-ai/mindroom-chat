import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ImagePack } from '../../../plugins/custom-emoji';
import { ImagePackView } from '../../../components/image-pack-view';
import { isMacOS } from '../../../utils/user-agent';
import { SettingsPageFrame, type SettingsPageProps } from '../SettingsPageFrame';
import { SettingsSection } from '../SettingsSection';
import { SettingSwitchTile } from '../SettingSwitchTile';
import { GlobalPacks } from '../emojis-stickers/GlobalPacks';
import { ServerPack } from '../emojis-stickers/ServerPack';
import { UserPack } from '../emojis-stickers/UserPack';

/** The composer's keys, what the timeline shows, and the emoji and sticker packs. */
export function Chats({ requestClose }: SettingsPageProps) {
  const { t } = useTranslation();
  // A pack opens in place of the page; its header leads back here.
  const [viewPack, setViewPack] = useState<ImagePack>();
  const sendKey = isMacOS() ? 'Cmd' : 'Ctrl';

  if (viewPack) {
    return <ImagePackView address={viewPack.address} requestClose={() => setViewPack(undefined)} />;
  }

  return (
    <SettingsPageFrame title={t('nav.chats')} requestClose={requestClose}>
      <SettingsSection title={t('settings.general.editor.sectionTitle')}>
        <SettingSwitchTile
          setting="enterForNewline"
          title={t('settings.general.editor.enterForNewline')}
          description={t('settings.general.editor.enterForNewlineDescription', { sendKey })}
        />
        <SettingSwitchTile
          setting="isMarkdown"
          title={t('settings.general.editor.markdownFormatting')}
        />
      </SettingsSection>
      <SettingsSection title={t('settings.general.messages.sectionTitle')}>
        <SettingSwitchTile
          setting="hideMembershipEvents"
          title={t('settings.general.messages.hideMembershipChange')}
        />
        <SettingSwitchTile
          setting="hideNickAvatarEvents"
          title={t('settings.general.messages.hideProfileChange')}
        />
        <SettingSwitchTile
          setting="mediaAutoLoad"
          inverted
          title={t('settings.general.messages.disableMediaAutoLoad')}
        />
        <SettingSwitchTile setting="urlPreview" title={t('settings.general.messages.urlPreview')} />
      </SettingsSection>
      <UserPack onViewPack={setViewPack} />
      <GlobalPacks onViewPack={setViewPack} />
      <ServerPack onViewPack={setViewPack} />
    </SettingsPageFrame>
  );
}
