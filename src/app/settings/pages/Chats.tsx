import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ImagePack } from '../../emoji/custom/ImagePack';
import { ImagePackView } from '../../emoji/packs/ImagePackView';
import { isMacOS } from '../../lib/user-agent';
import { SettingsPageFrame, type SettingsPageProps } from '../../ui/settings/SettingsPageFrame';
import { SettingsSection } from '../../ui/settings/SettingsSection';
import { SettingSwitchTile } from '../../ui/settings/SettingSwitchTile';
import { GlobalPacks } from '../../emoji/settings/GlobalPacks';
import { ServerPack } from '../../emoji/settings/ServerPack';
import { UserPack } from '../../emoji/settings/UserPack';

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
          focusId="enterForNewline"
          setting="enterForNewline"
          title={t('settings.general.editor.enterForNewline')}
          description={t('settings.general.editor.enterForNewlineDescription', { sendKey })}
        />
        <SettingSwitchTile
          focusId="markdown"
          setting="isMarkdown"
          title={t('settings.general.editor.markdownFormatting')}
        />
      </SettingsSection>
      <SettingsSection title={t('settings.general.messages.sectionTitle')}>
        <SettingSwitchTile
          focusId="hideMembershipEvents"
          setting="hideMembershipEvents"
          title={t('settings.general.messages.hideMembershipChange')}
        />
        <SettingSwitchTile
          focusId="hideNickAvatarEvents"
          setting="hideNickAvatarEvents"
          title={t('settings.general.messages.hideProfileChange')}
        />
        <SettingSwitchTile
          focusId="showToolCalls"
          setting="showToolCalls"
          title={t('mindroomUi.messages.showToolCalls')}
          description={t('mindroomUi.messages.showToolCallsDescription')}
        />
        <SettingSwitchTile
          focusId="mediaAutoLoad"
          setting="mediaAutoLoad"
          inverted
          title={t('settings.general.messages.disableMediaAutoLoad')}
        />
        <SettingSwitchTile
          focusId="urlPreview"
          setting="urlPreview"
          title={t('settings.general.messages.urlPreview')}
        />
      </SettingsSection>
      <UserPack onViewPack={setViewPack} />
      <GlobalPacks onViewPack={setViewPack} />
      <ServerPack onViewPack={setViewPack} />
    </SettingsPageFrame>
  );
}
