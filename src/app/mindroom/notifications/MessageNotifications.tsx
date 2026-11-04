import { useEffect, useRef } from 'react';
import { useAtomValue } from 'jotai';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  MatrixEventEvent,
  RoomEvent,
  type MatrixClient,
  type MatrixEvent,
  type Room,
  type RoomEventHandlerMap,
} from 'matrix-js-sdk';
// A two-tone chime made for this app with ffmpeg's `aevalsrc` (987.77 Hz, then 1318.51 Hz).
import MessageSound from '../../../../public/sound/notification.ogg';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { useClientStartupContext } from '../../pages/client/ClientStartupContext';
import { useSetting } from '../../state/hooks/settings';
import { mDirectAtom } from '../../state/mDirectList';
import { settingsAtom } from '../../state/settings';
import { getMemberDisplayName } from '../../utils/room';
import { getMxIdLocalPart } from '../../utils/matrix';
import { MINDROOM_FAVICON_SRC } from '../branding/branding';
import {
  getLocalizedThreadMessagePreviewText,
  replaceMatrixUserIdsWithDisplayNames,
} from '../threads/threadMessagePreview';
import { playChime } from './playChime';
import {
  getViewedPlace,
  isNoticeOnScreen,
  readMessageNotice,
  type MessageNotice,
} from './messageNotifications';

const BODY_LENGTH = 180;

const shorten = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > BODY_LENGTH ? `${flat.slice(0, BODY_LENGTH).trimEnd()}…` : flat;
};

/**
 * The notification's title and text: the room and "sender: preview", or in a direct chat the
 * person and the preview alone.
 */
export const describeNotice = (
  room: Room,
  notice: MessageNotice,
  direct: boolean,
  t: TFunction
): { title: string; body: string } => {
  const senderName =
    getMemberDisplayName(room, notice.sender) ?? getMxIdLocalPart(notice.sender) ?? notice.sender;
  const preview = replaceMatrixUserIdsWithDisplayNames(
    room,
    getLocalizedThreadMessagePreviewText(notice.content, t) ?? '',
    '@'
  );
  if (direct) return { title: senderName, body: shorten(preview) };
  return { title: room.name, body: shorten(preview ? `${senderName}: ${preview}` : senderName) };
};

type NotifySettings = {
  desktop: boolean;
  sound: boolean;
  directRooms: Set<string>;
  place: ReturnType<typeof getViewedPlace>;
  open: (notice: MessageNotice) => void;
  t: TFunction;
};

const windowHasFocus = (): boolean => document.visibilityState === 'visible' && document.hasFocus();

const showNotice = (client: MatrixClient, notice: MessageNotice, settings: NotifySettings) => {
  const room = client.getRoom(notice.roomId);
  if (!room || isNoticeOnScreen(notice, settings.place, windowHasFocus())) return;

  if (settings.sound && notice.sound) playChime(MessageSound).catch(() => undefined);

  const SystemNotification = typeof window === 'undefined' ? undefined : window.Notification;
  if (!settings.desktop || SystemNotification?.permission !== 'granted') return;
  const { title, body } = describeNotice(
    room,
    notice,
    settings.directRooms.has(room.roomId),
    settings.t
  );
  // One notification per room: a newer message replaces the one before it.
  const note = new SystemNotification(title, {
    body,
    icon: MINDROOM_FAVICON_SRC,
    tag: notice.roomId,
    silent: true,
  });
  note.onclick = () => {
    window.focus();
    note.close();
    settings.open(notice);
  };
};

/**
 * Shows a desktop notification and plays the message chime for each new message the account's
 * push rules notify for, unless the window shows it already. Clicking a notification opens its
 * room, or its thread. Starts after the first sync, so history never notifies.
 */
export function MessageNotificationsFeature() {
  const client = useMatrixClient();
  const { t } = useTranslation();
  const location = useLocation();
  const { hasCompletedInitialSync } = useClientStartupContext();
  const { navigateRoom, navigateRoomThread } = useRoomNavigate();
  const directRooms = useAtomValue(mDirectAtom);
  const [desktop] = useSetting(settingsAtom, 'showNotifications');
  const [sound] = useSetting(settingsAtom, 'isNotificationSounds');

  const settings = useRef<NotifySettings>();
  settings.current = {
    desktop,
    sound,
    directRooms,
    place: getViewedPlace(client, location),
    open: (notice) => {
      if (notice.threadId) navigateRoomThread(notice.roomId, notice.threadId);
      else navigateRoom(notice.roomId);
    },
    t,
  };

  useEffect(() => {
    if (!hasCompletedInitialSync) return undefined;
    // An agent's reply notifies once, however many times its finished text arrives.
    const notified = new Set<string>();
    const consider = (event: MatrixEvent, room: Room) => {
      const notice = readMessageNotice(client, room, event, Date.now());
      if (!notice || notified.has(notice.eventId) || !settings.current) return;
      notified.add(notice.eventId);
      showNotice(client, notice, settings.current);
    };
    const onTimeline: RoomEventHandlerMap[RoomEvent.Timeline] = (event, room, older, gone, at) => {
      // Back-pagination and removals are history; only events the sync just delivered are news.
      if (!room || older || gone || !at.liveEvent) return;
      // Push rules need the clear content, so encrypted messages wait for their keys.
      if (event.isBeingDecrypted() || event.shouldAttemptDecryption()) {
        event.once(MatrixEventEvent.Decrypted, () => consider(event, room));
        return;
      }
      consider(event, room);
    };
    client.on(RoomEvent.Timeline, onTimeline);
    return () => {
      client.removeListener(RoomEvent.Timeline, onTimeline);
    };
  }, [client, hasCompletedInitialSync]);

  return null;
}
