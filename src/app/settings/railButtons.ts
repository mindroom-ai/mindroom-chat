import { canvasesEnabled } from '../config/canvases';
import { useClientConfig } from '../config/useClientConfig';
import { useShowLocalMindroom } from '../local-mindroom/useShowLocalMindroom';
import type { BooleanAccountSetting } from '../preferences/accountSettings';
import { useAccountSettings } from '../matrix/hooks/useAccountSettings';

/** The icon rail buttons each person can hide in Settings. */
export type RailButton =
  'threads' | 'canvases' | 'usage' | 'explore' | 'createSpace' | 'search' | 'localMindroom';

export type RailButtons = Record<RailButton, boolean>;

/** The `io.mindroom.settings` switch that shows or hides each button. */
export const RAIL_BUTTON_SETTING: Record<RailButton, BooleanAccountSetting> = {
  threads: 'showThreadsInSidebar',
  canvases: 'showCanvasesInSidebar',
  usage: 'showUsageInSidebar',
  explore: 'showExploreInSidebar',
  createSpace: 'showCreateSpaceInSidebar',
  search: 'showSearchInSidebar',
  localMindroom: 'showLocalMindroomInSidebar',
};

/**
 * The buttons this deployment puts on the rail for this account. The deployment's `sidebar` and
 * `mindroom.canvas` settings come first: a button it leaves out has no switch in Settings either.
 */
export function useOfferedRailButtons(): RailButtons {
  const config = useClientConfig();
  const { sidebar } = config;
  const localMindroom = useShowLocalMindroom();
  const communities = sidebar?.showExploreCommunity ?? true;
  return {
    threads: sidebar?.showThreads ?? true,
    canvases: canvasesEnabled(config),
    usage: true,
    explore: communities,
    createSpace: communities,
    search: true,
    localMindroom,
  };
}

/** The buttons the rail shows: offered by the deployment and not turned off in Settings. */
export function useRailButtons(): RailButtons {
  const offered = useOfferedRailButtons();
  const settings = useAccountSettings();
  const shown = (button: RailButton) => offered[button] && settings[RAIL_BUTTON_SETTING[button]];
  return {
    threads: shown('threads'),
    canvases: shown('canvases'),
    usage: shown('usage'),
    explore: shown('explore'),
    createSpace: shown('createSpace'),
    search: shown('search'),
    localMindroom: shown('localMindroom'),
  };
}
