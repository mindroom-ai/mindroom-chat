import { isRecord } from '../lib/isRecord';
import type { MessageRenderer } from './messageRenderers';
import { pluginEntries, type PluginEntry } from './pluginEntries';
import { registerPluginTranslations, type PluginTranslations } from './pluginTranslations';

/** What the entry module of a client plugin exports by default: its contributions, by kind. */
export type ClientPlugin = {
  messageRenderers?: readonly MessageRenderer[];
  /** Deletes what the plugin keeps for `userId` outside its storage (`pluginStorage.ts`). */
  forgetAccount?: (userId: string) => void | Promise<void>;
  translations?: PluginTranslations;
};

/** A plugin of this build; `tag` (`<id>@<version>`) names it in logs and error reports. */
export type RegisteredPlugin = {
  readonly id: string;
  readonly tag: string;
  readonly messageRenderers: readonly MessageRenderer[];
  readonly forgetAccount?: ClientPlugin['forgetAccount'];
};

const register = ({ id, version, plugin }: PluginEntry): RegisteredPlugin => {
  const renderers = isRecord(plugin) ? plugin.messageRenderers : undefined;
  registerPluginTranslations(id, isRecord(plugin) ? plugin.translations : undefined);
  return Object.freeze({
    id,
    tag: `${id}@${version}`,
    // The build does not type-check plugins: anything but a list of renderers counts as none.
    messageRenderers: Object.freeze(
      Array.isArray(renderers)
        ? renderers.filter((renderer) => isRecord(renderer) && typeof renderer.match === 'function')
        : []
    ),
    forgetAccount:
      isRecord(plugin) && typeof plugin.forgetAccount === 'function'
        ? (plugin.forgetAccount.bind(plugin) as ClientPlugin['forgetAccount'])
        : undefined,
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
