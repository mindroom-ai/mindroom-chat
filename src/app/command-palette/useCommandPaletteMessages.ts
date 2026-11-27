import { useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Direction,
  EventType,
  type IEventWithRoomId,
  type MatrixClient,
  MsgType,
  RelationType,
  type Room,
} from 'matrix-js-sdk';
import type { TFunction } from 'i18next';
import { isRecord } from '../lib/isRecord';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useLoadedRoomMembers } from '../matrix/hooks/useLoadedRoomMembers';
import { useActiveSession } from '../matrix/session/useSessionStore';
import { allRoomsAtom } from '../matrix/state/roomList';
import { getMxIdLocalPart } from '../matrix/matrix';
import {
  getLatestThreadSummaryInfoFromEventSources,
  isThreadSummaryContent,
  type ThreadSummaryInfo,
} from '../matrix/protocol/threadSummary';
import { getMemberDisplayName, trimReplyFromBody } from '../matrix/room';
import { stripPreviewMarkdown } from '../event-store/threads/threadMessagePreview';
import { resolveThreadSummaryInfo } from '../event-store/threads/threadPresentation';
import {
  ensureThreadSummaryStateLoaded,
  getThreadSummaryStateSnapshot,
  storeThreadSummaryInState,
  subscribeToThreadSummaryState,
} from '../event-store/threads/threadSummaryState';
import { getVisibleThreadEventBodyPreviewText } from '../event-store/threads/threadUtils';
import {
  crossRoomThreadIndexAtom,
  getCrossRoomThreadIndexKey,
  getCrossRoomThreadRootsForEvent,
  type CrossRoomThreadIndexSnapshot,
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
const LEGACY_THREAD_REL = 'org.matrix.msc3440.thread';

type ResolvedEdit = { threadRootId: string; threadTitle?: true };
type ResolvedThread = { summaryText?: string; rootPreviewText?: string };
type ResolutionCaches = {
  client: MatrixClient;
  /** `undefined` while in flight, `null` for standalone messages, object for thread hits. */
  edits: Map<string, ResolvedEdit | null | undefined>;
  /** `undefined` while in flight, object once fetched from `/relations`. */
  threads: Map<string, ResolvedThread | undefined>;
  /** `false` while IndexedDB summary cache is loading, `true` once settled. */
  summaryRooms: Map<string, boolean>;
};

const hasBundledThread = (unsigned: unknown): boolean => {
  const relations = isRecord(unsigned) ? unsigned['m.relations'] : undefined;
  return (
    isRecord(relations) && Boolean(relations[RelationType.Thread] ?? relations[LEGACY_THREAD_REL])
  );
};

const inspectEventThread = (
  content: unknown,
  unsigned: unknown,
  selfId: string,
  fallbackRel?: unknown,
  isRoot?: boolean
): ResolvedEdit | null => {
  const record = isRecord(content) ? content : undefined;
  const rel = record?.['m.relates_to'] ?? fallbackRel;
  if (
    isRecord(rel) &&
    (rel.rel_type === RelationType.Thread || rel.rel_type === LEGACY_THREAD_REL) &&
    typeof rel.event_id === 'string' &&
    rel.event_id !== selfId
  ) {
    return {
      threadRootId: rel.event_id,
      ...(record && isThreadSummaryContent(record) ? { threadTitle: true as const } : {}),
    };
  }
  return isRoot || hasBundledThread(unsigned) ? { threadRootId: selfId } : null;
};

const resolveHitThread = (
  roomId: string,
  event: IEventWithRoomId,
  target: SearchResultOpenTarget,
  room: Room | null | undefined,
  threadIndex: CrossRoomThreadIndexSnapshot,
  summaries: ReadonlyMap<string, ThreadSummaryInfo>,
  edits: ResolutionCaches['edits']
): { threadRootId?: string; isThreadTitle?: boolean; needsEditFetch?: boolean } => {
  if (target.threadRootId) {
    return { threadRootId: target.threadRootId, isThreadTitle: target.threadTitle };
  }
  const { mainEventId } = target;
  const isKnownRoot =
    threadIndex.entries.has(getCrossRoomThreadIndexKey(roomId, mainEventId)) ||
    summaries.has(mainEventId) ||
    Boolean(room?.getThread?.(mainEventId));
  if (mainEventId === event.event_id) {
    return {
      threadRootId: isKnownRoot || hasBundledThread(event.unsigned) ? mainEventId : undefined,
    };
  }
  const loaded = room?.findEventById?.(mainEventId);
  if (loaded) {
    const fallbackRel =
      loaded.getRelation?.() ??
      (loaded.threadRootId && loaded.threadRootId !== mainEventId
        ? { rel_type: RelationType.Thread, event_id: loaded.threadRootId }
        : undefined);
    const fromLoaded = inspectEventThread(
      loaded.getWireContent?.() ?? loaded.getContent?.(),
      loaded.getUnsigned?.(),
      mainEventId,
      fallbackRel,
      loaded.isThreadRoot
    );
    if (fromLoaded) {
      return { threadRootId: fromLoaded.threadRootId, isThreadTitle: fromLoaded.threadTitle };
    }
  }
  const [reverseRootId] = getCrossRoomThreadRootsForEvent(threadIndex, roomId, mainEventId);
  if (reverseRootId) {
    return {
      threadRootId: reverseRootId,
      isThreadTitle: summaries.get(reverseRootId)?.eventId === mainEventId,
    };
  }
  if (isKnownRoot) return { threadRootId: mainEventId };
  const editKey = `${roomId}\u0000${mainEventId}`;
  if (edits.has(editKey)) {
    const cached = edits.get(editKey);
    return { threadRootId: cached?.threadRootId, isThreadTitle: cached?.threadTitle };
  }
  return { needsEditFetch: !loaded };
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

  const [resolvedVersion, setResolvedVersion] = useState(0);
  const mountedRef = useRef(true);
  const cachesRef = useRef<ResolutionCaches | null>(null);
  if (!cachesRef.current || cachesRef.current.client !== client) {
    cachesRef.current = { client, edits: new Map(), threads: new Map(), summaryRooms: new Map() };
  }
  const caches = cachesRef.current;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Load and subscribe to cached thread summaries for rooms appearing in the current search page.
  useEffect(() => {
    if (!sessionId || !pageRoomIdsKey) return undefined;
    const bump = () => {
      if (mountedRef.current && cachesRef.current === caches) setResolvedVersion((n) => n + 1);
    };
    const pageRooms = pageRoomIdsKey.split('\u0000');
    const unsubs = pageRooms.map((roomId) =>
      subscribeToThreadSummaryState(sessionId, roomId, bump)
    );
    pageRooms.forEach((roomId) => {
      const key = `${sessionId}\u0000${roomId}`;
      if (caches.summaryRooms.has(key)) return;
      caches.summaryRooms.set(key, false);
      void ensureThreadSummaryStateLoaded(sessionId, roomId).finally(() => {
        caches.summaryRooms.set(key, true);
        bump();
      });
    });
    return () => unsubs.forEach((unsub) => unsub());
  }, [caches, pageRoomIdsKey, sessionId]);

  const { items, editFetches, threadFetches } = useMemo(() => {
    void membersLoaded;
    void resolvedVersion;
    const editFetches: Array<[roomId: string, eventId: string]> = [];
    const threadFetches: Array<[roomId: string, threadRootId: string]> = [];
    if (!page) return { items: [] as CommandPaletteMessages['items'], editFetches, threadFetches };
    const { highlights } = page;
    const items: CommandPaletteMessages['items'] = page.groups.flatMap(
      ({ roomId, items: hits }) => {
        const room = client.getRoom(roomId);
        const summaries = getThreadSummaryStateSnapshot(sessionId, roomId);
        return hits.map(({ event }) => {
          const target = getSearchResultOpenTarget(event);
          const { threadRootId, isThreadTitle, needsEditFetch } = resolveHitThread(
            roomId,
            event,
            target,
            room,
            threadIndex,
            summaries,
            caches.edits
          );
          if (needsEditFetch) editFetches.push([roomId, target.mainEventId]);
          const threadKey = threadRootId
            ? getCrossRoomThreadIndexKey(roomId, threadRootId)
            : undefined;
          const entry = threadKey ? threadIndex.entries.get(threadKey) : undefined;
          const localSummary = threadRootId
            ? entry?.summaryText ||
              summaries.get(threadRootId)?.summaryText ||
              resolveThreadSummaryInfo({ thread: room?.getThread?.(threadRootId) })?.summaryText
            : undefined;
          const cachedThread = threadKey ? caches.threads.get(threadKey) : undefined;
          if (
            threadRootId &&
            threadKey &&
            !isThreadTitle &&
            !localSummary &&
            !caches.threads.has(threadKey)
          ) {
            threadFetches.push([roomId, threadRootId]);
          }
          const summaryText = localSummary || cachedThread?.summaryText;
          const isRootHit = threadRootId === target.mainEventId;
          const rootPreviewText =
            threadRootId && !isThreadTitle && !isRootHit && !summaryText
              ? entry?.rootPreviewText ||
                cachedThread?.rootPreviewText ||
                getVisibleThreadEventBodyPreviewText(
                  room?.getThread?.(threadRootId)?.rootEvent ?? room?.findEventById?.(threadRootId)
                )
              : undefined;
          const resolvedTarget: SearchResultOpenTarget = threadRootId
            ? {
                mainEventId: target.mainEventId,
                threadRootId,
                ...(isThreadTitle ? { threadTitle: true as const } : {}),
              }
            : target;
          let threadName: string | undefined;
          if (threadRootId && !isThreadTitle) {
            threadName = isRootHit ? summaryText || '' : summaryText || rootPreviewText || '';
          }
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
      }
    );
    return { items, editFetches, threadFetches };
  }, [caches, client, membersLoaded, open, page, resolvedVersion, sessionId, t, threadIndex]);

  // Fetch missing edit targets and thread titles from the server when local sources lack them.
  useEffect(() => {
    const isSummaryReady = (roomId: string) =>
      !sessionId || caches.summaryRooms.get(`${sessionId}\u0000${roomId}`) === true;
    const fetchOnce = <T>(
      cache: Map<string, T | undefined>,
      roomId: string,
      key: string,
      load: () => Promise<T>,
      fallback: T
    ) => {
      if (!isSummaryReady(roomId) || cache.has(key)) return;
      cache.set(key, undefined);
      void load()
        .catch(() => fallback)
        .then((value) => {
          if (cachesRef.current !== caches) return;
          cache.set(key, value);
          if (mountedRef.current) setResolvedVersion((n) => n + 1);
        });
    };
    if (typeof client.fetchRoomEvent === 'function') {
      editFetches.forEach(([roomId, eventId]) =>
        fetchOnce(
          caches.edits,
          roomId,
          `${roomId}\u0000${eventId}`,
          () =>
            client
              .fetchRoomEvent(roomId, eventId)
              .then((ev) => inspectEventThread(ev?.content, ev?.unsigned, eventId)),
          null
        )
      );
    }
    if (typeof client.relations === 'function') {
      threadFetches.forEach(([roomId, threadRootId]) =>
        fetchOnce(
          caches.threads,
          roomId,
          getCrossRoomThreadIndexKey(roomId, threadRootId),
          async () => {
            const result = await client.relations(
              roomId,
              threadRootId,
              RelationType.Thread,
              EventType.RoomMessage,
              { dir: Direction.Backward, limit: 50 }
            );
            const info = getLatestThreadSummaryInfoFromEventSources(result?.events);
            if (info && sessionId && cachesRef.current === caches) {
              storeThreadSummaryInState(sessionId, roomId, threadRootId, info);
            }
            return {
              summaryText: info?.summaryText,
              rootPreviewText: getVisibleThreadEventBodyPreviewText(
                result?.originalEvent ?? undefined
              ),
            };
          },
          {}
        )
      );
    }
  }, [caches, client, editFetches, sessionId, threadFetches]);

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
