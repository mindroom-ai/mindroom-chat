import React, { FormEventHandler, useEffect, useState } from 'react';
import { Box, Button, Input, Spinner, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useUserProfile } from '../../../hooks/useUserProfile';
import { SequenceCard } from '../../../components/sequence-card';
import { SettingTile } from '../../../components/setting-tile';
import { SequenceCardStyle } from '../styles.css';

const CARD_PROPS = {
  className: SequenceCardStyle,
  variant: 'SurfaceVariant',
  direction: 'Column',
  gap: '400',
} as const;

/** Display name editor for the signed-in account. */



  const { displayName: savedName } = useUserProfile(mx.getSafeUserId());
  const [draft, setDraft] = useState(savedName ?? '');
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  // A new name from the server (or another device) replaces the draft.
  useEffect(() => setDraft(savedName ?? ''), [savedName]);

  const nextName = draft.trim();
  const canSave = nextName !== '' && nextName !== savedName;

  const handleSubmit: FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (!canSave) return;
    setFailed(false);
    setSaving(true);
    mx.setDisplayName(nextName)
      .catch(() => setFailed(true))
      .finally(() => setSaving(false));
  };

  const label = t('featureUi.settings.account.profile.displayName');

  return (
    <Box direction="Column" gap="100">
      <Text size="L400">{t('featureUi.settings.account.profile.profile')}</Text>
      <SequenceCard {...CARD_PROPS}>
        <SettingTile title={label}>
          <Box as="form" alignItems="Center" gap="200" onSubmit={handleSubmit}>
            <Box grow="Yes">
              <Input
                aria-label={label}
                variant="Secondary"
                radii="300"
                value={draft}
                onChange={(event) => setDraft(event.currentTarget.value)}
              />
            </Box>
            <Button
              type="submit"
              variant="Success"
              fill="Solid"
              size="400"
              radii="300"
              disabled={saving || !canSave}
              before={saving ? <Spinner variant="Success" fill="Solid" size="100" /> : undefined}
            >
              <Text size="B400">{t('featureUi.settings.account.profile.save')}</Text>
            </Button>
          </Box>
          {failed ? (
            <Text size="T200" style={{ color: 'var(--mr-critical, #c62828)' }}>
              {t(
                'featureUi.settings.emojisStickers.globalPacks.failedToApplyChangesPleaseTryAgain'
              )}
            </Text>
          ) : null}
        </SettingTile>
      </SequenceCard>
    </Box>
  );
}
