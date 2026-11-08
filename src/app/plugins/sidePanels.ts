import { type ComponentType, createContext, useContext, useMemo } from 'react';
import type { ClientConfig } from '../config/useClientConfig';
import { isRecord } from '../lib/isRecord';
import { isPluginEnabled } from './pluginConfig';
import type { RegisteredPlugin } from './registry';

/**
 * A panel a plugin adds beside a room. It is one of the room's side panels: one shows at a time,
 * and opening one closes the others (src/app/ui/panels/roomPanels.ts).
 */
export type SidePanel = {
  /** Names it among its plugin's panels. */
  id: string;
  /** Its title, and the room menu's entry that shows and hides it. */
  label: string;
  /**
   * What it shows, for the room it is open in. `request` is what the plugin's code asked it to show
   * when it last opened it ({@link useRoomSidePanel}), or undefined after the room menu opened it.
   */
  Component: ComponentType<{ roomId: string; request?: unknown }>;
  /**
   * Whether the signed-in account keeps it open, with its request, in each room it opened in, across
   * reloads and room switches, until it closes there (its Close, the room menu, another panel).
   */
  remember?: boolean;
};

/** Whether a plugin's contribution is a side panel; the build does not type-check plugins. */
export const isSidePanel = (value: unknown): value is SidePanel =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  value.id !== '' &&
  typeof value.label === 'string' &&
  (typeof value.Component === 'function' || isRecord(value.Component));

/** A plugin's side panel in a room: `id` is `<plugin id>/<panel id>`, `tag` names its plugin. */
export type RoomSidePanel = SidePanel & { tag: string };

/** The side panels of the plugins config.json leaves on, in build order. */
export const enabledSidePanels = (
  plugins: readonly RegisteredPlugin[],
  config: ClientConfig | undefined
): RoomSidePanel[] =>
  plugins
    .filter((plugin) => isPluginEnabled(config, plugin.id))
    .flatMap(({ id, tag, sidePanels }) =>
      sidePanels.map((panel) => ({ ...panel, id: `${id}/${panel.id}`, tag }))
    );

/** What the open room lets plugin code do with its plugins' panels. */
export type PluginPanelControls = {
  /** The id of the panel the room shows. */
  shown: string | undefined;
  /** Opens a plugin's panel by its rule and hands it `request`; nothing for an unknown panel. */
  open: (id: string, request: unknown) => void;
  /** Closes a plugin's panel if the room shows it. */
  close: (id: string) => void;
};

/** Given by the room's page (src/app/room/Room.tsx) to what it renders. */
export const PluginPanelControlsContext = createContext<PluginPanelControls | undefined>(undefined);

/** A plugin's side panel in the open room, for the plugin's code. */
export type RoomSidePanelControl = {
  /** Whether the room shows it (beside the conversation, across the room or folded to a tab). */
  isOpen: boolean;
  /**
   * Opens it as the room menu does, taking the side panel from any other, or keeps it open, and
   * hands its `Component` `request`. A panel that `remember`s keeps the request as JSON. It keeps
   * its identity while the room shows. Call it in answer to something new, such as a click, never as
   * a component mounts: the conversation's components mount again each time it shows again.
   */
  open: (request?: unknown) => void;
  /** Closes it, if the room shows it; it keeps its identity as `open` does. */
  close: () => void;
};

/**
 * The side panel `panelId` of plugin `pluginId` in the room open where this renders, such as a
 * message renderer's card in the room's timeline; undefined outside a room's page (the inbox, the
 * search page).
 */
export const useRoomSidePanel = (
  pluginId: string,
  panelId: string
): RoomSidePanelControl | undefined => {
  const controls = useContext(PluginPanelControlsContext);
  const id = `${pluginId}/${panelId}`;
  const roomOpen = controls?.open;
  const roomClose = controls?.close;
  const actions = useMemo(
    () =>
      roomOpen &&
      roomClose && {
        open: (request?: unknown) => roomOpen(id, request),
        close: () => roomClose(id),
      },
    [id, roomClose, roomOpen]
  );
  const isOpen = controls?.shown === id;
  return useMemo(() => actions && { ...actions, isOpen }, [actions, isOpen]);
};
