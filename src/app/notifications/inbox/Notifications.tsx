import {
  type CSSProperties,
  type ReactNode,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Avatar,
  Badge,
  Box,
  Button,
  Chip,
  Icon,
  Icons,
  Spinner,
  Text,
  color,
  config,
  toRem,
} from 'folds';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useAtomValue } from 'jotai';
import {
  MatrixEventEvent,
  Method,
  RoomEvent,
  type IRoomEvent,
  type INotification,
  type MatrixEvent,
  type INotificationsResponse,
  type MatrixClient,
  type Room,
} from 'matrix-js-sdk';
import { Page, PageContent, PageContentCenter, PageHeader } from '../../ui/page/Page';
import { PageScroll } from '../../ui/page/PageScroll';
import { SequenceCard } from '../../ui/SequenceCard';
import { ownDirectionLine, revealDirectionControls } from '../../ui/directional';
import { RoomAvatar } from '../../avatars/RoomAvatar';
import { mDirectAtom } from '../../matrix/state/mDirectList';
import { roomToUnreadAtom } from '../../matrix/state/roomToUnread';
import { isRecord } from '../../lib/isRecord';
import { PhoneBackButton } from '../../ui/page/PhoneBackButton';
import { LoneTouchTarget } from '../../ui/styles/TouchTarget.css';
import * as css from './Notifications.css';
import { INBOX_PATH } from '../../routes/paths';
import { AsyncStatus } from '../../lib/hooks/useAsyncCallback';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../../matrix/hooks/useMediaAuthentication';
import { useRoomNavigate } from '../../navigation/useRoomNavigate';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';
import {
  getDirectPartnerId,
  getDirectRoomAvatarUrl,
  getRoomAvatarUrl,
  getSenderName,
} from '../../matrix/room';
import { NameWithUserId } from '../../matrix/NameWithUserId';
import { useLoadedRoomMembers } from '../../matrix/hooks/useLoadedRoomMembers';
import { RenderMessageContent } from '../../messages/content/RenderMessageContent';
import { MessageRowBoundary } from '../../messages/content/MessageRowBoundary';
import {
  MessageBadEncryptedContent,
  MessageDeletedContent,
} from '../../messages/content/FallbackContent';
import {
  getReactCustomHtmlParser,
  LINKIFY_OPTS,
} from '../../messages/html/react-custom-html-parser';
import { useSettingValue } from '../../preferences/useSettingValue';
import { settingsAtom } from '../../preferences/settings';
import { useHour24Clock } from '../../preferences/useHour24Clock';
import { timeMonthDayHourMinute } from '../../lib/time';
import { MarkRoomReadChip } from '../MarkRoomReadChip';
import { isHighlightNotification, isMessageNotification } from '../inboxNotification';
import { getEventThreadId } from '../messageNotificationRules';
import {
  resolveNotificationEvent,
  shouldRenderNotificationLoadingPlaceholders,
} from './notificationTimelineView';
import { mergeRefreshedNotifications } from './notificationRefresh';
import { useKeptRowPlace } from './useKeptRowPlace';

const PAGE_SIZE = 30;
/** The most notifications the server answers in one request. */
const MAX_REQUEST = 100;
/** How long a refresh waits, so that a burst of changes (one sync's) asks the server once. */
const REFRESH_DELAY_MS = 1_000;

type NotificationFilter = 'all' | 'highlight';

/** A run of notifications from one room, in the order the server listed them; never empty. */
type RoomNotifications = { room: Room; notifications: [INotification, ...INotification[]] };

type NotificationPages = {
  status: AsyncStatus;
  notifications: INotification[];
  /** Where the next, older page starts; undefined once the list is complete. */
  nextToken?: string;
};

const requestNotifications = (
  mx: MatrixClient,
  filter: NotificationFilter,
  from: string | undefined,
  limit: number
): Promise<INotificationsResponse> =>
  mx.http.authedRequest<INotificationsResponse>(Method.Get, '/notifications', {
    limit: String(limit),
    ...(filter === 'highlight' ? { only: 'highlight' } : {}),
    ...(from ? { from } : {}),
  });

/** Where the list goes on after `page`, asked from `from`; undefined once the list is complete. */
const pageEnd = (page: INotificationsResponse, from: string | undefined): string | undefined =>
  // A page that brings nothing, or points back at itself, ends the list: some servers keep
  // sending a token after the last page.
  page.next_token && page.next_token !== from && page.notifications.length
    ? page.next_token
    : undefined;

/**
 * The notifications of the signed-in account, one page at a time, newest first. The server keeps
 * their read flags, so `refresh` asks it again for as many as are loaded, in one request, and
 * merges the answer in (`mergeRefreshedNotifications`) through `keepPlace`; a refresh of the
 * list a filter switch replaced asks for the list now shown.
 */
const useNotificationPages = (
  mx: MatrixClient,
  filter: NotificationFilter,
  keepPlace: (apply: () => void) => void
) => {
  const [pages, setPages] = useState<NotificationPages>({
    status: AsyncStatus.Idle,
    notifications: [],
  });
  // Answers for an older filter, or for a page asked twice, are dropped.
  const generation = useRef(0);

  const load = useCallback(
    (from: string | undefined) => {
      const mine = generation.current;
      setPages((held) => ({ ...held, status: AsyncStatus.Loading }));
      requestNotifications(mx, filter, from, PAGE_SIZE).then(
        (page) => {
          if (generation.current !== mine) return;
          setPages((held) => {
            // An older page goes on only from where the list still ends: a refresh may have
            // replaced the rows it was asked after.
            if (from && held.nextToken !== from) return { ...held, status: AsyncStatus.Success };
            return {
              status: AsyncStatus.Success,
              notifications: from
                ? [...held.notifications, ...page.notifications]
                : page.notifications,
              nextToken: pageEnd(page, from),
            };
          });
        },
        () => {
          if (generation.current !== mine) return;
          setPages((held) => ({ ...held, status: AsyncStatus.Error }));
        }
      );
    },
    [filter, mx]
  );

  useEffect(() => {
    generation.current += 1;
    setPages({ status: AsyncStatus.Idle, notifications: [] });
    load(undefined);
  }, [load]);

  const loadOlder = useCallback(() => {
    if (pages.nextToken && pages.status !== AsyncStatus.Loading) load(pages.nextToken);
  }, [load, pages.nextToken, pages.status]);

  const shown = useRef({ filter, count: 0, keepPlace });
  useEffect(() => {
    shown.current = { filter, count: pages.notifications.length, keepPlace };
  }, [filter, keepPlace, pages.notifications.length]);
  // Only the newest refresh's answer applies.
  const refreshes = useRef(0);
  const refresh = useCallback(() => {
    const mine = generation.current;
    refreshes.current += 1;
    const refreshId = refreshes.current;
    const { filter: shownFilter, count } = shown.current;
    const limit = Math.min(MAX_REQUEST, Math.max(PAGE_SIZE, count));
    requestNotifications(mx, shownFilter, undefined, limit).then(
      (page) => {
        if (generation.current !== mine || refreshes.current !== refreshId) return;
        shown.current.keepPlace(() =>
          flushSync(() =>
            setPages((held) => ({
              ...mergeRefreshedNotifications(held, page.notifications, pageEnd(page, undefined)),
              status: held.status === AsyncStatus.Loading ? held.status : AsyncStatus.Success,
            }))
          )
        );
      },
      // The rows shown stay; the next change asks again.
      () => undefined
    );
  }, [mx]);

  return { ...pages, loadOlder, refresh };
};

/** Whether a receipt event holds a read receipt, public or private, of `userId`. */
const holdsReadReceiptOf = (event: MatrixEvent, userId: string): boolean =>
  Object.values(event.getContent()).some(
    (byType) =>
      isRecord(byType) &&
      ['m.read', 'm.read.private'].some((type) => {
        const byUser = byType[type];
        return isRecord(byUser) && userId in byUser;
      })
  );

/**
 * Calls `refresh` once the account's read state may have changed while the page is shown: unread
 * counts changed (a new notification, a read here or on another device) or a sync brought one of
 * its read receipts. A burst of changes calls it once, `REFRESH_DELAY_MS` after the first.
 */
const useRefreshOnReadChanges = (mx: MatrixClient, refresh: () => void) => {
  const unread = useAtomValue(roomToUnreadAtom);
  const timer = useRef<number>();
  const schedule = useCallback(() => {
    if (timer.current !== undefined) return;
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      refresh();
    }, REFRESH_DELAY_MS);
  }, [refresh]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // The counts the page opened with are what its first load shows.
  const openedWith = useRef(unread);
  useEffect(() => {
    if (unread !== openedWith.current) schedule();
  }, [unread, schedule]);

  useEffect(() => {
    const onReceipt = (event: MatrixEvent) => {
      const userId = mx.getUserId();
      if (userId && holdsReadReceiptOf(event, userId)) schedule();
    };
    mx.on(RoomEvent.Receipt, onReceipt);
    return () => {
      mx.removeListener(RoomEvent.Receipt, onReceipt);
    };
  }, [mx, schedule]);
};

/**
 * Consecutive notifications of a joined room become one group; rooms left since and notifications
 * of state events are skipped.
 */
const groupByRoom = (mx: MatrixClient, notifications: INotification[]): RoomNotifications[] =>
  notifications.reduce<RoomNotifications[]>((groups, notification) => {
    const room = mx.getRoom(notification.room_id);
    if (!room || room.getMyMembership() !== 'join' || !isMessageNotification(notification)) {
      return groups;
    }
    const last = groups.at(-1);
    if (last?.room.roomId === room.roomId) last.notifications.push(notification);
    else groups.push({ room, notifications: [notification] });
    return groups;
  }, []);

/**
 * A key for each group that it keeps while it gains rows at either end (a new notification on
 * top, an older page below), so its rows are not drawn anew: a key its rows had before.
 */
const useGroupKeys = (groups: RoomNotifications[]): string[] => {
  const keyByEvent = useRef(new Map<string, string>());
  return useMemo(() => {
    const taken = new Set<string>();
    const next = new Map<string, string>();
    const keys = groups.map(({ room, notifications }) => {
      const ids = notifications.map(({ event }) => event.event_id);
      const key =
        ids
          .map((id) => keyByEvent.current.get(id))
          .find((held): held is string => held !== undefined && !taken.has(held)) ??
        `${room.roomId}:${ids[0]}`;
      taken.add(key);
      ids.forEach((id) => next.set(id, key));
      return key;
    });
    keyByEvent.current = next;
    return keys;
  }, [groups]);
};

// Long messages show their start; Open shows the rest in the room.
const PREVIEW_MAX_HEIGHT = toRem(240);
const PREVIEW_FADE = 'linear-gradient(to bottom, black 75%, transparent)';

/**
 * The event a notification points at, as the room shows it: its latest edit, decrypted. The
 * notifications API returns events as the server stored them, so an encrypted one is decrypted
 * here when the room timeline does not hold it yet.
 */
const useNotificationEvent = (mx: MatrixClient, room: Room, raw: IRoomEvent): MatrixEvent => {
  const event = useMemo(() => resolveNotificationEvent(room, raw), [room, raw]);
  const [, setDecrypted] = useState(0);
  useEffect(() => {
    if (!event.isEncrypted() || (!event.isBeingDecrypted() && event.getClearContent())) {
      return undefined;
    }
    const redraw = () => setDecrypted((count) => count + 1);
    event.on(MatrixEventEvent.Decrypted, redraw);
    mx.decryptEventIfNeeded(event).catch(() => undefined);
    return () => {
      event.off(MatrixEventEvent.Decrypted, redraw);
    };
  }, [mx, event]);
  return event;
};

/** Message content cut at a fixed height, fading out when it continues below. */
function NotificationPreview({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const measure = () => setCut(element.scrollHeight > element.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    Array.from(element.children).forEach((child) => observer.observe(child));
    return () => observer.disconnect();
  }, [children]);
  return (
    <div
      ref={ref}
      className={css.Preview}
      style={{
        maxHeight: PREVIEW_MAX_HEIGHT,
        overflow: 'hidden',
        overflowWrap: 'anywhere',
        maskImage: cut ? PREVIEW_FADE : undefined,
        WebkitMaskImage: cut ? PREVIEW_FADE : undefined,
      }}
    >
      {children}
    </div>
  );
}

/** How message HTML in this room's rows is turned into React, with authenticated media. */
const useBodyParserOptions = (client: MatrixClient, roomId: string) => {
  const authenticatedMedia = useMediaAuthentication();
  return useMemo(
    () =>
      getReactCustomHtmlParser(client, roomId, {
        linkifyOpts: LINKIFY_OPTS,
        useAuthentication: authenticatedMedia,
      }),
    [client, roomId, authenticatedMedia]
  );
};

/** Mentions and keywords stand out: a tinted row with an accent at its leading edge. */
const highlightedRowStyle = {
  backgroundColor: color.Primary.Container,
  boxShadow: `inset ${toRem(3)} 0 0 ${color.Primary.Main}`,
};

const unreadDotStyle = { width: toRem(8), height: toRem(8), padding: 0, flexShrink: 0 };

// A row out of view is neither laid out nor painted; it keeps the height it last had.
const rowRenderingStyle: CSSProperties = {
  contentVisibility: 'auto',
  containIntrinsicSize: `auto ${toRem(96)}`,
};

type NotificationRowProps = {
  room: Room;
  notification: INotification;
  /** Opens the message: in its thread when it has one, in the room otherwise. */
  onOpen: (roomId: string, eventId: string, threadId?: string) => void;
};

/** One notification; a new page of the list renders only its own rows. */
const NotificationRow = memo(function NotificationRow({
  room,
  notification,
  onOpen,
}: NotificationRowProps) {
  const { t, i18n } = useTranslation();
  const [hour24Clock] = useHour24Clock();
  const client = useMatrixClient();
  const event = useNotificationEvent(client, room, notification.event);
  const parserOptions = useBodyParserOptions(client, room.roomId);
  const autoLoadMedia = useSettingValue(settingsAtom, 'mediaAutoLoad');
  // The row renders again once the room's member list is in, which may tell a copied name from
  // the real one; until then the sender's user ID follows their name.
  useLoadedRoomMembers(client, [room.roomId]);
  const sender = event.getSender() ?? '';
  const senderName = getSenderName(room, sender);
  const eventId = event.getId() ?? notification.event.event_id;
  const content = event.getContent();
  const highlighted = isHighlightNotification(notification);

  let body: ReactNode;
  if (event.isRedacted()) body = <MessageDeletedContent />;
  else if (event.isDecryptionFailure()) body = <MessageBadEncryptedContent />;
  else if (event.isEncrypted() && !event.getClearContent()) body = <Spinner size="100" />;
  else {
    body = (
      <RenderMessageContent
        mEvent={event}
        eventId={eventId}
        roomId={room.roomId}
        eventType={event.getType()}
        msgType={typeof content.msgtype === 'string' ? content.msgtype : ''}
        displayName={senderName}
        ts={event.getTs()}
        edited={!!event.replacingEvent()}
        getContent={(() => content) as <T>() => T}
        mediaAutoLoad={!!autoLoadMedia}
        urlPreview={false}
        outlineAttachment
        htmlReactParserOptions={parserOptions}
        linkifyOpts={LINKIFY_OPTS}
      />
    );
  }

  return (
    <Box
      gap="300"
      alignItems="Start"
      data-notification-event={notification.event.event_id}
      data-notification-highlight={highlighted || undefined}
      style={{
        padding: config.space.S300,
        ...rowRenderingStyle,
        ...(highlighted ? highlightedRowStyle : undefined),
      }}
    >
      <Box direction="Column" grow="Yes" gap="100" style={{ minWidth: 0 }}>
        <Box gap="200" alignItems="Center" wrap="Wrap" style={{ rowGap: 0 }}>
          {!notification.read && (
            <Badge
              variant="Primary"
              fill="Solid"
              radii="Pill"
              size="200"
              role="img"
              aria-label={t('thread.status.unread')}
              style={unreadDotStyle}
            />
          )}
          {/* The display name and the user ID that may follow it are items of this row, so the ID
              wraps onto the next line rather than being cut. Both take the bold weight. */}
          <b style={{ display: 'contents' }}>
            <NameWithUserId
              name={senderName}
              userId={sender}
              size="T300"
              style={{ fontWeight: 'inherit' }}
            />
          </b>
          <Text size="T200" priority="300" style={{ flexShrink: 0 }}>
            {timeMonthDayHourMinute(notification.ts, hour24Clock, i18n.language)}
          </Text>
          {highlighted && (
            <Icon
              size="50"
              src={Icons.Mention}
              aria-label={t('sharedUi.notifications.highlighted')}
              style={{ color: color.Primary.Main, flexShrink: 0 }}
            />
          )}
        </Box>
        <NotificationPreview>{body}</NotificationPreview>
      </Box>
      <Chip
        variant="Secondary"
        radii="Pill"
        className={LoneTouchTarget}
        onClick={() => onOpen(room.roomId, eventId, getEventThreadId(event))}
      >
        <Text size="T200">{t('sharedUi.notifications.open')}</Text>
      </Chip>
    </Box>
  );
});

/**
 * The avatar over a room's notifications. A direct chat shows the other person, with their
 * picture or their color, as the Direct list and the room header do.
 */
function NotificationGroupAvatar({ room }: { room: Room }) {
  const client = useMatrixClient();
  const authenticated = useMediaAuthentication();
  const withPerson = useAtomValue(mDirectAtom).has(room.roomId);
  const pictureUrl = withPerson
    ? getDirectRoomAvatarUrl(client, room, 64, authenticated)
    : getRoomAvatarUrl(client, room, 64, authenticated);
  return (
    <Avatar size="200">
      <RoomAvatar
        roomId={room.roomId}
        fallbackId={withPerson ? getDirectPartnerId(room) : undefined}
        src={pictureUrl}
        alt={room.name}
        renderFallback={() => <Text size="H6">{room.name.slice(0, 1)}</Text>}
      />
    </Avatar>
  );
}

/** The Inbox's Notifications page: messages that notified this account, grouped by room. */
export function Notifications() {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const { navigateRoom, navigateRoomThread } = useRoomNavigate();
  const [filter, setFilter] = useState<NotificationFilter>('all');
  const scrollRef = useRef<HTMLDivElement>(null);
  const { keepPlace, handlers: pointerHandlers } = useKeptRowPlace(scrollRef);
  const { status, notifications, nextToken, loadOlder, refresh } = useNotificationPages(
    client,
    filter,
    keepPlace
  );
  useRefreshOnReadChanges(client, refresh);
  const groups = useMemo(() => groupByRoom(client, notifications), [client, notifications]);
  const groupKeys = useGroupKeys(groups);
  const openNotification = useCallback(
    (roomId: string, eventId: string, threadId?: string) =>
      threadId ? navigateRoomThread(roomId, threadId, eventId) : navigateRoom(roomId, eventId),
    [navigateRoom, navigateRoomThread]
  );
  const filters: [NotificationFilter, string][] = [
    ['all', t('sharedUi.notifications.allNotifications')],
    ['highlight', t('sharedUi.notifications.highlighted')],
  ];
  // A phone's header holds only the way back and the title; the filters open the list instead.
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  const filterChips = (
    <Box shrink="No" gap="200" role="group" aria-label={t('sharedUi.notifications.filter')}>
      {filters.map(([value, label]) => (
        <Chip
          key={value}
          className={css.FilterChip}
          radii="Pill"
          variant={filter === value ? 'Primary' : 'SurfaceVariant'}
          aria-pressed={filter === value}
          onClick={() => setFilter(value)}
        >
          <Text size="T200">{label}</Text>
        </Chip>
      ))}
    </Box>
  );

  return (
    <Page>
      <PageHeader balance>
        <PhoneBackButton to={INBOX_PATH} />
        <Box grow="Yes" alignItems="Center" justifyContent="SpaceBetween" gap="200">
          <Text as="h1" size="H4" truncate>
            {t('sharedUi.notifications.notificationMessages')}
          </Text>
          {!phone && filterChips}
        </Box>
      </PageHeader>
      <PageScroll scrollRef={scrollRef}>
        <PageContent>
          <PageContentCenter>
            <Box direction="Column" gap="400" {...pointerHandlers}>
              {phone && filterChips}
              {shouldRenderNotificationLoadingPlaceholders(status, groups.length) && (
                <Box justifyContent="Center" style={{ padding: config.space.S400 }}>
                  <Spinner variant="Secondary" size="400" />
                </Box>
              )}
              {status !== AsyncStatus.Loading && groups.length === 0 && (
                <Box direction="Column" gap="100">
                  <Text size="H5">{t('sharedUi.notifications.noNotifications')}</Text>
                  <Text size="T300" priority="300">
                    {t('sharedUi.notifications.youDonTHaveAnyNewNotificationsToDisplayYet')}
                  </Text>
                </Box>
              )}
              {groups.map(({ room, notifications: roomNotifications }, index) => (
                <Box key={groupKeys[index]} direction="Column" gap="200">
                  <Box alignItems="Center" gap="200">
                    <NotificationGroupAvatar room={room} />
                    <Text size="H5" truncate style={{ flexGrow: 1 }} {...ownDirectionLine}>
                      {revealDirectionControls(room.name)}
                    </Text>
                    {roomNotifications.some((notification) => !notification.read) && (
                      <MarkRoomReadChip roomId={room.roomId} onMarked={refresh} />
                    )}
                  </Box>
                  <SequenceCard
                    direction="Column"
                    style={{ color: color.SurfaceVariant.OnContainer }}
                  >
                    {roomNotifications.map((notification) => (
                      <MessageRowBoundary
                        key={notification.event.event_id}
                        render={() => (
                          <NotificationRow
                            room={room}
                            notification={notification}
                            onOpen={openNotification}
                          />
                        )}
                      />
                    ))}
                  </SequenceCard>
                </Box>
              ))}
              {nextToken && (
                <Button
                  variant="Secondary"
                  fill="Soft"
                  size="300"
                  radii="300"
                  disabled={status === AsyncStatus.Loading}
                  onClick={loadOlder}
                  style={{ alignSelf: 'center' }}
                >
                  <Text size="B300">
                    {t('mindroomUi.threads.mindroomRoomTimeline.loadOlderMessages')}
                  </Text>
                </Button>
              )}
            </Box>
          </PageContentCenter>
        </PageContent>
      </PageScroll>
    </Page>
  );
}
