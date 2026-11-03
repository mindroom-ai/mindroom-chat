import React, { useState } from 'react';
import { Box, Chip, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { SequenceCard } from '../../../components/sequence-card';
import { SettingTile } from '../../../components/setting-tile';
import { copyToClipboard } from '../../../utils/dom';
import { SequenceCardStyle } from '../styles.css';

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
    <Chip radii="Pill" variant="Secondary" onClick={copyUserId}>
      <Text size="T200">{chipLabel}</Text>
    </Chip>
  );

  return (
    <Box direction="Column" gap="100">
      <Text size="L400">{t('featureUi.settings.account.matrixId.matrixId')}</Text>
      <SequenceCard {...CARD_PROPS}>
        <SettingTile title={userId} after={copyChip} />
      </SequenceCard>
    </Box>
  );
}
