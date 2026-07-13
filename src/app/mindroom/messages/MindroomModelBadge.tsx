import {
  IconBrandAws,
  IconBrandAzure,
  IconBrandGoogle,
  IconBrandMeta,
  IconBrandOpenai,
  IconRobot,
  IconSparkles,
  TablerIcon,
} from '@tabler/icons-react';
import React from 'react';
import { MindroomAiRunInfo } from './aiRun';
import { getMindroomAiRunCompactModelLabel, getMindroomAiRunModelLabel } from './aiRunDisplay';
import * as css from './MindroomModelBadge.css';

const getProviderIcon = (provider: string | undefined): TablerIcon => {
  const normalized = provider?.toLowerCase() ?? '';
  if (normalized.includes('openai') || normalized.includes('codex')) return IconBrandOpenai;
  if (normalized.includes('google') || normalized.includes('gemini')) return IconBrandGoogle;
  if (normalized.includes('meta')) return IconBrandMeta;
  if (normalized.includes('bedrock') || normalized.includes('aws')) return IconBrandAws;
  if (normalized.includes('azure')) return IconBrandAzure;
  if (normalized.includes('ollama') || normalized.includes('local')) return IconRobot;
  return IconSparkles;
};

export function MindroomModelBadge({ info }: { info: MindroomAiRunInfo }) {
  const label = getMindroomAiRunCompactModelLabel(info);
  if (!label) return null;

  const fullModelLabel = getMindroomAiRunModelLabel(info) ?? label;
  const ProviderIcon = getProviderIcon(info.modelProvider);

  return (
    <span className={css.Badge} title={fullModelLabel} aria-label={`Model: ${fullModelLabel}`}>
      <ProviderIcon className={css.Icon} size={10} stroke={1.8} aria-hidden />
      <span className={css.Label}>{label}</span>
    </span>
  );
}
