import { useEffect, useRef } from 'react';
import { useAtomValue } from 'jotai';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  ClientEvent,
  RoomEvent,
  type ClientEventHandlerMap,
  type MatrixClient,
  type MatrixEvent,
  type Room,
  type RoomEventHandlerMap,
} from 'matrix-js-sdk';
// A two-tone chime made for this app with ffmpeg's `aevalsrc` (987.77 Hz, then 1318.51 Hz).
import MessageSound from '../../../public/sound/notification.ogg';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useRoomNavigate } from '../navigation/useRoomNavigate';
import { conversationOutOfSightAtom } from '../navigation/conversationCover';
import { getViewedPlace } from '../navigation/viewedPlace';
import { useServerSyncApplied } from '../matrix/hooks/useServerSyncApplied';
import { useSetting } from '../preferences/useSetting';
import { mDirectAtom } from '../matrix/state/mDirectList';
import { settingsAtom } from '../preferences/settings';
import { getSenderName } from '../matrix/room';
import { MINDROOM_FAVICON_SRC } from '../ui/branding/branding';
import { revealDirectionControls } from '../ui/directional';
import { createDecryptionWaits, isAwaitingDecryption } from '../matrix/decryptionWaits';
import { isThreadListTimeline } from '../event-store/timeline/roomLiveEventArrive';
import {
  getLocalizedThreadMessagePreviewText,
  replaceMatrixUserIdsWithDisplayNames,
} from '../event-store/threads/threadMessagePreview';
import { playChime } from './playChime';
import { raiseOnce } from './notifiedOnce';
import {
  MESSAGE_NOTIFY_MAX_AGE_MS,
  isEditEvent,
  isNoticeOnScreen,
  readMessageNotice,
  type MessageNotice,
} from './messageNotificationRules';

const BODY_LENGTH = 180;

/**
 * How long the notification of an agent's finished reply waits. A device of the account that
 * watched the reply finish reads it with a receipt on the finishing edit a few milliseconds
 * later, and the other devices get that receipt a sync after the edit. In live tests on a busy
 * server the receipt came at most 0.26 s after the edit, and a receipt from a slow device that
 * reached the reply later within 1 s in 95 of 100 cases. One that comes meanwhile drops the
 * notification; a plain message notifies at once.
 */
export const FINISHED_REPLY_HOLD_MS = 2_000;

const shorten = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > BODY_LENGTH ? `${flat.slice(0, BODY_LENGTH).trimEnd()}…` : flat;
};

/**
 * The notification's title and text: the room and "sender: preview", or in a direct chat the
 * person and the preview alone. The sender's user ID follows their name while the room's member
 * list is not loaded, so nobody reads as a member the client has not loaded yet. Direction
 * controls in the room's name and the message show as code points.
 */
export const describeNotice = (
  room: Room,
  notice: MessageNotice,
  direct: boolean,
  t: TFunction
): { title: string; body: string } => {
  const senderName = getSenderName(room, notice.sender);
  const preview = replaceMatrixUserIdsWithDisplayNames(
    room,
    getLocalizedThreadMessagePreviewText(notice.content, t) ?? '',
    '@'
  );
  if (direct) return { title: senderName, body: shorten(preview) };
  return {
    title: revealDirectionControls(room.name),
    body: shorten(preview ? `${senderName}: ${preview}` : senderName),
  };
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
  const announce = () => {
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
  // A room not opened yet may lack the members who have not posted lately, and with them the one
  // whose name a sender copied; the notification waits for the member list. If the list cannot
  // load, the sender's user ID follows their name.
  if (room.membersLoaded()) announce();
  else room.loadMembersIfNeeded().then(announce, announce);
};

/**
 * Shows a desktop notification and plays the message chime for each new message the account's
 * push rules notify for, unless the window shows it already. Clicking a notification opens its
 * room, or its thread. Starts once the first sync from the server is applied, so history never
 * notifies, and each message notifies once on this device, whichever tab hears of it first.
 */
export function MessageNotificationsFeature() {
  const client = useMatrixClient();
  const { t } = useTranslation();
  const location = useLocation();
  const hasCompletedInitialSync = useServerSyncApplied(client);
  const { navigateRoom, navigateRoomThread } = useRoomNavigate();
  const directRooms = useAtomValue(mDirectAtom);
  const [desktop] = useSetting(settingsAtom, 'showNotifications');
  const [sound] = useSetting(settingsAtom, 'isNotificationSounds');
  // A phone's navigation drawer over the page, or a plugin's cover over the conversation, leaves no
  // room on screen.
  const outOfSight = useAtomValue(conversationOutOfSightAtom);

  const settings = useRef<NotifySettings>();
  settings.current = {
    desktop,
    sound,
    directRooms,
    place: outOfSight ? {} : getViewedPlace(client, location),
    open: (notice) => {
      if (notice.threadId) navigateRoomThread(notice.roomId, notice.threadId);
      else navigateRoom(notice.roomId);
    },
    t,
  };

  useEffect(() => {
    if (!hasCompletedInitialSync) return undefined;
    // Once per device: across reloads and tabs, and however many times an agent's finished
    // reply arrives. A tab that shows the message claims it too, so no other tab announces it.
    const held = new Set<ReturnType<typeof setTimeout>>();
    const consider = (event: MatrixEvent, room: Room) => {
      const now = Date.now();
      const notice = readMessageNotice(client, room, event, now);
      if (!notice) return;
      raiseOnce(client.getUserId() ?? '', [notice.eventId], () => {
        if (!isEditEvent(event)) {
          if (settings.current) showNotice(client, notice, settings.current);
          return;
        }
        // An agent's finished reply waits for a receipt from the device that watched it finish.
        const timer = setTimeout(() => {
          held.delete(timer);
          if (!readMessageNotice(client, room, event, now) || !settings.current) return;
          showNotice(client, notice, settings.current);
        }, FINISHED_REPLY_HOLD_MS);
        held.add(timer);
      });
    };
    // Push rules need the clear content, so an encrypted message waits for its keys, until a
    // decryption works or the message is too old to notify anyway.
    const decryptions = createDecryptionWaits();
    const judge = (event: MatrixEvent, room: Room) => {
      if (isAwaitingDecryption(event)) {
        const left = MESSAGE_NOTIFY_MAX_AGE_MS - (Date.now() - event.getTs());
        decryptions.wait(event, left, () => consider(event, room));
        return;
      }
      consider(event, room);
    };
    const onTimeline: RoomEventHandlerMap[RoomEvent.Timeline] = (event, room, older, gone, at) => {
      // Back-pagination and removals are history; only events the sync just delivered are news,
      // not a root a thread list adds again (at a reload, or at each reply to its thread).
      if (!room || older || gone || !at.liveEvent || isThreadListTimeline(room, at.timeline))
        return;
      // Edits are judged as the sync delivers them, below.
      if (isEditEvent(event)) return;
      judge(event, room);
    };
    // The SDK keeps the edits of a thread nobody opened back from its timeline until it opens, so
    // the edit that completes an agent's reply there never reaches `onTimeline`; every edit the
    // sync delivers is announced here, once the SDK has placed it.
    const onSyncEvent: ClientEventHandlerMap[ClientEvent.Event] = (event) => {
      const room = client.getRoom(event.getRoomId());
      if (room && isEditEvent(event)) judge(event, room);
    };
    client.on(RoomEvent.Timeline, onTimeline);
    client.on(ClientEvent.Event, onSyncEvent);
    return () => {
      // A message still waiting when the account signs out or switches stays quiet.
      decryptions.stop();
      held.forEach((timer) => clearTimeout(timer));
      client.removeListener(RoomEvent.Timeline, onTimeline);
      client.removeListener(ClientEvent.Event, onSyncEvent);
    };
  }, [client, hasCompletedInitialSync]);

  return null;
}
