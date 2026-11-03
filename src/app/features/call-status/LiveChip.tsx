import React from 'react';
import { Badge, Text } from 'folds';
import { useTranslation } from 'react-i18next';

/** A small "Live" marker for an active call. */
export function LiveChip() {
  const { t } = useTranslation();
  return (
    <Badge variant="Critical" fill="Solid" size="500" radii="300">
      <Text size="L400">{t('featureUi.callStatus.live')}</Text>
    </Badge>
  );
}
