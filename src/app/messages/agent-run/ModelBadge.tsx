import React, { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AiRunInfo } from '../../matrix/protocol/aiRun';
import { getAiRunCompactModelLabel, getAiRunModelLabel } from './aiRunDisplay';
import { ProviderModelIcon } from '../../models/ProviderModelIcon';
import { TipButton } from '../../ui/TipButton';
import * as css from './ModelBadge.css';

/** An agent's avatar with its model's provider mark in the corner, when the model is known. */
export function AvatarModelMark({ info, children }: { info: AiRunInfo; children: ReactNode }) {
  return (
    <div className={css.Frame}>
      {children}
      {getAiRunCompactModelLabel(info) && (
        <span className={css.Mark} aria-hidden="true">
          <ProviderModelIcon provider={info.modelProvider} id={info.modelId} size={10} />
        </span>
      )}
    </div>
  );
}

/** The model's name under an agent's avatar; a hover, focus or tap shows its full details. */
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
      <span className={css.Label} dir="auto">
        {label}
      </span>
    </TipButton>
  );
}
