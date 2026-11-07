import type { ComponentType } from 'react';
import type { Room } from 'matrix-js-sdk';
import { isRecord } from '../lib/isRecord';
import type { MessageRenderer } from './messageRenderers';
import { pluginEntries, type PluginEntry } from './pluginEntries';

/** What the entry module of a client plugin exports by default: its contributions, by kind. */
export type ClientPlugin = {
  messageRenderers?: readonly MessageRenderer[];
  /** Components shown under the room header, given the open room; each renders there or nothing. */
  roomHeaderSlot?: readonly ComponentType<{ room: Room }>[];
};

/** A plugin of this build; `tag` (`<id>@<version>`) names it in logs and error reports. */
export type RegisteredPlugin = {
  readonly id: string;
  readonly tag: string;
  readonly messageRenderers: readonly MessageRenderer[];
  readonly roomHeaderSlot: readonly ComponentType<{ room: Room }>[];
};

const register = ({ id, version, plugin }: PluginEntry): RegisteredPlugin => {
  const renderers = isRecord(plugin) ? plugin.messageRenderers : undefined;
  const headerSlot = isRecord(plugin) ? plugin.roomHeaderSlot : undefined;
  return Object.freeze({
    id,
    tag: `${id}@${version}`,
    // The build does not type-check plugins: anything but a list of renderers counts as none.
    messageRenderers: Object.freeze(
      Array.isArray(renderers)
        ? renderers.filter((renderer) => isRecord(renderer) && typeof renderer.match === 'function')
        : []
    ),
    // Its slot renders each entry in a boundary, so one that is no component only fails there.
    roomHeaderSlot: Object.freeze(Array.isArray(headerSlot) ? [...headerSlot] : []),
  });
};

/** Whether the address of this page load turns every plugin off. */
const pluginsOff = (): boolean =>
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('plugins') === 'off';

/**
 * The plugins of this build, in the order MINDROOM_CLIENT_PLUGINS lists them, built and frozen when
 * this module loads; none for a load whose address has `?plugins=off`. src/index.tsx loads it first,
 * so a redirect (to sign in, say) cannot drop that parameter before it is read.
 */
export const registeredPlugins: readonly RegisteredPlugin[] = Object.freeze(
  pluginsOff() ? [] : pluginEntries.map(register)
);
