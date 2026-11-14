import React, {
  FormEvent,
  MouseEvent,
  RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useAtomValue } from 'jotai';
import { type Room, SearchOrderBy } from 'matrix-js-sdk';
import {
  Avatar,
  Box,
  Chip,
  Icon,
  IconButton,
  Icons,
  Input,
  type RectCords,
  Spinner,
  Text,
  color,
  config,
} from 'folds';
import { PopOut, revealDirectionControls } from '../ui/directional';
import { ChoiceMenu } from '../ui/ChoiceMenu';
import { RoomAvatar } from '../avatars/RoomAvatar';
import { ScrollTopContainer } from '../ui/ScrollTopContainer';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useLoadedRoomMembers } from '../matrix/hooks/useLoadedRoomMembers';
import { useMediaAuthentication } from '../matrix/hooks/useMediaAuthentication';
import { makeHighlightRegex } from './highlightRegex';
import { mDirectAtom } from '../matrix/state/mDirectList';
import { getDirectPartnerId, getDirectRoomAvatarUrl, getRoomAvatarUrl } from '../matrix/room';
import { flattenMessageSearchRows, MESSAGE_SEARCH_FALLBACK_ROW_LIMIT } from './messageSearchRows';
import { shouldFetchNextMessageSearchPage } from './messageSearchPagination';
import { getMessageSearchRenderState } from './messageSearchRenderState';
import { areMessageSearchRoomsEqual, normalizeMessageSearchRooms } from './messageSearchScope';
import { SearchResultItem } from './SearchResultItem';
import { SearchRoomPicker } from './MessageSearchFilters';
import { useMessageSearch } from './useMessageSearch';
import { useOpenSearchResult } from './useOpenSearchResult';
import * as css from './MessageSearch.css';

export type MessageSearchProps = {
  /** The rooms searched when the address names none: the rooms of Home or of a space. */
  defaultRooms: string[];
  /** The default scope's name, such as "Home" or the space's name. */
  scopeName: string;
  /** Whether the search can reach every room the user is in. */
  allowGlobal?: boolean;
  /** The page's scroll container; results load more as it nears the end. */
  scrollRef: RefObject<HTMLDivElement>;
};

type MessageSearchRow = ReturnType<typeof flattenMessageSearchRows>[number];

/** First guess before measuring: a room header is one line, a result card a few. */
const estimateRowHeight = (row: MessageSearchRow | undefined): number =>
  row?.kind === 'room-header' ? 52 : 120;

const parseRooms = (value: string | null): string[] | undefined =>
  value
    ? normalizeMessageSearchRooms(
        value
          .split(',')
          .map((roomId) => roomId.trim())
          .filter(Boolean)
      )
    : undefined;

/** The address names the order only when it is not the default, newest first. */
const parseOrder = (value: string | null): SearchOrderBy =>
  value === SearchOrderBy.Rank ? SearchOrderBy.Rank : SearchOrderBy.Recent;

/** A room's picture beside its name over its results; a direct chat shows the other person. */
function ResultRoomAvatar({ room }: { room: Room }) {
  const client = useMatrixClient();
  const authenticated = useMediaAuthentication();
  const direct = useAtomValue(mDirectAtom).has(room.roomId);
  const src = direct
    ? getDirectRoomAvatarUrl(client, room, 64, authenticated)
    : getRoomAvatarUrl(client, room, 64, authenticated);
  return (
    <Avatar size="200">
      <RoomAvatar
        roomId={room.roomId}
        fallbackId={direct ? getDirectPartnerId(room) : undefined}
        src={src}
        alt={room.name}
        renderFallback={() => <Text size="H6">{room.name.slice(0, 1)}</Text>}
      />
    </Avatar>
  );
}

/**
 * Message search: the term, scope and order live in the address (`term`, `rooms`, `global`,
 * `order`), so a search can be linked and the command palette can open one. Results come grouped
 * by room and load page by page while scrolling.
 */
export function MessageSearch({
  defaultRooms,
  scopeName,
  allowGlobal = true,
  scrollRef,
}: MessageSearchProps) {
  const client = useMatrixClient();
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const term = searchParams.get('term')?.trim() ?? '';
  const global = allowGlobal && searchParams.get('global') === 'true';
  const explicitRooms = parseRooms(searchParams.get('rooms'));
  const order = parseOrder(searchParams.get('order'));
  const [draft, setDraft] = useState(term);
  useEffect(() => setDraft(term), [term]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [pickerAnchor, setPickerAnchor] = useState<RectCords>();
  const [orderAnchor, setOrderAnchor] = useState<RectCords>();

  const implicitRooms = useMemo(() => normalizeMessageSearchRooms(defaultRooms), [defaultRooms]);
  const [stableRooms, setStableRooms] = useState(implicitRooms);
  if (!areMessageSearchRoomsEqual(stableRooms, implicitRooms)) setStableRooms(implicitRooms);
  let rooms: string[] | undefined = explicitRooms ?? stableRooms;
  if (global) rooms = undefined;

  const search = useMessageSearch({ term, rooms, order });
  const pages = search.data?.pages;
  // Every loaded page contributes its room groups and the terms the server matched.
  const { groups, rows, highlights, highlightRegex, shownCount, hiddenCount } = useMemo(() => {
    const loaded = pages ?? [];
    const allGroups = loaded.flatMap((page) => page.groups);
    const matchedTerms = [...new Set(loaded.flatMap((page) => page.highlights))];
    return {
      groups: allGroups,
      rows: flattenMessageSearchRows(allGroups),
      highlights: matchedTerms,
      highlightRegex: makeHighlightRegex(matchedTerms),
      shownCount: allGroups.reduce((sum, group) => sum + group.items.length, 0),
      hiddenCount: loaded.reduce((sum, page) => sum + page.hidden, 0),
    };
  }, [pages]);

  // Senders are named from their rooms' members, loaded here for rooms the user has not opened;
  // rows render again as each list arrives.
  useLoadedRoomMembers(
    client,
    groups.map((group) => group.roomId)
  );

  const virtualizer = useVirtualizer({
    overscan: 4,
    count: rows.length,
    estimateSize: (index) => estimateRowHeight(rows[index]),
    getScrollElement: () => scrollRef.current,
    // The list starts below the field and the filters, inside the same scrolling page.
    scrollMargin: listRef.current?.offsetTop ?? 0,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const renderState = getMessageSearchRenderState({
    hasTerm: term.length > 0,
    status: search.status,
    groupsCount: groups.length,
    virtualItemCount: virtualItems.length,
  });

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = search;
  // The results there are: those shown once every page is in, else the server's total less
  // the hits the loaded pages left out.
  const serverCount = pages?.at(-1)?.count;
  let total: number | undefined;
  if (!hasNextPage) total = shownCount;
  else if (serverCount !== undefined) total = Math.max(serverCount - hiddenCount, shownCount);
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
        // A failed page shows as the query's error state; the promise itself never rejects.
        void fetchNextPage();
      }
    };
    check();
    scroll.addEventListener('scroll', check, { passive: true });
    return () => scroll.removeEventListener('scroll', check);
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, rows.length, scrollRef]);

  /** Rewrites the address with `change` applied; the search follows it. */
  const updateParams = (change: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(searchParams);
    change(next);
    setSearchParams(next, { replace: true });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    updateParams((next) => {
      if (draft.trim()) next.set('term', draft.trim());
      else next.delete('term');
    });
  };

  const clear = () => {
    setDraft('');
    updateParams((next) => next.delete('term'));
    inputRef.current?.focus();
  };

  // Home (or the space), every room, or rooms picked by hand: one scope at a time.
  const chooseScope = () =>
    updateParams((next) => {
      next.delete('global');
      next.delete('rooms');
    });
  const chooseGlobal = () =>
    updateParams((next) => {
      next.set('global', 'true');
      next.delete('rooms');
    });
  const chooseRooms = (roomIds: string[]) =>
    updateParams((next) => {
      next.delete('global');
      if (roomIds.length > 0) next.set('rooms', roomIds.join(','));
      else next.delete('rooms');
    });
  const chooseOrder = (value: SearchOrderBy) =>
    updateParams((next) => {
      if (value === SearchOrderBy.Rank) next.set('order', value);
      else next.delete('order');
    });

  const open = useOpenSearchResult();

  const renderRow = (index: number) => {
    const row = rows[index];
    if (!row) return null;
    const room = client.getRoom(row.roomId);
    if (row.kind === 'room-header') {
      return (
        <Box alignItems="Center" gap="200" className={css.GroupTitle}>
          {room && <ResultRoomAvatar room={room} />}
          <Text as="h2" size="H5" truncate>
            {revealDirectionControls(room?.name ?? row.roomId)}
          </Text>
        </Box>
      );
    }
    if (!room) return null;
    return (
      <Box direction="Column" className={css.Result}>
        <SearchResultItem
          room={room}
          item={row.item}
          highlights={highlights}
          highlightRegex={highlightRegex}
          onOpen={(roomId, target) => void open(roomId, target)}
        />
      </Box>
    );
  };

  const recentOrder = {
    name: t('mindroomUi.message-search.searchFilters.recent'),
    value: SearchOrderBy.Recent,
  };
  const orders = [
    recentOrder,
    { name: t('mindroomUi.message-search.searchFilters.relevance'), value: SearchOrderBy.Rank },
  ];
  const orderIndex = Math.max(
    orders.findIndex((choice) => choice.value === order),
    0
  );
  const currentOrder = orders[orderIndex] ?? recentOrder;
  const scopeChosen = !global && !explicitRooms;
  // The rooms picked by hand, each a chip that removes it, in the order of their names.
  const pickedRooms = (explicitRooms ?? [])
    .map((roomId) => ({ roomId, name: client.getRoom(roomId)?.name ?? roomId }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const openPicker = (event: MouseEvent<HTMLButtonElement>) =>
    setPickerAnchor(event.currentTarget.getBoundingClientRect());
  const openOrder = (event: MouseEvent<HTMLButtonElement>) =>
    setOrderAnchor(event.currentTarget.getBoundingClientRect());

  return (
    <Box direction="Column" gap="400">
      <Box as="form" direction="Column" gap="200" onSubmit={submit}>
        <Input
          ref={inputRef}
          className={css.SearchField}
          size="500"
          variant="SurfaceVariant"
          radii="400"
          outlined
          type="search"
          autoFocus
          before={<Icon size="200" src={Icons.Search} />}
          after={
            draft ? (
              <IconButton
                type="button"
                size="300"
                radii="300"
                variant="SurfaceVariant"
                aria-label={t('mindroomUi.message-search.searchInput.clear')}
                onClick={clear}
              >
                <Icon size="100" src={Icons.Cross} />
              </IconButton>
            ) : undefined
          }
          placeholder={t('mindroomUi.message-search.searchInput.searchForKeyword')}
          aria-label={t('mindroomUi.message-search.messageSearch.searchMessages')}
          value={draft}
          onChange={(event: { currentTarget: { value: string } }) =>
            setDraft(event.currentTarget.value)
          }
        />
        <Box wrap="Wrap" alignItems="Center" gap="200">
          <Chip
            type="button"
            variant={scopeChosen ? 'Primary' : 'SurfaceVariant'}
            radii="Pill"
            aria-pressed={scopeChosen}
            onClick={chooseScope}
          >
            <Text size="T200">{scopeName}</Text>
          </Chip>
          {allowGlobal && (
            <Chip
              type="button"
              variant={global ? 'Primary' : 'SurfaceVariant'}
              radii="Pill"
              aria-pressed={global}
              onClick={chooseGlobal}
            >
              <Text size="T200">{t('mindroomUi.message-search.searchFilters.global')}</Text>
            </Chip>
          )}
          <PopOut
            anchor={pickerAnchor}
            position="Bottom"
            align="Start"
            offset={4}
            content={
              <SearchRoomPicker
                scopeRooms={implicitRooms ?? []}
                everyRoom={allowGlobal}
                picked={explicitRooms ?? []}
                onSave={(roomIds) => {
                  setPickerAnchor(undefined);
                  chooseRooms(roomIds);
                }}
                onDismiss={() => setPickerAnchor(undefined)}
              />
            }
          >
            <Chip
              type="button"
              variant={explicitRooms ? 'Primary' : 'SurfaceVariant'}
              radii="Pill"
              aria-haspopup="menu"
              aria-expanded={!!pickerAnchor}
              before={<Icon size="50" src={Icons.Filter} />}
              onClick={openPicker}
            >
              <Text size="T200">
                {explicitRooms
                  ? `${t('mindroomUi.message-search.searchFilters.rooms')} (${
                      explicitRooms.length
                    })`
                  : t('mindroomUi.message-search.searchFilters.rooms')}
              </Text>
            </Chip>
          </PopOut>
          {pickedRooms.map(({ roomId, name }) => {
            return (
              <Chip
                key={roomId}
                type="button"
                variant="Secondary"
                radii="Pill"
                aria-label={t('thread.aria.removeTagFilter', {
                  tag: revealDirectionControls(name),
                })}
                after={<Icon size="50" src={Icons.Cross} />}
                onClick={() =>
                  chooseRooms(pickedRooms.filter((r) => r.roomId !== roomId).map((r) => r.roomId))
                }
              >
                <Text size="T200" truncate className={css.RoomChipName}>
                  {revealDirectionControls(name)}
                </Text>
              </Chip>
            );
          })}
          <PopOut
            anchor={orderAnchor}
            position="Bottom"
            align="End"
            offset={4}
            content={
              <ChoiceMenu
                label={t('mindroomUi.message-search.searchFilters.sortBy')}
                choices={orders}
                current={orderIndex}
                onChoose={(index) => {
                  setOrderAnchor(undefined);
                  const chosen = orders[index];
                  if (chosen) chooseOrder(chosen.value);
                }}
                onDismiss={() => setOrderAnchor(undefined)}
              />
            }
          >
            <Chip
              type="button"
              className={css.FilterEnd}
              variant="SurfaceVariant"
              radii="Pill"
              aria-haspopup="menu"
              aria-expanded={!!orderAnchor}
              aria-label={`${t('mindroomUi.message-search.searchFilters.sortBy')}: ${
                currentOrder.name
              }`}
              after={<Icon size="50" src={Icons.Sort} />}
              onClick={openOrder}
            >
              <Text size="T200">{currentOrder.name}</Text>
            </Chip>
          </PopOut>
        </Box>
        {term && groups.length > 0 && (
          <Text size="T200" priority="300" role="status">
            {total === undefined
              ? t('mindroomUi.message-search.messageSearch.resultsFor', { term })
              : t('mindroomUi.message-search.messageSearch.resultCountFor', { count: total, term })}
          </Text>
        )}
      </Box>

      {!term && (
        <Text size="T300" priority="300">
          {t('mindroomUi.message-search.messageSearch.searchDescription')}
        </Text>
      )}
      {search.status === 'error' && (
        <Text size="T300" role="alert" style={{ color: color.Critical.Main }}>
          {t('mindroomUi.message-search.messageSearch.searchFailed')}
        </Text>
      )}
      {term && search.status === 'success' && groups.length === 0 && (
        <Text size="T300" priority="300">
          {t('mindroomUi.message-search.messageSearch.noResultsFor', { term })}
        </Text>
      )}
      {renderState.showLoadingSkeletons && (
        <Box justifyContent="Center" style={{ padding: config.space.S400 }}>
          <Spinner size="400" variant="Secondary" />
        </Box>
      )}

      <div ref={listRef}>
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
                  insetInlineStart: 0,
                  width: '100%',
                  transform: `translateY(${
                    virtualItem.start - virtualizer.options.scrollMargin
                  }px)`,
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
      </div>

      {isFetchingNextPage && (
        <Box justifyContent="Center">
          <Spinner size="200" variant="Secondary" />
        </Box>
      )}
      <ScrollTopContainer scrollRef={scrollRef} className={css.ScrollTop}>
        <IconButton
          size="300"
          radii="Pill"
          variant="Surface"
          outlined
          aria-label={t('mindroomUi.message-search.messageSearch.scrollToTop')}
          onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          <Icon size="200" src={Icons.ChevronTop} />
        </IconButton>
      </ScrollTopContainer>
    </Box>
  );
}
