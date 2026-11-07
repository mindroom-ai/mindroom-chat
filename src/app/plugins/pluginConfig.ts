import { useOptionalClientConfig, type ClientConfig } from '../config/useClientConfig';
import { isRecord } from '../lib/isRecord';

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
 * A plugin's own section of the config.json the app shows, read while rendering, so a refreshed
 * configuration reaches the plugin. Unchecked: the plugin checks its settings itself.
 */
export const usePluginConfig = (pluginId: string): unknown =>
  pluginSection(useOptionalClientConfig(), pluginId);
