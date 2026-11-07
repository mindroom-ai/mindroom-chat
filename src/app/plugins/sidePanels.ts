import type { ComponentType } from 'react';
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
  /** What it shows, for the room it is open in. */
  Component: ComponentType<{ roomId: string }>;
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
