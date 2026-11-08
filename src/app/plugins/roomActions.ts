import type { ReactNode } from 'react';
import type { IconSrc } from 'folds';
import type { Room } from 'matrix-js-sdk';
import { useTranslation } from 'react-i18next';
import type { ClientConfig } from '../config/useClientConfig';
import { isRecord } from '../lib/isRecord';
import { isPluginEnabled } from './pluginConfig';
import { getPluginTranslation, pluginNamespace } from './pluginTranslations';
import type { RegisteredPlugin } from './registry';

/** A dialog a room menu's entry shows: it stays after the menu has closed, and `close` ends it. */
export type PluginRoomDialog = (close: () => void) => ReactNode;

/**
 * An entry a plugin adds to every room's menu: a sidebar row's (More Options, a right-click, a
 * long press) and the open room header's.
 */
export type PluginRoomAction = {
  /** Names it among its plugin's room actions. */
  id: string;
  /** A key of the plugin's strings (`translations`): the entry's text. */
  label: string;
  /** Its icon, as folds draws one, such as `Icons.Star`. */
  icon: IconSrc;
  /** Whether this room's menu lists it; pure and synchronous. Without it, every room's does. */
  shows?: (room: Room) => boolean;
  /**
   * Runs it on the menu's room, open or not, once the menu has closed. `showDialog` shows a dialog
   * where the menu opened, as the room menu's own entries show theirs.
   */
  run: (action: {
    room: Room;
    showDialog: (dialog: PluginRoomDialog) => void;
  }) => void | Promise<void>;
};

/** Whether a plugin's contribution is a room action; the build does not type-check plugins. */
export const isPluginRoomAction = (value: unknown): value is PluginRoomAction =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  value.id !== '' &&
  typeof value.label === 'string' &&
  typeof value.icon === 'function' &&
  typeof value.run === 'function' &&
  (value.shows === undefined || typeof value.shows === 'function');

/** A plugin's entry in one room's menu. */
type PluginRoomEntry = {
  /** `<plugin id>/<action id>`. */
  id: string;
  /** Its plugin's tag, which names it in logs and error reports. */
  tag: string;
  /** In the app's language. */
  label: string;
  icon: IconSrc;
  /** Runs it on the room with the menu's `showDialog`. */
  run: (showDialog: (dialog: PluginRoomDialog) => void) => void;
};

/**
 * The entries the plugins config.json leaves on add to `room`'s menu, in build order, with their
 * labels in the app's language: it renders again when the language changes and once a plugin's
 * strings arrive. A `shows` that throws leaves out only its entry; it, and a `run` that throws or
 * returns a promise that rejects, are logged with the plugin's tag.
 */
export const usePluginRoomActions = (
  plugins: readonly RegisteredPlugin[],
  config: ClientConfig | undefined,
  room: Room
): PluginRoomEntry[] => {
  const enabled = plugins.filter(
    (plugin) => plugin.roomActions.length > 0 && isPluginEnabled(config, plugin.id)
  );
  useTranslation(enabled.map(({ id }) => pluginNamespace(id)) as never);
  return enabled.flatMap(({ id, tag, roomActions }) => {
    const t = getPluginTranslation(id);
    const fail = (what: string) => (error: unknown) => {
      // eslint-disable-next-line no-console
      console.error(`[plugin ${tag}] ${what}`, error);
    };
    const shows = (action: PluginRoomAction) => {
      try {
        return !action.shows || action.shows(room);
      } catch (error) {
        fail("its room action's shows failed")(error);
        return false;
      }
    };
    return roomActions.filter(shows).map((action) => ({
      id: `${id}/${action.id}`,
      tag,
      label: t(action.label),
      icon: action.icon,
      run: (showDialog) => {
        try {
          Promise.resolve(action.run({ room, showDialog })).catch(fail('its room action failed'));
        } catch (error) {
          fail('its room action failed')(error);
        }
      },
    }));
  });
};
