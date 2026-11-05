import { ChangeEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import FocusTrap from 'focus-trap-react';
import { useAtomValue } from 'jotai';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { JoinRule, MatrixError } from 'matrix-js-sdk';
import {
  Box,
  Button,
  Icon,
  Icons,
  Input,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Spinner,
  Text,
} from 'folds';
import classNames from 'classnames';
import { Dialog, Header, IconButton } from '../glass/GlassPrimitives';
import { RoomSummaryLoader } from '../RoomSummaryLoader';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useDebounce } from '../../hooks/useDebounce';
import { AsyncStatus } from '../../hooks/useAsyncCallback';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { allRoomsAtom } from '../../state/room-list/roomList';
import { mxcUrlToHttp } from '../../utils/mediaUrl';
import { stopPropagation } from '../../utils/keyboard';
import { getExplorePath } from '../../pages/pathUtils';
import { JoinRoomRow, ROW_ACTION_ATTRIBUTE } from './JoinRoomRow';
import {
  type DirectoryRoom,
  type JoinAddress,
  filterDirectoryRooms,
  parseJoinAddress,
} from './joinAddress';
import * as modalCss from '../Modal500.css';
import * as css from './JoinRoom.css';

type OpenRoom = (roomIdOrAlias: string, viaServers?: string[], eventId?: string) => void;

const PAGE_SIZE = 30;

// A server that keeps its room list private answers with 403 (or has no list at all).
const directoryHidden = (error: unknown): boolean =>
  error instanceof MatrixError && (error.httpStatus === 403 || error.httpStatus === 404);

const useAvatarUrl = () => {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  return (mxc: string | undefined) =>
    mxc ? mxcUrlToHttp(mx, mxc, useAuthentication, 96, 96, 'crop') ?? undefined : undefined;
};

/** The room a pasted address points at, with the name and topic its summary gives. */
function AddressRow({ address, onOpen }: { address: JoinAddress; onOpen: OpenRoom }) {
  const allRooms = useAtomValue(allRoomsAtom);
  const avatarUrl = useAvatarUrl();
  return (
    <RoomSummaryLoader roomIdOrAlias={address.roomIdOrAlias} viaServers={address.viaServers}>
      {(state, _retry, viaServers, resolvedRoomId) => {
        const summary = state.status === AsyncStatus.Success ? state.data : undefined;
        // Without a summary the server decides at the join, and its answer shows on the row.
        let joinRule: JoinRule | undefined;
        if (summary) joinRule = (summary.join_rule as JoinRule | undefined) ?? JoinRule.Public;
        else if (state.status === AsyncStatus.Error) joinRule = JoinRule.Public;
        return (
          <JoinRoomRow
            roomIdOrAlias={address.roomIdOrAlias}
            roomId={summary?.room_id ?? resolvedRoomId}
            viaServers={viaServers}
            name={summary?.name || address.roomIdOrAlias}
            topic={summary?.topic}
            avatarUrl={avatarUrl(summary?.avatar_url)}
            memberCount={summary?.num_joined_members}
            joinRule={joinRule}
            allRooms={allRooms}
            onOpen={(target) => onOpen(target, viaServers, address.eventId)}
          />
        );
      }}
    </RoomSummaryLoader>
  );
}

type DirectoryRoomsProps = {
  /** What the field holds now; the loaded rooms narrow to it at every key. */
  search: string;
  /** What it held when typing paused: the server's search term. */
  term: string;
  onOpen: OpenRoom;
};

/** The public rooms of the user's own server, paged, narrowed by the search text. */
function DirectoryRooms({ search, term, onOpen }: DirectoryRoomsProps) {
  const { t } = useTranslation();
  const avatarUrl = useAvatarUrl();
  const mx = useMatrixClient();
  const allRooms = useAtomValue(allRoomsAtom);

  const directory = useInfiniteQuery({
    queryKey: ['join-room-directory', mx.getUserId(), term],
    queryFn: ({ pageParam }) =>
      mx.publicRooms({
        limit: PAGE_SIZE,
        since: pageParam,
        filter: term ? { generic_search_term: term } : undefined,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.next_batch || undefined,
    placeholderData: keepPreviousData,
    retry: false,
  });

  const rooms = useMemo(() => {
    const byId = new Map<string, DirectoryRoom>();
    directory.data?.pages.forEach((page) =>
      page.chunk.forEach((room) => byId.set(room.room_id, room as DirectoryRoom))
    );
    return filterDirectoryRooms([...byId.values()], search);
  }, [directory.data, search]);

  const labelId = 'join-room-directory-label';
  const hidden = directory.isError && directoryHidden(directory.error);
  let status: string | undefined;
  if (directory.isError && rooms.length === 0) {
    status = hidden
      ? t('sharedUi.joinAddressPrompt.directoryHidden')
      : t('sharedUi.explore.failedToLoadPublicRoomsPleaseTryAgain');
  } else if (!directory.isFetching && rooms.length === 0) {
    status = search.trim()
      ? t('sharedUi.joinAddressPrompt.noMatches')
      : t('sharedUi.joinAddressPrompt.noPublicRooms');
  }

  return (
    <>
      <Text id={labelId} size="L400" priority="300" className={css.SectionLabel}>
        {t('sharedUi.joinAddressPrompt.publicRoomsOn', { server: mx.getDomain() ?? '' })}
      </Text>
      {rooms.length > 0 && (
        <ul className={css.RoomList} aria-labelledby={labelId}>
          {rooms.map((room) => (
            <JoinRoomRow
              key={room.room_id}
              roomIdOrAlias={room.room_id}
              roomId={room.room_id}
              name={room.name || room.canonical_alias || room.room_id}
              topic={room.topic}
              avatarUrl={avatarUrl(room.avatar_url)}
              memberCount={room.num_joined_members}
              joinRule={(room.join_rule as JoinRule | undefined) ?? JoinRule.Public}
              allRooms={allRooms}
              onOpen={onOpen}
            />
          ))}
        </ul>
      )}
      {directory.isFetching && !directory.isFetchingNextPage && rooms.length === 0 && (
        <Box justifyContent="Center" className={css.Status}>
          <Spinner variant="Secondary" size="400" />
        </Box>
      )}
      {status && (
        <Text
          size="T300"
          priority="300"
          className={css.Status}
          role={directory.isError ? 'alert' : 'status'}
        >
          {status}
        </Text>
      )}
      {directory.isError && !hidden && (
        <Box justifyContent="Center" className={css.Status}>
          <Button
            variant="Secondary"
            fill="Soft"
            size="300"
            radii="300"
            onClick={() => void directory.refetch()}
          >
            <Text size="B300">{t('sharedUi.roomCard.retry')}</Text>
          </Button>
        </Box>
      )}
      {directory.hasNextPage && (
        <Box justifyContent="Center" className={css.Status}>
          <Button
            variant="Secondary"
            fill="Soft"
            size="300"
            radii="300"
            disabled={directory.isFetchingNextPage}
            onClick={() => void directory.fetchNextPage()}
            before={
              directory.isFetchingNextPage ? <Spinner variant="Secondary" size="100" /> : undefined
            }
          >
            <Text size="B300">{t('mindroomUi.notices.showMore')}</Text>
          </Button>
        </Box>
      )}
    </>
  );
}

type JoinRoomPanelProps = {
  /** Opens a room (or its join preview) with its routing servers and an event. */
  onOpen: OpenRoom;
  /** Runs when the Explore link is followed, so a dialog can close first. */
  onExplore?: () => void;
};

/** Moves focus between the rows' Join and Open buttons, and up into the field from the first. */
const moveFocus = (container: HTMLElement | null, field: HTMLElement | null, step: 1 | -1) => {
  const actions = [
    ...(container?.querySelectorAll<HTMLElement>(`[${ROW_ACTION_ATTRIBUTE}]`) ?? []),
  ];
  const current = actions.findIndex((action) => action === document.activeElement);
  const next = current + step;
  if (next < 0) field?.focus();
  else actions[Math.min(next, actions.length - 1)]?.focus();
};

/**
 * The search field over the public rooms of the user's server. A pasted address or matrix.to
 * link puts that room on top instead, with Join or Open. Arrow keys move between the rows,
 * Enter in the field joins or opens the pasted room.
 */
export function JoinRoomPanel({ onOpen, onExplore }: JoinRoomPanelProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  // The server hears of the text once typing pauses: an address typed one key at a time is not
  // looked up at every key, and the directory is searched once per pause.
  const [settled, setSettled] = useState('');
  const settle = useDebounce(setSettled, { wait: 300 });
  useEffect(() => {
    settle(search);
  }, [search, settle]);
  const address = parseJoinAddress(search);
  const settledAddress = parseJoinAddress(settled);
  const addressReady =
    !!address && !!settledAddress && settledAddress.roomIdOrAlias === address.roomIdOrAlias;
  const fieldRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const handleKeys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    moveFocus(resultsRef.current, fieldRef.current, event.key === 'ArrowDown' ? 1 : -1);
  };

  const handleFieldKeys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && address) {
      event.preventDefault();
      // Before the pause, Enter looks the address up at once; once its row is there, Enter
      // presses its Join or Open.
      if (!addressReady) setSettled(search);
      else resultsRef.current?.querySelector<HTMLElement>(`[${ROW_ACTION_ATTRIBUTE}]`)?.click();
    } else handleKeys(event);
  };

  return (
    <div className={css.Panel}>
      <div className={css.Field}>
        <Input
          ref={fieldRef}
          type="search"
          value={search}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setSearch(event.target.value)}
          onKeyDown={handleFieldKeys}
          placeholder={t('sharedUi.joinAddressPrompt.searchOrPaste')}
          aria-label={t('sharedUi.joinAddressPrompt.searchOrPaste')}
          before={<Icon size="200" src={Icons.Search} />}
          variant="Background"
          size="500"
          radii="400"
          // Not a sign-in field: password managers leave it alone.
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
          spellCheck={false}
          autoFocus
        />
      </div>
      {/* Arrow keys pressed on a row's button move to the next or previous row. */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div ref={resultsRef} className={css.Results} onKeyDown={handleKeys}>
        {address && settledAddress && addressReady && (
          <ul className={css.RoomList}>
            <AddressRow
              key={`${settledAddress.roomIdOrAlias}|${settledAddress.eventId ?? ''}`}
              address={settledAddress}
              onOpen={onOpen}
            />
          </ul>
        )}
        {address && !addressReady && (
          <Box justifyContent="Center" className={css.Status}>
            <Spinner variant="Secondary" size="400" />
          </Box>
        )}
        {!address && <DirectoryRooms search={search} term={settled.trim()} onOpen={onOpen} />}
      </div>
      <div className={css.ExploreFooter}>
        <Text as="span" size="T200">
          <Link to={getExplorePath()} onClick={onExplore} className={css.ExploreLink}>
            {t('sharedUi.joinAddressPrompt.browseExplore')}
          </Link>
        </Text>
      </div>
    </div>
  );
}

type JoinAddressPromptProps = {
  onOpen: OpenRoom;
  onCancel: () => void;
};

const TITLE_ID = 'join-address-prompt-title';

// Clicking outside or pressing Escape closes the dialog. The search field focuses itself.
const TRAP_DISMISSAL = { clickOutsideDeactivates: true, escapeDeactivates: stopPropagation };

/** The Join a Room dialog: public rooms of the user's server, and any address pasted in. */
export function JoinAddressPrompt({ onOpen, onCancel }: JoinAddressPromptProps) {
  const { t } = useTranslation();
  const phone = useScreenSizeContext() === ScreenSize.Mobile;

  return (
    <Overlay backdrop={<OverlayBackdrop />} open>
      <OverlayCenter className={phone ? modalCss.PhoneOverlayCenter : modalCss.SafeOverlayCenter}>
        <FocusTrap
          focusTrapOptions={{ ...TRAP_DISMISSAL, initialFocus: false, onDeactivate: onCancel }}
        >
          <Dialog
            role="dialog"
            aria-modal="true"
            aria-labelledby={TITLE_ID}
            variant="Surface"
            className={classNames(css.Dialog, phone && modalCss.PhoneModal)}
          >
            <Header size="500" className={css.TitleBar}>
              <Text id={TITLE_ID} as="h2" size="H4" style={{ flexGrow: 1 }}>
                {t('sharedUi.joinAddressPrompt.joinARoom')}
              </Text>
              <IconButton
                size="300"
                radii="300"
                onClick={onCancel}
                aria-label={t('sharedUi.joinAddressPrompt.close')}
              >
                <Icon src={Icons.Cross} />
              </IconButton>
            </Header>
            <JoinRoomPanel onOpen={onOpen} onExplore={onCancel} />
          </Dialog>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}
