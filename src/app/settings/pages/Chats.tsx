import { useState } from 'react';
import type { ParseKeys } from 'i18next';
import { useTranslation } from 'react-i18next';
import type { ImagePack } from '../../emoji/custom/ImagePack';
import { ImagePackView } from '../../emoji/packs/ImagePackView';
import { isMacOS } from '../../lib/user-agent';
import {
  MEDIA_COMPRESSION_PRESETS,
  type MediaCompressionPreset,
} from '../../preferences/mediaCompression';
import { settingsAtom } from '../../preferences/settings';
import { useSetting } from '../../preferences/useSetting';
import { SettingTile } from '../../ui/SettingTile';
import { ChoiceButton } from '../../ui/settings/ChoiceButton';
import { SettingsPageFrame, type SettingsPageProps } from '../../ui/settings/SettingsPageFrame';
import { SettingsSection } from '../../ui/settings/SettingsSection';
import { SettingSwitchTile } from '../../ui/settings/SettingSwitchTile';
import { GlobalPacks } from '../../emoji/settings/GlobalPacks';
import { ServerPack } from '../../emoji/settings/ServerPack';
import { UserPack } from '../../emoji/settings/UserPack';
import { formatShortcut } from '../../shortcuts/shortcuts';

const MEDIA_COMPRESSION_LABEL_KEYS = {
  off: 'featureUi.settings.mediaCompression.off',
  balanced: 'featureUi.settings.mediaCompression.balanced',
  small: 'featureUi.settings.mediaCompression.small',
} as const satisfies Record<MediaCompressionPreset, ParseKeys>;

/** Client-side quality preset for compressing attached images and videos before upload. */
function MediaCompressionTile() {
  const { t } = useTranslation();
  const [preset, setPreset] = useSetting(settingsAtom, 'mediaCompression');
  const label = t('featureUi.settings.mediaCompression.title');

  return (
    <SettingTile
      focusId="mediaCompression"
      title={label}
      description={t('featureUi.settings.mediaCompression.description')}
      after={
        <ChoiceButton
          label={label}
          value={preset}
          choices={MEDIA_COMPRESSION_PRESETS.map((value) => ({
            value,
            label: t(MEDIA_COMPRESSION_LABEL_KEYS[value]),
          }))}
          onChoose={setPreset}
        />
      }
    />
  );
}

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
          focusId="voiceHoldShortcut"
          setting="voiceHoldShortcut"
          title={t('shortcuts.voiceKey.label', { voiceKey: formatShortcut('voiceRecord') })}
          description={t('shortcuts.voiceKey.description')}
        />
        <SettingSwitchTile
          focusId="markdown"
          setting="isMarkdown"
          title={t('settings.general.editor.markdownFormatting')}
        />
        <MediaCompressionTile />
        <SettingSwitchTile
          focusId="autoZipLargeFiles"
          setting="autoZipLargeFiles"
          title={t('featureUi.settings.autoZipLargeFiles.title')}
          description={t('featureUi.settings.autoZipLargeFiles.description')}
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
