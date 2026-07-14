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

const ANTHROPIC_ICON_PATH =
  'M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z';
const CLAUDE_MODEL_ID_PATTERN = /(?:^|[./:])claude-/;

function AnthropicIcon({ className, size }: { className?: string; size: number }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      focusable="false"
      aria-hidden
    >
      <path d={ANTHROPIC_ICON_PATH} />
    </svg>
  );
}

const isAnthropicModel = (info: MindroomAiRunInfo): boolean => {
  const provider = info.modelProvider?.toLowerCase() ?? '';
  const modelId = info.modelId?.toLowerCase() ?? '';
  return (
    provider.includes('anthropic') ||
    provider.includes('claude') ||
    CLAUDE_MODEL_ID_PATTERN.test(modelId)
  );
};

const getProviderIcon = (provider: string | undefined): TablerIcon => {
  const normalizedProvider = provider?.toLowerCase() ?? '';
  if (normalizedProvider.includes('openai') || normalizedProvider.includes('codex')) {
    return IconBrandOpenai;
  }
  if (normalizedProvider.includes('google') || normalizedProvider.includes('gemini')) {
    return IconBrandGoogle;
  }
  if (normalizedProvider.includes('meta')) return IconBrandMeta;
  if (normalizedProvider.includes('bedrock') || normalizedProvider.includes('aws')) {
    return IconBrandAws;
  }
  if (normalizedProvider.includes('azure')) return IconBrandAzure;
  if (normalizedProvider.includes('ollama') || normalizedProvider.includes('local'))
    return IconRobot;
  return IconSparkles;
};

export function MindroomModelBadge({ info }: { info: MindroomAiRunInfo }) {
  const label = getMindroomAiRunCompactModelLabel(info);
  if (!label) return null;

  const fullModelLabel = getMindroomAiRunModelLabel(info) ?? label;
  const ProviderIcon = getProviderIcon(info.modelProvider);
  const icon = isAnthropicModel(info) ? (
    <AnthropicIcon className={css.Icon} size={10} />
  ) : (
    <ProviderIcon className={css.Icon} size={10} stroke={1.8} aria-hidden />
  );

  return (
    <span className={css.Badge} title={fullModelLabel} aria-label={`Model: ${fullModelLabel}`}>
      {icon}
      <span className={css.Label}>{label}</span>
    </span>
  );
}
