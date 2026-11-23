import { useMemo } from 'react';
import { useOptionalClientConfig, type ClientConfig } from '../config/useClientConfig';
import { isRecord } from '../lib/isRecord';
import { useAccountSettings } from '../matrix/hooks/useAccountSettings';

/**
 * `plugins.<id>` of config.json: `enabled` and the settings the plugin documents. `ClientConfig`
 * does not type the section, whose keys each plugin defines.
 */
const pluginSection = (config: ClientConfig | undefined, pluginId: string): unknown => {
  const sections: Readonly<Record<string, unknown>> | undefined = config;
  const plugins = sections?.plugins;
  return isRecord(plugins) && Object.hasOwn(plugins, pluginId) ? plugins[pluginId] : undefined;
};

/** Whether config.json leaves a plugin on: anything but `plugins.<id>.enabled: false` does. */
export const isPluginEnabled = (config: ClientConfig | undefined, pluginId: string): boolean => {
  const section = pluginSection(config, pluginId);
  return !isRecord(section) || section.enabled !== false;
};

/**
 * Returns `config` overlaid with `enabled: false` for every plugin ID in `disabledPlugins`,
 * preserving other config keys. Returns `config` unchanged when `disabledPlugins` is empty.
 */
export const withDisabledPlugins = (
  config: ClientConfig | undefined,
  disabledPlugins: readonly string[]
): ClientConfig | undefined => {
  if (disabledPlugins.length === 0) return config;
  const sections: Readonly<Record<string, unknown>> | undefined = config;
  const basePlugins = isRecord(sections?.plugins) ? sections.plugins : {};
  const nextPlugins: Record<string, unknown> = { ...basePlugins };
  for (const id of disabledPlugins) {
    const existing = Object.hasOwn(basePlugins, id) ? basePlugins[id] : undefined;
    Object.defineProperty(nextPlugins, id, {
      value: isRecord(existing) ? { ...existing, enabled: false } : { enabled: false },
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return { ...config, plugins: nextPlugins } as ClientConfig;
};

/**
 * The effective client configuration for plugin surfaces: deployment `config.json` overlaid with
 * the signed-in account's `disabledPlugins` from `io.mindroom.settings`.
 */
export const usePluginClientConfig = (): ClientConfig | undefined => {
  const config = useOptionalClientConfig();
  const { disabledPlugins } = useAccountSettings();
  return useMemo(() => withDisabledPlugins(config, disabledPlugins), [config, disabledPlugins]);
};

/**
 * A plugin's own section of the config.json the app shows, read while rendering, so a refreshed
 * configuration reaches the plugin. Unchecked: the plugin checks its settings itself.
 */
export const usePluginConfig = (pluginId: string): unknown =>
  pluginSection(useOptionalClientConfig(), pluginId);
