import React from 'react';
import { Icon, IconButton, Icons } from 'folds';
import { useTranslation } from 'react-i18next';
import type { CallEmbed } from '../../plugins/call/CallEmbed';

/** Leaves the call. */
export function CallControl({ callEmbed }: { callEmbed: CallEmbed }) {
  const { t } = useTranslation();
  const hangup = (callEmbed as unknown as { hangup?: () => void }).hangup;
  return (
    <IconButton
      variant="Critical"
      radii="300"
      size="300"
      aria-label={t('featureUi.callStatus.leave')}
      onClick={() => hangup?.call(callEmbed)}
    >
      <Icon size="100" src={Icons.PhoneDown} />
    </IconButton>
  );
}
