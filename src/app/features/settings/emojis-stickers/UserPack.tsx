import { useMemo } from 'react';
import { Box, Button, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { PackAvatar } from '../../../components/image-pack-view';
import { SettingTile } from '../../../components/setting-tile';
import { useAccountData } from '../../../hooks/useAccountData';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { getUserImagePack, ImagePack, ImageUsage } from '../../../plugins/custom-emoji';
import { AccountDataEvent } from '../../../../types/matrix/accountData';
import { SettingsCard } from '../SettingsCard';

const USER_PACK = 'featureUi.settings.emojisStickers.userPack';

/**
 * The account's own pack (`im.ponies.user_emotes`), which it can use in every room. An account
 * without one still gets the tile: the pack is created when its first changes are applied.
 */
export function UserPack({ onViewPack }: { onViewPack: (pack: ImagePack) => void }) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const packEvent = useAccountData(AccountDataEvent.PoniesUserEmotes);
  const pack = useMemo(() => {
    void packEvent;
    return getUserImagePack(client) ?? new ImagePack(client.getSafeUserId(), {}, undefined);
  }, [client, packEvent]);
  const name = pack.meta.name ?? t('sharedUi.emojiBoard.personalPack');
  const avatar = pack.getAvatarUrl(ImageUsage.Emoticon) ?? pack.getAvatarUrl(ImageUsage.Sticker);

  return (
    <Box direction="Column" gap="100">
      <Text size="L400">{t(`${USER_PACK}.title`)}</Text>
      <SettingsCard>
        <SettingTile
          before={<PackAvatar mxc={avatar} name={name} size="300" />}
          title={name}
          description={t(`${USER_PACK}.imageCount`, { count: pack.images.collection.size })}
          after={
            <Button
              size="300"
              radii="300"
              variant="Secondary"
              fill="Soft"
              onClick={() => onViewPack(pack)}
            >
              <Text size="B300">{t(`${USER_PACK}.view`)}</Text>
            </Button>
          }
        />
      </SettingsCard>
    </Box>
  );
}
