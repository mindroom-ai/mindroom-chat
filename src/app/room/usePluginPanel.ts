import { useCallback, useState } from 'react';
import { isRecord } from '../lib/isRecord';
import { usePluginStorage } from '../plugins/pluginStorage';
import type { RoomSidePanel } from '../plugins/sidePanels';

/**
 * Where the panels that `remember` are kept, by room: beside the plugins' own storage of the
 * account, which the app deletes with it; no plugin id starts with `:`.
 */
const REMEMBERED = ':side-panel';

/** What a room remembers, `{ id, request }` when this app wrote it. */
const parse = (stored: string | null): unknown => {
  try {
    return stored === null ? undefined : JSON.parse(stored);
  } catch {
    return undefined;
  }
};

/**
 * The plugin panel open in the room `roomId` of the page, from `panels`: `show` opens one there, and
 * `close` closes the one open, in whichever room, and forgets the one this room remembers. One that
 * `remember`s stays open in its room for the signed-in account until it closes there: it opens again
 * when its room shows, unless another of the room's panels is open then (`othersOpen`).
 */
export const usePluginPanel = (
  roomId: string,
  panels: readonly RoomSidePanel[],
  othersOpen: boolean
) => {
  const remembered = usePluginStorage(REMEMBERED);
  const key = encodeURIComponent(roomId);
  // A plugin's panel open in a room, and what it was asked to show.
  const [open, setOpen] = useState<{ roomId: string; id: string; request?: unknown }>();
  const [lookedUpIn, setLookedUpIn] = useState<string>();
  if (lookedUpIn !== roomId) {
    // Before the room's first render, so the panel shows with it.
    setLookedUpIn(roomId);
    const entry = othersOpen ? undefined : parse(remembered.getItem(key));
    if (isRecord(entry)) {
      const panel = panels.find((candidate) => candidate.id === entry.id && candidate.remember);
      if (panel) setOpen({ roomId, id: panel.id, request: entry.request });
    }
  }

  const show = useCallback(
    (id: string, request?: unknown) => {
      setOpen({ roomId, id, request });
      if (panels.find((panel) => panel.id === id)?.remember) {
        remembered.setItem(key, JSON.stringify({ id, request }));
      }
    },
    [key, panels, remembered, roomId]
  );
  const close = useCallback(() => {
    setOpen(undefined);
    remembered.removeItem(key);
  }, [key, remembered]);

  return { here: open?.roomId === roomId ? open : undefined, show, close };
};
