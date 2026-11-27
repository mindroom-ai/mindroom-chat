import { useEffect, useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
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
import {
  crossRoomThreadIndexAtom,
  getCrossRoomThreadIndexKey,
} from '../threads/cross-room/crossRoomThreadIndex';
import { findFirstHighlight } from '../search/highlightRegex';
import {
  getSearchResultOpenTarget,
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
import {
  fetchEditThread,
  fetchThreadSummary,
  resolveLocalThreadSummary,
  resolveSyncHitThread,
  resolveThreadRootPreview,
} from './commandPaletteMessageThreads';
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

const collectQueryMap = <T>(keys: readonly string[], results: readonly { data?: T }[]) =>
  new Map(
    keys.flatMap((key, i) =>
      results[i]?.data !== undefined ? [[key, results[i].data] as const] : []
    )
  );

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
  const pageRoomIdsKey = useMemo(
    () => [...new Set(page?.groups.map((group) => group.roomId) ?? [])].sort().join('\u0000'),
    [page]
  );
  // Senders are named from their rooms' members, loaded here for rooms the user has not opened.
  const membersLoaded = useLoadedRoomMembers(
    client,
    page?.groups.map((group) => group.roomId) ?? []
  );

  const [summaryVersion, setSummaryVersion] = useState(0);
  const [readySummaryRooms, setReadySummaryRooms] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    if (!sessionId || !pageRoomIdsKey) return undefined;
    let active = true;
    const rooms = pageRoomIdsKey.split('\u0000');
    const onChange = () => {
      if (active) setSummaryVersion((n) => n + 1);
    };
    const unsubs = rooms.map((roomId) =>
      subscribeToThreadSummaryState(sessionId, roomId, onChange)
    );
    rooms.forEach((roomId) => {
      const key = `${sessionId}\u0000${roomId}`;
      void ensureThreadSummaryStateLoaded(sessionId, roomId).finally(() => {
        if (active) setReadySummaryRooms((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
      });
    });
    return () => {
      active = false;
      unsubs.forEach((unsub) => unsub());
    };
  }, [pageRoomIdsKey, sessionId]);

  const { syncHits, editFetches } = useMemo(() => {
    void summaryVersion;
    const seen = new Map<string, [roomId: string, eventId: string]>();
    const hits =
      page?.groups.flatMap(({ roomId, items: groupHits }) => {
        const room = client.getRoom(roomId);
        const summaries = getThreadSummaryStateSnapshot(sessionId, roomId);
        return groupHits.map(({ event }) => {
          const target = getSearchResultOpenTarget(event);
          const sync = resolveSyncHitThread(roomId, event, target, room, threadIndex, summaries);
          const editKey = `${roomId}\u0000${target.mainEventId}`;
          if (sync.needsEditFetch) seen.set(editKey, [roomId, target.mainEventId]);
          return { roomId, room, summaries, event, target, sync, editKey };
        });
      }) ?? [];
    return { syncHits: hits, editFetches: [...seen] };
  }, [client, page, sessionId, summaryVersion, threadIndex]);

  const resolvedEdits = useQueries({
    queries: editFetches.map(([, [roomId, eventId]]) => ({
      queryKey: ['command-palette-edit-thread', userId, roomId, eventId] as const,
      enabled:
        typeof client.fetchRoomEvent === 'function' &&
        (!sessionId || readySummaryRooms.has(`${sessionId}\u0000${roomId}`)),
      staleTime: Infinity,
      retry: false,
      queryFn: () => fetchEditThread(client, sessionId, roomId, eventId),
    })),
    combine: (results) =>
      collectQueryMap(
        editFetches.map(([key]) => key),
        results
      ),
  });

  const threadFetches = useMemo(() => {
    const seen = new Map<string, [roomId: string, threadRootId: string]>();
    syncHits.forEach(({ roomId, room, summaries, event, sync, editKey }) => {
      const edit = sync.needsEditFetch ? resolvedEdits.get(editKey) : undefined;
      const threadRootId = sync.threadRootId ?? edit?.threadRootId;
      if (!threadRootId || sync.isThreadTitle || edit?.threadTitle) return;
      const key = getCrossRoomThreadIndexKey(roomId, threadRootId);
      const entry = threadIndex.entries.get(key);
      if (
        !resolveLocalThreadSummary(room, event, threadRootId, entry, summaries, edit?.summaryText)
      ) {
        seen.set(key, [roomId, threadRootId]);
      }
    });
    return [...seen];
  }, [resolvedEdits, syncHits, threadIndex.entries]);

  const resolvedThreads = useQueries({
    queries: threadFetches.map(([, [roomId, threadRootId]]) => ({
      queryKey: ['command-palette-thread-summary', userId, roomId, threadRootId] as const,
      enabled:
        typeof client.relations === 'function' &&
        (!sessionId || readySummaryRooms.has(`${sessionId}\u0000${roomId}`)),
      staleTime: Infinity,
      retry: false,
      queryFn: () => fetchThreadSummary(client, sessionId, roomId, threadRootId),
    })),
    combine: (results) =>
      collectQueryMap(
        threadFetches.map(([key]) => key),
        results
      ),
  });

  const items = useMemo<CommandPaletteMessages['items']>(() => {
    void membersLoaded;
    if (!page) return [];
    const { highlights } = page;
    return syncHits.map(({ roomId, room, summaries, event, target, sync, editKey }) => {
      const edit = sync.needsEditFetch ? resolvedEdits.get(editKey) : undefined;
      const threadRootId = sync.threadRootId ?? edit?.threadRootId;
      const isThreadTitle = Boolean(sync.isThreadTitle || edit?.threadTitle);
      const threadKey = threadRootId ? getCrossRoomThreadIndexKey(roomId, threadRootId) : undefined;
      const entry = threadKey ? threadIndex.entries.get(threadKey) : undefined;
      const fetchedThread = threadKey ? resolvedThreads.get(threadKey) : undefined;
      const summaryText = threadRootId
        ? resolveLocalThreadSummary(
            room,
            event,
            threadRootId,
            entry,
            summaries,
            edit?.summaryText
          ) || fetchedThread?.summaryText
        : undefined;
      const isRootHit = threadRootId === target.mainEventId;
      const rootPreviewText =
        threadRootId && !isThreadTitle && !isRootHit && !summaryText
          ? resolveThreadRootPreview(room, threadRootId, entry, fetchedThread?.rootPreviewText)
          : undefined;
      const resolvedTarget: SearchResultOpenTarget = threadRootId
        ? {
            mainEventId: target.mainEventId,
            threadRootId,
            ...(isThreadTitle ? { threadTitle: true as const } : {}),
          }
        : target;
      const threadName =
        threadRootId && !isThreadTitle
          ? isRootHit
            ? summaryText || ''
            : summaryText || rootPreviewText || ''
          : undefined;
      return {
        id: `message:${roomId}:${event.event_id}`,
        kind: 'message',
        senderName:
          (room && getMemberDisplayName(room, event.sender)) ??
          getMxIdLocalPart(event.sender) ??
          event.sender,
        roomName: room?.name ?? roomId,
        threadName,
        // A thread's titles list once (`collapseThreadTitleHits`), as the one it has now.
        // Its thread's row has this id (`useCommandPaletteSource`).
        ...(isThreadTitle && threadKey ? { titleOfThreadId: `thread:${threadKey}` } : {}),
        snippet: (isThreadTitle && summaryText) || getPlainSnippet(event, highlights, t),
        highlights,
        timestamp: event.origin_server_ts,
        onSelect: () => {
          void open(roomId, resolvedTarget);
        },
      };
    });
  }, [membersLoaded, open, page, resolvedEdits, resolvedThreads, syncHits, t, threadIndex.entries]);

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
