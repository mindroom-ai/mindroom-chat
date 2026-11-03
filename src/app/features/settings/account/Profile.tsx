import React, { FormEventHandler, useEffect, useState } from 'react';
import { Box, Button, Input, Spinner, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useUserProfile } from '../../../hooks/useUserProfile';
import { SequenceCard } from '../../../components/sequence-card';
import { SettingTile } from '../../../components/setting-tile';
import { SequenceCardStyle } from '../styles.css';

/** Display name editor for the signed-in account. */





  const [displayName, setDisplayName] = useState(profile.displayName ?? '');
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setDisplayName(profile.displayName ?? '');
  }, [profile.displayName]);

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    const name = displayName.trim();
    if (!name || name === profile.displayName) return;
    setSaving(true);
    setFailed(false);
    try {
      await mx.setDisplayName(name);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box direction="Column" gap="100">
      <Text size="L400">{t('featureUi.settings.account.profile.profile')}</Text>
      <SequenceCard
        className={SequenceCardStyle}
        variant="SurfaceVariant"
        direction="Column"
        gap="400"
      >
        <SettingTile title={t('featureUi.settings.account.profile.displayName')}>
          <Box as="form" onSubmit={handleSubmit} gap="200" alignItems="Center">
            <Box grow="Yes">
              <Input
                value={displayName}
                onChange={(event) => setDisplayName(event.currentTarget.value)}
                variant="Secondary"
                radii="300"
                aria-label={t('featureUi.settings.account.profile.displayName')}
              />
            </Box>
            <Button
              type="submit"
              size="400"
              variant="Success"
              fill="Solid"
              radii="300"
              disabled={saving || !displayName.trim() || displayName.trim() === profile.displayName}
              before={saving ? <Spinner size="100" variant="Success" fill="Solid" /> : undefined}
            >
              <Text size="B400">{t('featureUi.settings.account.profile.save')}</Text>
            </Button>
          </Box>
          {failed && (
            <Text size="T200" style={{ color: 'var(--mr-critical, #c62828)' }}>
              {t(
                'featureUi.settings.emojisStickers.globalPacks.failedToApplyChangesPleaseTryAgain'
              )}
            </Text>
          )}
        </SettingTile>
      </SequenceCard>
    </Box>
  );
}
