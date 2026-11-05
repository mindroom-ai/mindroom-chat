import { useEffect, useMemo, useState } from 'react';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { allRoomsAtom } from '../../state/room-list/roomList';
import { getMxIdLocalPart } from '../../utils/matrix';
import {
  crossRoomThreadIndexAtom,
  getCrossRoomThreadIndexKey,
} from '../cross-room-threads/crossRoomThreadIndex';
import { getSearchResultOpenTarget } from '../message-search/searchResultOpenTarget';
import {
  getSearchResultBodySnippet,
  getSearchResultPreviewText,
} from '../message-search/searchResultPreview';
import { useMessageSearch } from '../message-search/useMessageSearch';
import { useOpenSearchResult } from '../message-search/useOpenSearchResult';
import { getCommandPaletteSearchPagePath } from './commandPaletteActions';
import type { CommandPaletteMessageItem } from './commandPaletteTypes';

/** How long typing has to pause before the server is asked. */
export const COMMAND_PALETTE_MESSAGE_SEARCH_DELAY_MS = 250;

// Enough text around the first match to fill one line of a wide palette.
const SNIPPET_CHARS = 120;

export type CommandPaletteMessageStatus = 'idle' | 'loading' | 'error' | 'done';

/** The server's message search for the palette's text, with what the Messages section shows. */
export type CommandPaletteMessages = {
  status: CommandPaletteMessageStatus;
  /** The first page of hits for the current text, newest first; never an older text's hits. */
  items: (CommandPaletteMessageItem & { onSelect?: () => void })[];
  /** The user is in encrypted rooms, whose messages the server cannot search. */
  encryptedRooms: boolean;
  /** Opens the full message search page for `term`. */
  openSearchPage: (term: string) => void;
};

/** A hook that searches messages for `text` while `enabled`; the palette calls it every render. */
export type UseCommandPaletteMessages = (text: string, enabled: boolean) => CommandPaletteMessages;

/** `text` once it has stayed the same for `delayMs`; emptied text settles at once. */
const useSettledText = (text: string, delayMs: number): string => {
  const [settled, setSettled] = useState('');
  useEffect(() => {
    if (text === '') {
      setSettled('');
      return undefined;
    }
    const timer = setTimeout(() => setSettled(text), delayMs);
    return () => clearTimeout(timer);
  }, [text, delayMs]);
  return settled;
};

export const hasEncryptedRooms = (
  rooms: readonly (Pick<Room, 'hasEncryptionStateEvent'> | null | undefined)[]
): boolean => rooms.some((room) => room?.hasEncryptionStateEvent() ?? false);

/**
 * Server message search for the command palette. It asks once typing pauses, only while the
 * Messages section is on screen, and reports a newer text as loading instead of showing the
 * hits of an older one; the query it replaces aborts its request.
 */
export const useCommandPaletteMessages: UseCommandPaletteMessages = (text, enabled) => {
  const client = useMatrixClient();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const open = useOpenSearchResult();
  const roomIds = useAtomValue(allRoomsAtom);
  const threadIndex = useAtomValue(crossRoomThreadIndexAtom);
  const term = text.trim();
  const settled = useSettledText(term, COMMAND_PALETTE_MESSAGE_SEARCH_DELAY_MS);
  // While the text has not settled no query is observed, so an older one still in flight aborts.
  const search = useMessageSearch({ term: enabled && settled === term ? term : undefined });

  let status: CommandPaletteMessageStatus = 'done';
  if (!term) status = 'idle';
  else if (settled !== term || search.isPending) status = 'loading';
  else if (search.isError) status = 'error';

  const page = status === 'done' ? search.data?.pages[0] : undefined;
  const items = useMemo<CommandPaletteMessages['items']>(() => {
    if (!page) return [];
    const { highlights } = page;
    return page.groups.flatMap(({ roomId, items: hits }) => {
      const room = client.getRoom(roomId);
      return hits.map(({ event }) => {
        const target = getSearchResultOpenTarget(event);
        const thread = target.threadRootId
          ? threadIndex.entries.get(getCrossRoomThreadIndexKey(roomId, target.threadRootId))
          : undefined;
        return {
          id: `message:${roomId}:${event.event_id}`,
          kind: 'message',
          senderName:
            room?.getMember(event.sender)?.name ?? getMxIdLocalPart(event.sender) ?? event.sender,
          roomName: room?.name ?? roomId,
          threadName: target.threadRootId
            ? thread?.summaryText || thread?.rootPreviewText || ''
            : undefined,
          snippet: getSearchResultBodySnippet(
            getSearchResultPreviewText(event, highlights, t),
            highlights,
            SNIPPET_CHARS
          ),
          highlights,
          timestamp: event.origin_server_ts,
          onSelect: () => {
            void open(roomId, target);
          },
        };
      });
    });
  }, [client, open, page, t, threadIndex.entries]);

  const encryptedRooms = useMemo(
    () => hasEncryptedRooms(roomIds.map((roomId) => client.getRoom(roomId))),
    [client, roomIds]
  );

  return useMemo(
    () => ({
      status,
      items,
      encryptedRooms,
      openSearchPage: (searchTerm: string) => navigate(getCommandPaletteSearchPagePath(searchTerm)),
    }),
    [encryptedRooms, items, navigate, status]
  );
};
