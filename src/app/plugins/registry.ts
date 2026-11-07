import type { ComponentType } from 'react';
import type { Room } from 'matrix-js-sdk';
import { isRecord } from '../lib/isRecord';
import { isHeaderAction, type HeaderAction } from './headerActions';
import { isConversationCover, type ConversationCover } from './conversationCovers';
import type { MessageRenderer } from './messageRenderers';
import type { PluginPage } from './pluginPages';
import { pluginEntries, type PluginEntry } from './pluginEntries';
import { isSidePanel, type SidePanel } from './sidePanels';
import { registerPluginTranslations, type PluginTranslations } from './pluginTranslations';

/** A component shown under the room header, given the open room; it renders there or nothing. */
export type RoomHeaderSlotComponent = ComponentType<{ room: Room }>;

/** What the entry module of a client plugin exports by default: its contributions, by kind. */
export type ClientPlugin = {
  conversationCovers?: readonly ConversationCover[];
  messageRenderers?: readonly MessageRenderer[];
  pages?: readonly PluginPage[];
  /** Deletes what the plugin keeps for `userId` outside its storage (`pluginStorage.ts`). */
  forgetAccount?: (userId: string) => void | Promise<void>;
  roomHeaderSlot?: readonly RoomHeaderSlotComponent[];
  sidePanels?: readonly SidePanel[];
  headerActions?: readonly HeaderAction[];
  translations?: PluginTranslations;
};

/** A plugin of this build; `tag` (`<id>@<version>`) names it in logs and error reports. */
export type RegisteredPlugin = {
  readonly id: string;
  readonly tag: string;
  readonly conversationCovers: readonly ConversationCover[];
  readonly messageRenderers: readonly MessageRenderer[];
  readonly pages: readonly PluginPage[];
  readonly forgetAccount?: ClientPlugin['forgetAccount'];
  readonly roomHeaderSlot: readonly RoomHeaderSlotComponent[];
  readonly sidePanels: readonly SidePanel[];
  readonly headerActions: readonly HeaderAction[];
};

const register = ({ id, version, plugin }: PluginEntry): RegisteredPlugin => {
  const renderers = isRecord(plugin) ? plugin.messageRenderers : undefined;
  const pages = isRecord(plugin) ? plugin.pages : undefined;
  const headerSlot = isRecord(plugin) ? plugin.roomHeaderSlot : undefined;
  const panels = isRecord(plugin) ? plugin.sidePanels : undefined;
  const actions = isRecord(plugin) ? plugin.headerActions : undefined;
  const covers = isRecord(plugin) ? plugin.conversationCovers : undefined;
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
    pages: Object.freeze(
      Array.isArray(pages)
        ? pages.filter(
            (page) => isRecord(page) && typeof page.path === 'string' && !!page.Component
          )
        : []
    ),
    forgetAccount:
      isRecord(plugin) && typeof plugin.forgetAccount === 'function'
        ? (plugin.forgetAccount.bind(plugin) as ClientPlugin['forgetAccount'])
        : undefined,
    // Its slot renders each entry in a boundary, so one that is no component only fails there.
    roomHeaderSlot: Object.freeze(Array.isArray(headerSlot) ? [...headerSlot] : []),
    sidePanels: Object.freeze(Array.isArray(panels) ? panels.filter(isSidePanel) : []),
    headerActions: Object.freeze(Array.isArray(actions) ? actions.filter(isHeaderAction) : []),
    conversationCovers: Object.freeze(
      Array.isArray(covers) ? covers.filter(isConversationCover) : []
    ),
  });
};

/** Whether the address of this page load turns every plugin off. */
const pluginsOff = (): boolean =>
  typeof window !== 'undefined' &&
  // A test's stand-in window may have no location.
  new URLSearchParams(window.location?.search).get('plugins') === 'off';

/**
 * The plugins of this build, in the order MINDROOM_CLIENT_PLUGINS lists them, built and frozen when
 * this module loads; none for a load whose address has `?plugins=off`. src/index.tsx loads it first,
 * so a redirect (to sign in, say) cannot drop that parameter before it is read.
 */
export const registeredPlugins: readonly RegisteredPlugin[] = Object.freeze(
  pluginsOff() ? [] : pluginEntries.map(register)
);
