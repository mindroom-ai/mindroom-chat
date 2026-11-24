import { useMemo } from 'react';
import { useOptionalClientConfig, type ClientConfig } from '../config/useClientConfig';
import { isRecord } from '../lib/isRecord';
import { useAccountSettings } from '../matrix/hooks/useAccountSettings';
import type { PluginPreferences } from '../preferences/accountSettings';
import { registeredPlugins, type RegisteredPlugin } from './registry';

export { isPluginEnabled, usePluginConfig } from './pluginDeploymentConfig';

/**
 * Whether an account's preferences leave `plugin` on (independent of deployment `config.json`):
 * `disabledPlugins` takes precedence over `enabledPlugins`, which takes precedence over
 * `plugin.defaultEnabled`.
 */
export const isPluginPreferredEnabled = (
  plugin: Pick<RegisteredPlugin, 'id' | 'defaultEnabled'>,
  preferences: PluginPreferences
): boolean => {
  if (preferences.disabledPlugins.includes(plugin.id)) return false;
  if (preferences.enabledPlugins.includes(plugin.id)) return true;
  return plugin.defaultEnabled;
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
 * Returns `config` overlaid with `enabled: false` for every plugin turned off by `preferences`
 * or by `defaultEnabled: false` without an opt-in in `preferences.enabledPlugins`. Never overrides
 * deployment `plugins.<id>.enabled: false`, and returns `config` unchanged when none are disabled.
 */
export const withPluginPreferences = (
  config: ClientConfig | undefined,
  plugins: readonly Pick<RegisteredPlugin, 'id' | 'defaultEnabled'>[],
  preferences: PluginPreferences
): ClientConfig | undefined => {
  const disabledIds = new Set<string>(preferences.disabledPlugins);
  for (const plugin of plugins) {
    if (!isPluginPreferredEnabled(plugin, preferences)) {
      disabledIds.add(plugin.id);
    }
  }
  return withDisabledPlugins(config, [...disabledIds]);
};

/**
 * The effective client configuration for plugin surfaces: deployment `config.json` overlaid with
 * each plugin's `defaultEnabled` and the signed-in account's `disabledPlugins` / `enabledPlugins`
 * from `io.mindroom.settings`.
 */
export const usePluginClientConfig = (): ClientConfig | undefined => {
  const config = useOptionalClientConfig();
  const { disabledPlugins, enabledPlugins } = useAccountSettings();
  return useMemo(
    () => withPluginPreferences(config, registeredPlugins, { disabledPlugins, enabledPlugins }),
    [config, disabledPlugins, enabledPlugins]
  );
};
