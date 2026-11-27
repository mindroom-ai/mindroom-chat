import { useRef, useState } from 'react';
import { atom, useAtom, useAtomValue } from 'jotai';
import type { MatrixClient } from 'matrix-js-sdk';
import { canvasesEnabled } from '../config/canvases';
import { useClientConfig } from '../config/useClientConfig';
import { useShowLocalMindroom } from '../local-mindroom/useShowLocalMindroom';
import type { BooleanAccountSetting } from '../preferences/accountSettings';
import { useAccountSettings, useSetAccountSettings } from '../matrix/hooks/useAccountSettings';
import { useOptionalMatrixClient } from '../matrix/hooks/useMatrixClient';

/** The icon rail buttons each person can hide in Settings. */
export type RailButton =
  | 'direct'
  | 'threads'
  | 'canvases'
  | 'usage'
  | 'explore'
  | 'createSpace'
  | 'search'
  | 'localMindroom'
  | 'help';

export type RailButtons = Record<RailButton, boolean>;

/** Configurable rail buttons in top-to-bottom rail order. */
export const RAIL_BUTTON_ORDER: readonly RailButton[] = [
  'direct',
  'threads',
  'canvases',
  'usage',
  'explore',
  'createSpace',
  'search',
  'localMindroom',
  'help',
];

/** The `io.mindroom.settings` switch that shows or hides each button. */
export const RAIL_BUTTON_SETTING: Record<RailButton, BooleanAccountSetting> = {
  direct: 'showDirectInSidebar',
  threads: 'showThreadsInSidebar',
  canvases: 'showCanvasesInSidebar',
  usage: 'showUsageInSidebar',
  explore: 'showExploreInSidebar',
  createSpace: 'showCreateSpaceInSidebar',
  search: 'showSearchInSidebar',
  localMindroom: 'showLocalMindroomInSidebar',
  help: 'showHelpInSidebar',
};

type PendingRailButtonEntry = {
  value: boolean;
  token: symbol;
};

/** Optimistic visibility overrides for rail button writes still awaiting sync echo, scoped by client. */
export type PendingRailButtons = {
  client?: MatrixClient;
  entries: Partial<Record<RailButton, PendingRailButtonEntry>>;
};

export const pendingRailButtonsAtom = atom<PendingRailButtons>({ entries: {} });

const readPendingValue = (
  pending: PendingRailButtons,
  client: MatrixClient | undefined,
  button: RailButton
): boolean | undefined => (pending.client === client ? pending.entries[button]?.value : undefined);

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
    direct: true,
    threads: sidebar?.showThreads ?? true,
    canvases: canvasesEnabled(config),
    usage: true,
    explore: communities,
    createSpace: communities,
    search: true,
    localMindroom,
    help: true,
  };
}

/** The buttons the rail shows: offered by the deployment and not turned off in Settings. */
export function useRailButtons(): RailButtons {
  const client = useOptionalMatrixClient();
  const offered = useOfferedRailButtons();
  const settings = useAccountSettings();
  const pending = useAtomValue(pendingRailButtonsAtom);
  const shown = (button: RailButton) =>
    offered[button] &&
    (readPendingValue(pending, client, button) ?? settings[RAIL_BUTTON_SETTING[button]]);
  return {
    direct: shown('direct'),
    threads: shown('threads'),
    canvases: shown('canvases'),
    usage: shown('usage'),
    explore: shown('explore'),
    createSpace: shown('createSpace'),
    search: shown('search'),
    localMindroom: shown('localMindroom'),
    help: shown('help'),
  };
}

/**
 * Optimistic toggle state for a configurable rail button. Shares pending overrides through
 * `pendingRailButtonsAtom` so the rail and all switches update together while `setAccountData`
 * waits for sync echo, and snaps back with `saveFailed` if the write fails.
 */
export function useRailButtonToggle(button: RailButton): {
  checked: boolean;
  saveFailed: boolean;
  setChecked: (next: boolean) => void;
} {
  const client = useOptionalMatrixClient();
  const settings = useAccountSettings();
  const setAccountSettings = useSetAccountSettings();
  const [pending, setPending] = useAtom(pendingRailButtonsAtom);
  const [saveFailed, setSaveFailed] = useState(false);
  const localToken = useRef<symbol | undefined>(undefined);

  const checked =
    readPendingValue(pending, client, button) ?? settings[RAIL_BUTTON_SETTING[button]];

  const setChecked = (next: boolean) => {
    const token = Symbol(button);
    localToken.current = token;
    setPending((current) => ({
      client,
      entries: {
        ...(current.client === client ? current.entries : {}),
        [button]: { value: next, token },
      },
    }));
    setSaveFailed(false);
    setAccountSettings({ [RAIL_BUTTON_SETTING[button]]: next })
      .catch(() => {
        if (localToken.current === token) setSaveFailed(true);
      })
      .finally(() => {
        setPending((current) => {
          if (current.client !== client || current.entries[button]?.token !== token) {
            return current;
          }
          const { [button]: _cleared, ...rest } = current.entries;
          return { client: current.client, entries: rest };
        });
      });
  };

  return { checked, saveFailed, setChecked };
}
