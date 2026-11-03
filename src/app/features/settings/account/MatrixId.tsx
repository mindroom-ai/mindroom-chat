import React, { useState } from 'react';
import { Box, Chip, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { SequenceCard } from '../../../components/sequence-card';
import { SettingTile } from '../../../components/setting-tile';
import { copyToClipboard } from '../../../utils/dom';
import { SequenceCardStyle } from '../styles.css';

/** The signed-in Matrix ID with a copy button that confirms only a real copy. */



  const userId = mx.getUserId() ?? '';
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {






      <SequenceCard
        className={SequenceCardStyle}
        variant="SurfaceVariant"
        direction="Column"
        gap="400"
      >
        <SettingTile
          title={userId}
          after={
            <Chip variant="Secondary" radii="Pill" onClick={handleCopy}>
              <Text size="T200">
                {copied
                  ? t('featureUi.settings.account.matrixId.copied')
                  : t('featureUi.settings.account.matrixId.copy')}
              </Text>
            </Chip>
          }
        />
      </SequenceCard>
    </Box>
  );
}
