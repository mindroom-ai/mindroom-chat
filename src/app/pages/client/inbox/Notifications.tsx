import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, Box, Button, Chip, Spinner, Text, color, config } from 'folds';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import {
  Method,
  type INotification,
  type INotificationsResponse,
  type MatrixClient,
  type Room,
} from 'matrix-js-sdk';
import { SequenceCard } from '../../../components/sequence-card';
import { RoomAvatar } from '../../../components/room-avatar';
import { AsyncStatus } from '../../../hooks/useAsyncCallback';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { useRoomNavigate } from '../../../hooks/useRoomNavigate';
import { getMemberDisplayName, getRoomAvatarUrl } from '../../../utils/room';
import { getMxIdLocalPart } from '../../../utils/matrix';
import { MindroomMarkRoomReadChip } from '../../../mindroom/notifications/MindroomMarkRoomReadChip';
import {
  resolveNotificationEvent,
  shouldRenderNotificationLoadingPlaceholders,
} from './notificationTimelineView';

const PAGE_SIZE = 30;

type NotificationFilter = 'all' | 'highlight';

/** A run of notifications from one room, in the order the server listed them. */
type RoomNotifications = { room: Room; notifications: INotification[] };

type NotificationPages = {
  status: AsyncStatus;
  notifications: INotification[];
  /** Where the next, older page starts; undefined once the list is complete. */
  nextToken?: string;
};

const requestNotifications = (
  mx: MatrixClient,
  filter: NotificationFilter,
  from: string | undefined
): Promise<INotificationsResponse> =>
  mx.http.authedRequest<INotificationsResponse>(Method.Get, '/notifications', {
    limit: String(PAGE_SIZE),
    ...(filter === 'highlight' ? { only: 'highlight' } : {}),
    ...(from ? { from } : {}),
  });

/** The notifications of the signed-in account, one page at a time, newest first. */
const useNotificationPages = (mx: MatrixClient, filter: NotificationFilter) => {
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
      requestNotifications(mx, filter, from).then(
        (page) => {
          if (generation.current !== mine) return;
          setPages((held) => ({
            status: AsyncStatus.Success,
            notifications: from
              ? [...held.notifications, ...page.notifications]
              : page.notifications,
            nextToken: page.next_token || undefined,
          }));
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

  return { ...pages, loadOlder };
};

/** Consecutive notifications of a joined room become one group; rooms left since are skipped. */
const groupByRoom = (mx: MatrixClient, notifications: INotification[]): RoomNotifications[] =>
  notifications.reduce<RoomNotifications[]>((groups, notification) => {
    const room = mx.getRoom(notification.room_id);
    if (!room || room.getMyMembership() !== 'join') return groups;
    const last = groups[groups.length - 1];
    if (last?.room.roomId === room.roomId) last.notifications.push(notification);
    else groups.push({ room, notifications: [notification] });
    return groups;
  }, []);

const PREVIEW_LENGTH = 280;
/** Long messages show their start; Open shows the rest in the room. */
const previewText = (text: string): string =>
  text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH).trimEnd()}…` : text;

function NotificationRow({
  room,
  notification,
  onOpen,
}: {
  room: Room;
  notification: INotification;
  onOpen: (eventId: string) => void;
}) {
  const { t } = useTranslation();
  const event = resolveNotificationEvent(room, notification.event);
  const sender = event.getSender() ?? '';
  const senderName = getMemberDisplayName(room, sender) ?? getMxIdLocalPart(sender) ?? sender;
  const { body } = event.getContent();
  const text = typeof body === 'string' && body.trim() ? body : t('sharedUi.notifications.event');
  const eventId = event.getId() ?? notification.event.event_id;

  return (
    <Box gap="300" alignItems="Start" style={{ padding: config.space.S300 }}>
      <Box direction="Column" grow="Yes" gap="100" style={{ minWidth: 0 }}>
        <Box gap="200" alignItems="Baseline">
          <Text size="T300" truncate>
            <b>{senderName}</b>
          </Text>
          <Text size="T200" priority="300" style={{ flexShrink: 0 }}>
            {dayjs(notification.ts).format('MMM D, HH:mm')}
          </Text>
        </Box>
        <Text size="T300" style={{ whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>
          {previewText(text)}
        </Text>
      </Box>
      <Chip variant="Secondary" radii="Pill" onClick={() => onOpen(eventId)}>
        <Text size="T200">{t('sharedUi.notifications.open')}</Text>
      </Chip>
    </Box>
  );
}

/** The Inbox's Notifications page: messages that notified this account, grouped by room. */
export function Notifications() {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const { navigateRoom } = useRoomNavigate();
  const [filter, setFilter] = useState<NotificationFilter>('all');
  const { status, notifications, nextToken, loadOlder } = useNotificationPages(client, filter);
  const groups = useMemo(() => groupByRoom(client, notifications), [client, notifications]);
  const filters: [NotificationFilter, string][] = [
    ['all', t('sharedUi.notifications.allNotifications')],
    ['highlight', t('sharedUi.notifications.highlighted')],
  ];

  return (
    <Box direction="Column" gap="400" style={{ padding: config.space.S400 }}>
      <Text size="H4">{t('sharedUi.notifications.notificationMessages')}</Text>
      <Box gap="200" role="group" aria-label={t('sharedUi.notifications.filter')}>
        {filters.map(([value, label]) => (
          <Chip
            key={value}
            radii="Pill"
            variant={filter === value ? 'Primary' : 'SurfaceVariant'}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            <Text size="T200">{label}</Text>
          </Chip>
        ))}
      </Box>
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
      {groups.map(({ room, notifications: roomNotifications }) => (
        <Box
          key={`${room.roomId}:${roomNotifications[0].event.event_id}`}
          direction="Column"
          gap="200"
        >
          <Box alignItems="Center" gap="200">
            <Avatar size="200">
              <RoomAvatar
                roomId={room.roomId}
                src={getRoomAvatarUrl(client, room, 64, useAuthentication)}
                alt={room.name}
                renderFallback={() => <Text size="H6">{room.name.slice(0, 1)}</Text>}
              />
            </Avatar>
            <Text size="H5" truncate style={{ flexGrow: 1 }}>
              {room.name}
            </Text>
            {roomNotifications.some((notification) => !notification.read) && (
              <MindroomMarkRoomReadChip roomId={room.roomId} />
            )}
          </Box>
          <SequenceCard direction="Column" style={{ color: color.SurfaceVariant.OnContainer }}>
            {roomNotifications.map((notification) => (
              <NotificationRow
                key={notification.event.event_id}
                room={room}
                notification={notification}
                onOpen={(eventId) => navigateRoom(room.roomId, eventId)}
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
          <Text size="B300">{t('mindroomUi.threads.mindroomRoomTimeline.loadOlderMessages')}</Text>
        </Button>
      )}
    </Box>
  );
}
