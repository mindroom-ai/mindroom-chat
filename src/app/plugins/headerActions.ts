import type { IconSrc } from 'folds';
import { useTranslation } from 'react-i18next';
import type { ClientConfig } from '../config/useClientConfig';
import { isRecord } from '../lib/isRecord';
import { isPluginEnabled } from './pluginConfig';
import { getPluginTranslation, pluginNamespace } from './pluginTranslations';
import type { RegisteredPlugin } from './registry';

/** The placements a plugin may give what it adds to the room header. */
export const PLACEMENTS: readonly unknown[] = ['auto', 'menu'];

/** The open room, and the thread open in it, that an action runs in. */
export type HeaderActionRoom = { roomId: string; threadId?: string };

/** An action a plugin adds to the room header: a button in its row, or an entry of its room menu. */
export type HeaderAction = {
  /** Names it among its plugin's actions. */
  id: string;
  /** A key of the plugin's strings (`translations`): its name, on its button and its menu entry. */
  label: string;
  /** Its icon, as folds draws one, such as `Icons.Star`. */
  icon: IconSrc;
  /**
   * Where it shows: `auto` in the header's row, except on phones, where it goes in the room menu;
   * `menu`, the default, always in the room menu.
   */
  placement?: 'auto' | 'menu';
  /** Runs it in the open room. */
  run: (room: HeaderActionRoom) => void | Promise<void>;
};

/** Whether a plugin's contribution is a header action; the build does not type-check plugins. */
export const isHeaderAction = (value: unknown): value is HeaderAction =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  value.id !== '' &&
  typeof value.label === 'string' &&
  typeof value.icon === 'function' &&
  typeof value.run === 'function' &&
  (value.placement === undefined || PLACEMENTS.includes(value.placement));

/** A plugin's header action: `id` is `<plugin id>/<action id>`, `label` is in the app's language. */
export type PluginHeaderAction = Omit<Required<HeaderAction>, 'run'> & {
  run: (room: HeaderActionRoom) => void;
};

/**
 * The header actions of the plugins config.json leaves on, in build order, with their labels in
 * the app's language: it renders again when the language changes and once a plugin's strings
 * arrive. An action whose `run` throws, or returns a promise that rejects, is logged with its
 * plugin's tag.
 */
export const usePluginHeaderActions = (
  plugins: readonly RegisteredPlugin[],
  config: ClientConfig | undefined
): PluginHeaderAction[] => {
  const enabled = plugins.filter(
    (plugin) => plugin.headerActions.length > 0 && isPluginEnabled(config, plugin.id)
  );
  useTranslation(enabled.map(({ id }) => pluginNamespace(id)) as never);
  return enabled.flatMap(({ id, tag, headerActions }) => {
    const t = getPluginTranslation(id);
    return headerActions.map((action) => ({
      id: `${id}/${action.id}`,
      label: t(action.label),
      icon: action.icon,
      placement: action.placement ?? 'menu',
      run: (room: HeaderActionRoom) => {
        const fail = (error: unknown) => {
          // eslint-disable-next-line no-console
          console.error(`[plugin ${tag}] its header action failed`, error);
        };
        try {
          Promise.resolve(action.run(room)).catch(fail);
        } catch (error) {
          fail(error);
        }
      },
    }));
  });
};
