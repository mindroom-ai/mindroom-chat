import React from 'react';
import { useTranslation } from 'react-i18next';
import { AiRunInfo } from '../../matrix/protocol/aiRun';
import { getAiRunCompactModelLabel, getAiRunModelLabel } from './aiRunDisplay';
import { ProviderModelIcon } from '../../models/ProviderModelIcon';
import { ownDirectionLine } from '../../ui/directional';
import { TipButton } from '../../ui/TipButton';
import * as css from './ModelBadge.css';

export function ModelBadge({ info }: { info: AiRunInfo }) {
  const { t } = useTranslation();
  const label = getAiRunCompactModelLabel(info);
  if (!label) return null;

  const modelDetails = getAiRunModelLabel(info);
  const fullModelLabel =
    info.modelDisplayName && modelDetails && modelDetails !== label
      ? `${label} · ${modelDetails}`
      : modelDetails ?? label;

  return (
    <TipButton
      className={css.Badge}
      tip={fullModelLabel}
      aria-label={t('mindroomUi.messages.mindroomModelBadge.model', { model: fullModelLabel })}
    >
      <ProviderModelIcon
        provider={info.modelProvider}
        id={info.modelId}
        className={css.Icon}
        size={10}
      />
      <span className={css.Label} {...ownDirectionLine}>{label}</span>
    </TipButton>
  );
}
