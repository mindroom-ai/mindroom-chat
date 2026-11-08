import { useState } from 'react';
import { Box, Chip, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { SequenceCard } from '../../ui/SequenceCard';
import { SettingTile } from '../../ui/SettingTile';
import { copyToClipboard } from '../../lib/dom';
import { SequenceCardStyle } from '../../ui/settings/styles.css';

const CARD_PROPS = {
  className: SequenceCardStyle,
  variant: 'SurfaceVariant',
  direction: 'Column',
  gap: '400',
} as const;

/** The signed-in Matrix ID with a copy button that confirms only a real copy. */
export function MatrixId() {
  const { t } = useTranslation();
  const userId = useMatrixClient().getUserId() ?? '';
  const [confirmed, setConfirmed] = useState(false);

  // copyToClipboard resolves false when every clipboard path failed.
  const copyUserId = () => copyToClipboard(userId).then(setConfirmed);

  const chipLabel = confirmed
    ? t('featureUi.settings.account.matrixId.copied')
    : t('featureUi.settings.account.matrixId.copy');
  const copyChip = (
    <Chip radii="Pill" variant="Secondary" onClick={() => void copyUserId()}>
      <Text size="T200">{chipLabel}</Text>
    </Chip>
  );

  return (
    <Box direction="Column" gap="100">
      <Text size="L400" data-settings-heading="">
        {t('featureUi.settings.account.matrixId.matrixId')}
      </Text>
      <SequenceCard {...CARD_PROPS}>
        {/* A Matrix ID reads left to right, with its @ at the start, in any language. */}
        <SettingTile title={<bdi>{userId}</bdi>} after={copyChip} />
      </SequenceCard>
    </Box>
  );
}
