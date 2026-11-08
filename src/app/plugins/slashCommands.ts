import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import type { ClientConfig } from '../config/useClientConfig';
import { isRecord } from '../lib/isRecord';
import { isPluginEnabled } from './pluginConfig';
import { pluginNamespace } from './pluginTranslations';
import type { RegisteredPlugin } from './registry';

/** A slash command a plugin adds to the composer, offered and run beside the app's own. */
export type PluginSlashCommand = {
  /** What follows the `/`: letters a to z only, as the composer reads command names. */
  name: string;
  /** A key of the plugin's strings (`translations`): what the command does, in the command menu. */
  description: string;
  /** Runs it in the room whose composer sent it, with the text typed after the name. */
  run: (command: { room: Room; args: string }) => void | Promise<void>;
};

/** Whether a plugin's contribution is a slash command; the build does not type-check plugins. */
export const isPluginSlashCommand = (value: unknown): value is PluginSlashCommand =>
  isRecord(value) &&
  typeof value.name === 'string' &&
  /^[a-z]+$/.test(value.name) &&
  typeof value.description === 'string' &&
  typeof value.run === 'function';

/** A plugin's command as the composer offers it, with its description in the app's language. */
export type EnabledSlashCommand = {
  name: string;
  description: string;
  run: (room: Room, args: string) => Promise<void>;
};

/** The names two plugins both claim, each warned about once. */
const warnedNames = new Set<string>();

/**
 * The slash commands of the plugins config.json leaves on, in build order. A name more than one of
 * them claims is no command of any. It renders again when the language changes and once a plugin's
 * strings arrive; a `run` that throws rejects instead.
 */
export const usePluginSlashCommands = (
  plugins: readonly RegisteredPlugin[],
  config: ClientConfig | undefined
): EnabledSlashCommand[] => {
  const enabled = useMemo(
    () =>
      plugins.filter(
        (plugin) => plugin.slashCommands.length > 0 && isPluginEnabled(config, plugin.id)
      ),
    [config, plugins]
  );
  // The app's typed keys cover its own catalog only.
  const { t } = useTranslation(enabled.map(({ id }) => pluginNamespace(id)) as never);
  const translate = t as unknown as (key: string, options: { ns: string }) => string;
  return useMemo(() => {
    const claims = new Map<string, string[]>();
    enabled.forEach(({ tag, slashCommands }) =>
      slashCommands.forEach(({ name }) => claims.set(name, [...(claims.get(name) ?? []), tag]))
    );
    return enabled.flatMap(({ id, slashCommands }) =>
      slashCommands
        .filter(({ name }) => {
          const tags = claims.get(name) ?? [];
          if (tags.length === 1) return true;
          if (!warnedNames.has(name)) {
            warnedNames.add(name);
            const who = tags.join(', ');
            // eslint-disable-next-line no-console
            console.warn(`[plugins ${who}] each add the slash command /${name}, so none runs it`);
          }
          return false;
        })
        .map((command) => ({
          name: command.name,
          description: translate(command.description, { ns: pluginNamespace(id) }),
          run: async (room: Room, args: string) => command.run({ room, args }),
        }))
    );
  }, [enabled, translate]);
};
