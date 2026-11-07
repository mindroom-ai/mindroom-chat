import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { MatrixClient } from 'matrix-js-sdk';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../matrix/hooks/useMediaAuthentication';
import { useCapabilities } from '../matrix/hooks/useCapabilities';
import { createDirectRoom, findDirectRoom } from '../matrix/createRoom';
import { getMxIdLocalPart, isUserId, mxcUrlToHttp } from '../matrix/matrix';
import {
  normalizeUserDirectoryUsers,
  type ServerUserDirectoryUser,
} from '../members/userDirectoryCache';
import { getDirectRoomPath } from '../routes/pathUtils';
import type { ExecutableCommandPaletteUserItem } from './commandPaletteItems';
import {
  COMMAND_PALETTE_MESSAGE_SEARCH_DELAY_MS,
  useSettledText,
} from './useCommandPaletteMessages';

/** How many people one directory search asks the server for. */
export const COMMAND_PALETTE_PEOPLE_LIMIT = 20;

// The server's answer is reused while the palette is reopened or the same text is typed again.
const STALE_MS = 60_000;

// Twice the 34 px row avatar, for high-density screens.
const AVATAR_PX = 68;

export type CommandPalettePeopleStatus = 'idle' | 'loading' | 'error' | 'done';

/** The server's people for the palette's text, which the People section adds below its own. */
export type CommandPalettePeople = {
  status: CommandPalettePeopleStatus;
  /**
   * The user directory's matches for the current text in the server's order, never an older
   * text's, without the account itself. A Matrix ID typed in full that the directory did not
   * return comes last, marked `typedId`, also when the directory search failed.
   */
  items: ExecutableCommandPaletteUserItem[];
};

/** A hook that searches the user directory for `text` while `enabled`; called every render. */
export type UseCommandPalettePeople = (text: string, enabled: boolean) => CommandPalettePeople;

/**
 * Opens the direct chat with `userId`, starting one first when the account has none: the room
 * Create Chat makes, encrypted, with them invited and listed in `m.direct`.
 */
export const useStartDirectChat = (): ((userId: string) => Promise<void>) => {
  const client = useMatrixClient();
  const navigate = useNavigate();
  // Create Chat sets its power levels for the server's default room version too.
  const version = useCapabilities()['m.room_versions']?.default;
  return useCallback(
    async (userId: string) => {
      const roomId =
        findDirectRoom(client, userId) ?? (await createDirectRoom(client, userId, { version }));
      navigate(getDirectRoomPath(roomId));
    },
    [client, navigate, version]
  );
};

/** The HTTP URL of a person's avatar for a palette row, if they have one. */
export const getCommandPaletteAvatarUrl = (
  client: MatrixClient,
  mxc: string | undefined,
  useAuthentication: boolean
): string | undefined =>
  mxc
    ? mxcUrlToHttp(client, mxc, useAuthentication, AVATAR_PX, AVATAR_PX, 'crop') ?? undefined
    : undefined;

/**
 * The server's user directory for the command palette. Like message search, it asks once typing
 * pauses and only while People is on screen, and reports a newer text as loading instead of
 * showing an older one's people. A Matrix ID typed in full also has its profile looked up, for
 * the row that offers to message it when the directory does not list it.
 */
export const useCommandPalettePeople: UseCommandPalettePeople = (text, enabled) => {
  const client = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const startChat = useStartDirectChat();
  const myUserId = client.getSafeUserId();
  const term = text.trim();
  const settled = useSettledText(term, COMMAND_PALETTE_MESSAGE_SEARCH_DELAY_MS);
  const asking = enabled && term.length > 0 && settled === term;
  // The directory matches part of a name or ID, so a leading @ would only narrow it.
  const searchTerm = term.replace(/^@/, '');
  const typedId = isUserId(term) && term !== myUserId ? term : undefined;

  const searching = asking && searchTerm.length > 0;
  const directory = useQuery({
    queryKey: ['command-palette-people', myUserId, searchTerm],
    enabled: searching,
    queryFn: () =>
      client.searchUserDirectory({ term: searchTerm, limit: COMMAND_PALETTE_PEOPLE_LIMIT }),
    retry: false,
    staleTime: STALE_MS,
  });
  const profile = useQuery({
    queryKey: ['command-palette-profile', myUserId, typedId],
    enabled: asking && typedId !== undefined,
    queryFn: () => client.getProfileInfo(typedId ?? ''),
    retry: false,
    staleTime: STALE_MS,
  });

  let status: CommandPalettePeopleStatus = 'done';
  if (!term || !enabled) status = 'idle';
  else if (!asking || (searching && directory.isPending) || (typedId && profile.isPending)) {
    status = 'loading';
  } else if (searching && directory.isError) status = 'error';

  const found = status === 'done' ? directory.data : undefined;
  const offerTyped = (status === 'done' || status === 'error') && typedId !== undefined;
  const typedInfo = offerTyped ? profile.data : undefined;
  const items = useMemo(() => {
    const toItem = (user: ServerUserDirectoryUser, typed: boolean) => {
      const localpart = getMxIdLocalPart(user.userId) ?? user.userId;
      const item: ExecutableCommandPaletteUserItem = {
        id: `user:${user.userId}`,
        kind: 'user',
        userId: user.userId,
        displayName: user.displayName ?? localpart,
        localpart,
        avatarUrl: getCommandPaletteAvatarUrl(client, user.avatarMxcUrl, useAuthentication),
        typedId: typed || undefined,
        startChat: () => startChat(user.userId),
      };
      return item;
    };
    const users = normalizeUserDirectoryUsers(found?.results ?? []).filter(
      (user) => user.userId !== myUserId
    );
    const rows = users.map((user) => toItem(user, false));
    if (offerTyped && typedId && !users.some((user) => user.userId === typedId)) {
      // A failed lookup still offers the row, with the ID alone.
      rows.push(
        toItem(
          {
            userId: typedId,
            displayName: typedInfo?.displayname || undefined,
            avatarMxcUrl: typedInfo?.avatar_url || undefined,
          },
          true
        )
      );
    }
    return rows;
  }, [client, found, myUserId, offerTyped, startChat, typedId, typedInfo, useAuthentication]);

  return useMemo(() => ({ status, items }), [items, status]);
};
