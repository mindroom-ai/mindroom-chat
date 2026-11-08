import { type ComponentType, createContext, useContext, useMemo } from 'react';
import type { IconSrc } from 'folds';
import type { ClientConfig } from '../config/useClientConfig';
import { isRecord } from '../lib/isRecord';
import { PLACEMENTS, type HeaderAction } from './headerActions';
import { isPluginEnabled } from './pluginConfig';
import type { RegisteredPlugin } from './registry';

/**
 * A panel a plugin adds beside a room. It is one of the room's side panels: one shows at a time,
 * and opening one closes the others (src/app/ui/panels/roomPanels.ts).
 */
export type SidePanel = {
  /** Names it among its plugin's panels. */
  id: string;
  /** Its title, and the name of its toggle in the room header, which shows and hides it. */
  label: string;
  /** Its toggle's icon, as folds draws one, such as `Icons.Star`; a bulb by default. */
  icon?: IconSrc;
  /**
   * Where its toggle shows, as a header action's does: `auto` in the header's row, except on
   * phones, where it goes in the room menu; `menu`, the default, always in the room menu. The
   * toggle is pressed while the room shows the panel, not folded to its tab; folded, choosing it
   * unfolds the panel.
   */
  placement?: HeaderAction['placement'];
  /**
   * What it shows, for the room it is open in. `request` is what the plugin's code asked it to show
   * when it last opened it ({@link useRoomSidePanel}), or undefined after its toggle opened it.
   */
  Component: ComponentType<{ roomId: string; request?: unknown }>;
  /**
   * Whether the signed-in account keeps it open, with its request, in each room it opened in,
   * across reloads and room switches, until it closes there (its Close, its toggle, another
   * panel) or the account's last login leaves this browser.
   */
  remember?: boolean;
};

/** Whether a plugin's contribution is a side panel; the build does not type-check plugins. */
export const isSidePanel = (value: unknown): value is SidePanel =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  value.id !== '' &&
  typeof value.label === 'string' &&
  (typeof value.Component === 'function' || isRecord(value.Component)) &&
  (value.icon === undefined || typeof value.icon === 'function') &&
  (value.placement === undefined || PLACEMENTS.includes(value.placement));

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
  /** Opens a plugin's panel beside the thread `threadId`, as {@link RoomSidePanelControl} says. */
  openBesideThread: (id: string, threadId: string, request: unknown) => void;
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
   * Opens it as its toggle does, taking the side panel from any other, or keeps it open, and
   * hands its `Component` `request`. A panel that `remember`s keeps the request as JSON in this
   * browser, so the request should hold only what the panel needs to open again, never secrets or
   * message text. `open` keeps its identity while the room shows. Call it in answer to something
   * the person does, such as a click, never as a component mounts: the conversation's components
   * mount again whenever it shows another thread or view. To open as one mounts, see
   * `openBesideThread`.
   */
  open: (request?: unknown) => void;
  /**
   * Opens it beside the thread `threadId` with `request`, as a renderer of that thread's root
   * message may ask from an effect that depends on it: it takes a new identity whenever the room
   * shows another thread or its own timeline, so the effect asks again then, also in a card that
   * stays mounted as its thread opens. Only the first call since the room began to show that thread
   * counts, so a component that mounts again does not open a panel the person closed; once another
   * thread or the room's own timeline has shown, the thread's next call counts again. That call
   * does something only while the room shows that thread and not on a phone: it opens the panel
   * when no other side panel shows, and when the panel itself shows, it hands it `request` and
   * leaves it folded or filling the room. Otherwise it does nothing.
   */
  openBesideThread: (threadId: string, request?: unknown) => void;
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
  const roomOpenBeside = controls?.openBesideThread;
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
  // Its own memo: it changes with each thread the room shows, `open` and `close` do not.
  const openBesideThread = useMemo(
    () =>
      roomOpenBeside &&
      ((threadId: string, request?: unknown) => roomOpenBeside(id, threadId, request)),
    [id, roomOpenBeside]
  );
  const isOpen = controls?.shown === id;
  return useMemo(
    () => actions && openBesideThread && { ...actions, openBesideThread, isOpen },
    [actions, isOpen, openBesideThread]
  );
};
