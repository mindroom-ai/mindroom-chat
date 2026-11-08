import { useCallback, useEffect, useState } from 'react';
import { useLatestRef } from '../lib/hooks/useLatestRef';
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
 * when its room shows, unless another of the room's panels is open then (`othersOpen`), or the
 * members list beside the conversation (`members.beside`) and the panel has no `opensOverMembers`.
 * One that does opens again in the list's place and closes the list (`members.close`).
 */
export const usePluginPanel = (
  roomId: string,
  panels: readonly RoomSidePanel[],
  othersOpen: boolean,
  members: { beside: boolean; close: () => void }
) => {
  const remembered = usePluginStorage(REMEMBERED);
  const key = encodeURIComponent(roomId);
  // A plugin's panel open in a room, what it was asked to show, and whether it opened again over
  // the members list.
  const [open, setOpen] = useState<{
    roomId: string;
    id: string;
    request?: unknown;
    overMembers?: boolean;
  }>();
  const [lookedUpIn, setLookedUpIn] = useState<string>();
  if (lookedUpIn !== roomId) {
    // Before the room's first render, so the panel shows with it.
    setLookedUpIn(roomId);
    const entry = othersOpen ? undefined : parse(remembered.getItem(key));
    if (isRecord(entry)) {
      const panel = panels.find(
        (candidate) =>
          candidate.id === entry.id &&
          candidate.remember &&
          (!members.beside || candidate.opensOverMembers)
      );
      if (panel) {
        setOpen({ roomId, id: panel.id, request: entry.request, overMembers: members.beside });
      }
    }
  }
  // The list it opened again over closes once, after the render it shows in.
  const closeMembers = useLatestRef(members.close);
  useEffect(() => {
    if (open?.overMembers) closeMembers.current();
  }, [closeMembers, open]);

  const show = useCallback(
    ({ id, remember }: RoomSidePanel, request?: unknown) => {
      setOpen({ roomId, id, request });
      if (remember) remembered.setItem(key, JSON.stringify({ id, request }));
    },
    [key, remembered, roomId]
  );
  const close = useCallback(() => {
    setOpen(undefined);
    remembered.removeItem(key);
  }, [key, remembered]);

  return { here: open?.roomId === roomId ? open : undefined, show, close };
};
