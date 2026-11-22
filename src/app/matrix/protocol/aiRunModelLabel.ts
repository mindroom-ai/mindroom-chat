import type { AiRunModelInfo } from './aiRun';

/** The full model name: its config key with provider and model ID, for a tooltip. */
export const getAiRunModelLabel = (info: AiRunModelInfo): string | undefined => {
  const providerAndId = [info.modelProvider, info.modelId].filter(Boolean).join(' / ');
  if (info.modelConfig && providerAndId) return `${info.modelConfig} (${providerAndId})`;
  if (info.modelConfig) return info.modelConfig;
  return providerAndId || undefined;
};

const GENERIC_MODEL_CONFIGS = new Set(['auto', 'default']);

const titleCaseWords = (value: string): string =>
  value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');

const formatModelId = (modelId: string): string => {
  const claudeMatch = modelId.match(/claude-(?:\d+(?:[-.]\d+)*-)?(opus|sonnet|haiku)(?:-(.*))?/i);
  if (claudeMatch) {
    const family = titleCaseWords(claudeMatch[1]!);
    const version = claudeMatch[2]?.replace(/-/g, '.').replace(/(?:^|\.)latest$/i, '');
    return version ? `${family} ${version}` : family;
  }

  if (/^gpt-/i.test(modelId)) return modelId.replace(/^gpt/i, 'GPT');
  return titleCaseWords(modelId.replace(/-/g, ' '));
};

/** A short, friendly model name intended for the always-visible message badge. */
export const getAiRunCompactModelLabel = (info: AiRunModelInfo): string | undefined => {
  if (info.modelDisplayName) return info.modelDisplayName;

  const modelConfig = info.modelConfig?.trim();
  if (modelConfig && !GENERIC_MODEL_CONFIGS.has(modelConfig.toLowerCase())) {
    return titleCaseWords(modelConfig);
  }

  const modelId = info.modelId?.trim();
  if (modelId) return formatModelId(modelId);

  const provider = info.modelProvider?.trim();
  return provider ? titleCaseWords(provider) : undefined;
};
