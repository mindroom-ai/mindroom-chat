import { useCallback, useState } from 'react';
import { isRecord } from '../lib/isRecord';
import {
  getSafeLocalStorage,
  getStorageItemSafe,
  removeStorageItemSafe,
  setStorageItemSafe,
} from '../lib/safeLocalStorage';
import { listSessions } from '../matrix/session/sessions';
import { accountPrefix } from '../plugins/pluginStorage';
import type { RoomSidePanel } from '../plugins/sidePanels';

/** A plugin's panel open in a room, and what it was asked to show. */
type OpenPanel = { id: string; request?: unknown };

/**
 * The localStorage key of the panel that `remember`s, kept open by `userId` in `roomId`. It starts as
 * the account's plugin values do, so the app deletes it with them (`pluginStorage.ts`); no plugin id
 * starts with `:`.
 */
const rememberedKey = (userId: string, roomId: string): string =>
  `${accountPrefix(userId)}:side-panel/${encodeURIComponent(roomId)}`;

/** What `rememberedKey` holds, `{ id, request }` when this app wrote it. */
const readRemembered = (userId: string, roomId: string): unknown => {
  const stored = getStorageItemSafe(getSafeLocalStorage(), rememberedKey(userId, roomId));
  try {
    return stored === null ? undefined : JSON.parse(stored);
  } catch {
    return undefined;
  }
};

/**
 * The plugin panel open in the room `roomId` of the page, from `panels`: `show` opens one there, and
 * `close` closes the one open, in whichever room, and forgets the one this room remembers. One that
 * `remember`s stays open in its room for `userId` until it closes there: it opens again when its
 * room shows, unless another of the room's panels is open then (`othersOpen`).
 */
export const usePluginPanel = (
  userId: string,
  roomId: string,
  panels: readonly RoomSidePanel[],
  othersOpen: boolean
) => {
  const [open, setOpen] = useState<OpenPanel & { roomId: string }>();
  const [lookedUpIn, setLookedUpIn] = useState<string>();
  if (lookedUpIn !== roomId) {
    // Before the room's first render, so the panel shows with it.
    setLookedUpIn(roomId);
    const remembered = othersOpen ? undefined : readRemembered(userId, roomId);
    if (isRecord(remembered)) {
      const panel = panels.find(
        (candidate) => candidate.id === remembered.id && candidate.remember
      );
      if (panel) setOpen({ roomId, id: panel.id, request: remembered.request });
    }
  }

  const show = useCallback(
    (id: string, request?: unknown) => {
      setOpen({ roomId, id, request });
      // Sign-out removes the login before it deletes the account's plugin values: nothing comes back.
      if (
        panels.find((panel) => panel.id === id)?.remember &&
        listSessions().some((session) => session.userId === userId)
      ) {
        setStorageItemSafe(
          getSafeLocalStorage(),
          rememberedKey(userId, roomId),
          JSON.stringify({ id, request })
        );
      }
    },
    [panels, roomId, userId]
  );
  const close = useCallback(() => {
    setOpen(undefined);
    removeStorageItemSafe(getSafeLocalStorage(), rememberedKey(userId, roomId));
  }, [roomId, userId]);

  return { here: open?.roomId === roomId ? open : undefined, show, close };
};
