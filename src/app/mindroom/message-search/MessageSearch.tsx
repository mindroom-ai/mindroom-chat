import React, { FormEvent, RefObject, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Box, Button, Chip, Icon, Icons, Input, Spinner, Text, color, config } from 'folds';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { makeHighlightRegex } from '../../plugins/highlightRegex';
import { flattenMessageSearchRows, MESSAGE_SEARCH_FALLBACK_ROW_LIMIT } from './messageSearchRows';
import { shouldFetchNextMessageSearchPage } from './messageSearchPagination';
import { getMessageSearchRenderState } from './messageSearchRenderState';
import {
  areMessageSearchRoomsEqual,
  normalizeMessageSearchRooms,
  shouldDeferImplicitMessageSearch,
} from './messageSearchScope';
import type { SearchResultOpenTarget } from './searchResultOpenTarget';
import { SearchResultItem, type SearchResultBodyRenderer } from './SearchResultGroup';
import { useMessageSearch } from './useMessageSearch';

export type MessageSearchProps = {
  /** The rooms searched when the address names none: the rooms of Home or of a space. */
  defaultRooms: string[];
  /** False while `defaultRooms` is still being worked out, which would narrow the search. */
  defaultRoomsReady?: boolean;
  /** The default scope's name, such as "Home" or the space's name. */
  scopeName: string;
  /** Whether the search can reach every room the user is in. */
  allowGlobal?: boolean;
  /** The page's scroll container; results load more as it nears the end. */
  scrollRef: RefObject<HTMLDivElement>;
  renderBody: SearchResultBodyRenderer;
};

const parseRooms = (value: string | null): string[] | undefined =>
  value
    ? normalizeMessageSearchRooms(
        value
          .split(',')
          .map((roomId) => roomId.trim())
          .filter(Boolean)
      )
    : undefined;

/**
 * Message search: the term and scope live in the address (`term`, `rooms`, `global`), so a
 * search can be linked and the command palette can open one. Results come grouped by room,
 * newest first, and load page by page while scrolling.
 */
export function MessageSearch({
  defaultRooms,
  defaultRoomsReady = true,
  scopeName,
  allowGlobal = true,
  scrollRef,




  const { navigateRoom, navigateRoomThread } = useRoomNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const term = searchParams.get('term')?.trim() ?? '';
  const global = allowGlobal && searchParams.get('global') === 'true';
  const explicitRooms = parseRooms(searchParams.get('rooms'));
  const [draft, setDraft] = useState(term);
  useEffect(() => setDraft(term), [term]);

  const implicitRooms = useMemo(() => normalizeMessageSearchRooms(defaultRooms), [defaultRooms]);
  const [stableRooms, setStableRooms] = useState(implicitRooms);
  if (!areMessageSearchRoomsEqual(stableRooms, implicitRooms)) setStableRooms(implicitRooms);
  let rooms: string[] | undefined = explicitRooms ?? stableRooms;
  if (global) rooms = undefined;

  const deferred = shouldDeferImplicitMessageSearch({
    hasTerm: term.length > 0,
    global,
    hasExplicitRooms: !!explicitRooms,
    implicitRoomsReady: defaultRoomsReady,
  });
  const search = useMessageSearch({ term: deferred ? undefined : term, rooms });
  const pages = search.data?.pages;
  const highlights = useMemo(
    () => Array.from(new Set(pages?.flatMap((page) => page.highlights) ?? [])),
    [pages]
  );
  const highlightRegex = useMemo(() => makeHighlightRegex(highlights), [highlights]);
  const groups = useMemo(() => pages?.flatMap((page) => page.groups) ?? [], [pages]);
  const rows = useMemo(() => flattenMessageSearchRows(groups), [groups]);
  const count = pages?.[0]?.count;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (rows[index]?.kind === 'room-header' ? 40 : 120),
    overscan: 4,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const renderState = getMessageSearchRenderState({
    hasTerm: term.length > 0,
    status: search.status,
    groupsCount: groups.length,
    virtualItemCount: virtualItems.length,
  });

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = search;
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return undefined;
    const check = () => {
      if (
        shouldFetchNextMessageSearchPage({
          hasNextPage,
          isFetchingNextPage,
          scrollTop: scroll.scrollTop,
          clientHeight: scroll.clientHeight,
          scrollHeight: scroll.scrollHeight,
        })
      ) {
        fetchNextPage().catch(() => undefined);
      }
    };
    check();
    scroll.addEventListener('scroll', check, { passive: true });
    return () => scroll.removeEventListener('scroll', check);
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, rows.length, scrollRef]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = new URLSearchParams(searchParams);
    if (draft.trim()) next.set('term', draft.trim());
    else next.delete('term');
    setSearchParams(next, { replace: true });
  };

  const setGlobal = (value: boolean) => {
    const next = new URLSearchParams(searchParams);
    if (value) {
      next.set('global', 'true');
      next.delete('rooms');
    } else next.delete('global');
    setSearchParams(next, { replace: true });
  };

  const open = useCallback(
    (roomId: string, target: SearchResultOpenTarget) => {
      if (target.threadRootId) {
        navigateRoomThread(roomId, target.threadRootId, target.mainEventId);
        return;
      }
      navigateRoom(roomId, target.mainEventId);
    },
    [navigateRoom, navigateRoomThread]
  );

  const renderRow = (index: number) => {
    const row = rows[index];
    if (!row) return null;
    const room = mx.getRoom(row.roomId);
    if (row.kind === 'room-header') {
      return (
        <Box style={{ paddingTop: config.space.S400 }}>
          <Text size="H5" truncate>
            {room?.name ?? row.roomId}
          </Text>
        </Box>
      );
    }
    if (!room) return null;
    return (
      <Box style={{ paddingTop: config.space.S200 }}>
        <SearchResultItem
          room={room}
          item={row.item}
          highlights={highlights}
          highlightRegex={highlightRegex}
          renderBody={renderBody}
          onOpen={open}
        />
      </Box>
    );
  };

  let scopeLabel = scopeName;
  if (global) scopeLabel = t('mindroomUi.message-search.allRooms');
  else if (explicitRooms) {
    scopeLabel = t('mindroomUi.message-search.selectedRooms', { count: explicitRooms.length });
  }

  return (
    <Box direction="Column" gap="400">
      <Box as="form" direction="Column" gap="200" onSubmit={submit}>
        <Input
          size="500"
          variant="SurfaceVariant"
          radii="400"
          outlined
          type="search"
          autoFocus
          before={<Icon size="200" src={Icons.Search} />}
          placeholder={t('mindroomUi.message-search.placeholder')}
          aria-label={t('mindroomUi.message-search.placeholder')}
          value={draft}
          onChange={(event: { currentTarget: { value: string } }) =>
            setDraft(event.currentTarget.value)
          }
        />
        <Box gap="200" wrap="Wrap" alignItems="Center">
          <Chip
            variant={global ? 'SurfaceVariant' : 'Primary'}
            radii="Pill"
            aria-pressed={!global}
            onClick={() => setGlobal(false)}
          >
            <Text size="T200">{global ? scopeName : scopeLabel}</Text>
          </Chip>
          {allowGlobal && (
            <Chip
              variant={global ? 'Primary' : 'SurfaceVariant'}
              radii="Pill"
              aria-pressed={global}
              onClick={() => setGlobal(true)}
            >
              <Text size="T200">{t('mindroomUi.message-search.allRooms')}</Text>
            </Chip>
          )}
          {term && typeof count === 'number' && (
            <Text size="T200" priority="300" role="status">
              {t('mindroomUi.message-search.resultCount', { count })}
            </Text>
          )}
        </Box>
      </Box>

      {!term && (
        <Text size="T300" priority="300">
          {t('mindroomUi.message-search.prompt')}
        </Text>
      )}
      {search.status === 'error' && (
        <Text size="T300" role="alert" style={{ color: color.Critical.Main }}>
          {t('mindroomUi.message-search.failed')}
        </Text>
      )}
      {term && search.status === 'success' && groups.length === 0 && (
        <Text size="T300" priority="300">
          {t('mindroomUi.message-search.noResults', { term })}
        </Text>
      )}
      {renderState.showLoadingSkeletons && (
        <Box justifyContent="Center" style={{ padding: config.space.S400 }}>
          <Spinner size="400" variant="Secondary" />
        </Box>
      )}

      {renderState.showVirtualizedResults && (
        <div style={{ position: 'relative', height: virtualizer.getTotalSize() }}>
          {virtualItems.map((virtualItem) => (
            <div
              key={rows[virtualItem.index]?.key ?? virtualItem.key}
              ref={virtualizer.measureElement}
              data-index={virtualItem.index}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              {renderRow(virtualItem.index)}
            </div>
          ))}
        </div>
      )}
      {/* Without a measured scroll container (first paint, tests) the first rows render plainly. */}
      {renderState.showVirtualizerFallback &&
        rows
          .slice(0, MESSAGE_SEARCH_FALLBACK_ROW_LIMIT)
          .map((row, index) => <React.Fragment key={row.key}>{renderRow(index)}</React.Fragment>)}

      {isFetchingNextPage && (
        <Box justifyContent="Center">
          <Spinner size="200" variant="Secondary" />
        </Box>
      )}
      {hasNextPage && !isFetchingNextPage && (
        <Box justifyContent="Center">
          <Button
            size="300"
            variant="Secondary"
            fill="Soft"
            radii="300"
            onClick={() => fetchNextPage().catch(() => undefined)}
          >
            <Text size="B300">{t('mindroomUi.message-search.loadMore')}</Text>
          </Button>
        </Box>
      )}
    </Box>
  );
}
