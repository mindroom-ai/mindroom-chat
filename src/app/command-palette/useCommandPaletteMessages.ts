import { useEffect, useMemo, useState } from 'react';
import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { type IEventWithRoomId, MsgType, type Room } from 'matrix-js-sdk';
import type { TFunction } from 'i18next';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useLoadedRoomMembers } from '../matrix/hooks/useLoadedRoomMembers';
import { useActiveSession } from '../matrix/session/useSessionStore';
import { allRoomsAtom } from '../matrix/state/roomList';
import { getMxIdLocalPart } from '../matrix/matrix';
import { getMemberDisplayName, trimReplyFromBody } from '../matrix/room';
import { stripPreviewMarkdown } from '../event-store/threads/threadMessagePreview';
import {
  ensureThreadSummaryStateLoaded,
  getThreadSummaryStateSnapshot,
  subscribeToThreadSummaryState,
} from '../event-store/threads/threadSummaryState';
import { getVisibleThreadEventBodyPreviewText } from '../event-store/threads/threadUtils';
import {
  crossRoomThreadIndexAtom,
  getCrossRoomThreadIndexKey,
  getCrossRoomThreadRootsForEvent,
} from '../threads/cross-room/crossRoomThreadIndex';
import { findFirstHighlight } from '../search/highlightRegex';
import {
  fetchSearchHitThread,
  getSearchResultOpenTarget,
  hasBundledThread,
  resolveSearchThreadTitle,
  resolveSyncSearchHitThread,
  type SearchResultOpenTarget,
} from '../search/searchResultOpenTarget';
import {
  getSearchResultBodySnippet,
  getSearchResultEffectiveContent,
  getSearchResultPreviewText,
} from '../search/searchResultPreview';
import { useMessageSearch } from '../search/useMessageSearch';
import { useOpenSearchResult } from '../search/useOpenSearchResult';
import { getCommandPaletteSearchPagePath } from './commandPaletteActions';
import type { CommandPaletteMessageItem } from './commandPaletteTypes';

/** How long typing has to pause before the server is asked. */
export const COMMAND_PALETTE_MESSAGE_SEARCH_DELAY_MS = 250;

// Enough text around the first match to fill one line of a wide palette.
const SNIPPET_CHARS = 120;
// The part of a long message around its first match that loses its Markdown syntax.
const PLAIN_SOURCE_CHARS = 2000;
const PLAIN_TEXT_TYPES: readonly unknown[] = [MsgType.Text, MsgType.Notice, MsgType.Emote];
// A phone's row shows about 40 characters of a snippet before its ellipsis.
const MATCH_LEAD_CHARS = 20;

const collectQueryData = <T>(results: UseQueryResult<T>[]) => results.map((r) => r.data);

const getRootPreview = (room: Room | null | undefined, rootId: string, fallback?: string) => {
  const root = room?.getThread?.(rootId)?.rootEvent ?? room?.findEventById?.(rootId);
  return root?.isRedacted?.() ? '' : getVisibleThreadEventBodyPreviewText(root) || fallback || '';
};

/**
 * The snippet from a few words before its first match, after an ellipsis, when the match comes
 * later: a short message is not cut around its match, and in either direction the row's ending
 * ellipsis would hide a match far from the start.
 */
const leadToFirstMatch = (snippet: string, highlights: string[]): string => {
  const first = findFirstHighlight(snippet, highlights);
  if (first <= MATCH_LEAD_CHARS) return snippet;
  // From the first word that starts in the lead, so no word is cut.
  const space = snippet.indexOf(' ', first - MATCH_LEAD_CHARS);
  return `…${snippet.slice(space >= 0 && space < first ? space + 1 : first)}`;
};

/**
 * A hit's latest text as one line of plain text around the first match: the palette shows no
 * Markdown, so its syntax goes and its words stay. Other hits keep their labelled preview.
 */
const getPlainSnippet = (event: IEventWithRoomId, highlights: string[], t: TFunction) => {
  const content = getSearchResultEffectiveContent(event);
  const plain =
    !event.unsigned?.redacted_because &&
    typeof content?.body === 'string' &&
    PLAIN_TEXT_TYPES.includes(content.msgtype)
      ? stripPreviewMarkdown(
          getSearchResultBodySnippet(
            trimReplyFromBody(content.body),
            highlights,
            PLAIN_SOURCE_CHARS
          )
        )
          .replace(/\s+/g, ' ')
          .trim()
      : '';
  return leadToFirstMatch(
    getSearchResultBodySnippet(
      plain || getSearchResultPreviewText(event, highlights, t, content),
      highlights,
      SNIPPET_CHARS
    ),
    highlights
  );
};

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
export const useSettledText = (text: string, delayMs: number): string => {
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
  const userId = client.getUserId();
  const sessionId = useActiveSession()?.sessionId;
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
  const pageRoomIds = useMemo(() => page?.groups.map((g) => g.roomId) ?? [], [page]);
  const pageRoomIdsKey = [...new Set(pageRoomIds)].sort().join('\u0000');
  // Senders are named from their rooms' members, loaded here for rooms the user has not opened.
  const membersLoaded = useLoadedRoomMembers(client, pageRoomIds);

  const [summaryVersion, setSummaryVersion] = useState(0);
  useEffect(() => {
    if (!sessionId || !pageRoomIdsKey) return undefined;
    const rooms = pageRoomIdsKey.split('\u0000');
    const bump = () => setSummaryVersion((n) => n + 1);
    const unsubs = rooms.map((id) => subscribeToThreadSummaryState(sessionId, id, bump));
    rooms.forEach((id) => void ensureThreadSummaryStateLoaded(sessionId, id));
    return () => unsubs.forEach((u) => u());
  }, [pageRoomIdsKey, sessionId]);

  const { syncHits, editFetches } = useMemo(() => {
    void summaryVersion;
    const seen = new Map<string, number>();
    const fetches: [string, string][] = [];
    if (!page) return { syncHits: [], editFetches: fetches };
    const hits = page.groups.flatMap(({ roomId, items: groupHits }) => {
      const room = client.getRoom(roomId);
      const summaries = getThreadSummaryStateSnapshot(sessionId, roomId);
      return groupHits.map(({ event }) => {
        const target = getSearchResultOpenTarget(event);
        const { mainEventId: id } = target;
        const editKey = getCrossRoomThreadIndexKey(roomId, id);
        const isRoot = threadIndex.entries.has(editKey) || summaries.has(id);
        let sync = resolveSyncSearchHitThread(event, target, room, isRoot);
        let fetchIdx: number | undefined;
        if (sync.needsFetch) {
          const [rev] = getCrossRoomThreadRootsForEvent(threadIndex, roomId, id);
          if (rev) sync = { threadRootId: rev, isThreadTitle: summaries.get(rev)?.eventId === id };
          else {
            fetchIdx = seen.get(editKey) ?? fetches.push([roomId, id]) - 1;
            seen.set(editKey, fetchIdx);
          }
        }
        return { roomId, room, summaries, event, target, sync, fetchIdx };
      });
    });
    return { syncHits: hits, editFetches: fetches };
  }, [client, page, sessionId, summaryVersion, threadIndex]);

  const editData = useQueries({
    queries: editFetches.map(([roomId, eventId]) => ({
      queryKey: ['search-edit-thread', userId, roomId, eventId] as const,
      enabled: typeof client.fetchRoomEvent === 'function',
      staleTime: Infinity,
      retry: false,
      queryFn: () => fetchSearchHitThread(client, roomId, eventId, sessionId),
    })),
    combine: collectQueryData,
  });

  const items = useMemo<CommandPaletteMessages['items']>(() => {
    void membersLoaded;
    const highlights = page?.highlights ?? [];
    const rootHits = new Map<string, IEventWithRoomId>();
    syncHits.forEach(({ roomId, event }) => {
      if (hasBundledThread(event.unsigned)) {
        rootHits.set(getCrossRoomThreadIndexKey(roomId, event.event_id), event);
      }
    });
    return syncHits.map(({ roomId, room, summaries, event, target, sync, fetchIdx }) => {
      const edit = fetchIdx !== undefined ? editData[fetchIdx] : undefined;
      const rootId = sync.threadRootId ?? edit?.threadRootId;
      const isTitle = Boolean(sync.isThreadTitle || edit?.threadTitle);
      const key = rootId && getCrossRoomThreadIndexKey(roomId, rootId);
      const entry = key ? threadIndex.entries.get(key) : undefined;
      const info = entry?.threadRecord.presentation.summaryInfo;
      const title =
        rootId && key
          ? resolveSearchThreadTitle(room, rootHits.get(key), rootId, summaries, info)
          : '';
      const { mainEventId: id } = target;
      const openTarget: SearchResultOpenTarget = rootId
        ? { mainEventId: id, threadRootId: rootId, ...(isTitle ? { threadTitle: true } : {}) }
        : target;
      return {
        id: `message:${roomId}:${event.event_id}`,
        kind: 'message',
        senderName:
          (room && getMemberDisplayName(room, event.sender)) ??
          getMxIdLocalPart(event.sender) ??
          event.sender,
        roomName: room?.name ?? roomId,
        threadName:
          rootId && !isTitle
            ? title || (rootId === id ? '' : getRootPreview(room, rootId, entry?.rootPreviewText))
            : undefined,
        // A thread's titles list once (`collapseThreadTitleHits`), as the one it has now.
        // Its thread's row has this id (`useCommandPaletteSource`).
        ...(isTitle && key ? { titleOfThreadId: `thread:${key}` } : {}),
        snippet: (isTitle && title) || getPlainSnippet(event, highlights, t),
        highlights,
        timestamp: event.origin_server_ts,
        onSelect: () => {
          void open(roomId, openTarget);
        },
      };
    });
  }, [editData, membersLoaded, open, page, syncHits, t, threadIndex.entries]);

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
