import { useEffect, useLayoutEffect, useRef } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { KnownMembership, type MatrixClient } from 'matrix-js-sdk';
import InviteSound from '../../../public/sound/invite.ogg';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useServerSyncApplied } from '../matrix/hooks/useServerSyncApplied';
import { useSetting } from '../preferences/useSetting';
import { allInvitesAtom } from '../matrix/state/inviteList';
import { settingsAtom } from '../preferences/settings';
import { playChime } from './playChime';
import { raiseOnce } from './notifiedOnce';
import { MESSAGE_NOTIFY_MAX_AGE_MS } from './messageNotificationRules';
import { matchesEnum } from '../lib/matchesEnum';

const invitedRoomIds = (mx: MatrixClient): string[] =>
  mx
    .getRooms()
    .filter((room) => matchesEnum(room.getMyMembership(), KnownMembership.Invite))
    .map((room) => room.roomId);

/**
 * Chimes and shows a system notification for each new invite. Invites the client already had
 * when it started, or when the account switched, are not new: the list is reset to the current
 * client's invites first, since it may still hold the previous account's. Neither are the invites
 * of the first sync from the server, which catches up on the time before this start. One tab of
 * the browser announces each invite; its claim lasts as long as a message may take to notify, so
 * every tab has heard of the invite by then, and a later invite to the same room notifies again.
 */
export function InviteNotifications() {
  const client = useMatrixClient();
  const { t } = useTranslation();
  const invites = useAtomValue(allInvitesAtom);
  const setInvites = useSetAtom(allInvitesAtom);
  const [showNotifications] = useSetting(settingsAtom, 'showNotifications');
  const [notificationSounds] = useSetting(settingsAtom, 'isNotificationSounds');
  const synced = useServerSyncApplied(client);
  const seen = useRef<Set<string>>(new Set());
  const previous = useRef<readonly string[]>([]);
  // The list as rendered before the baseline; its stale entries are never treated as new.
  const stale = useRef<readonly string[]>();

  useLayoutEffect(() => {
    const baseline = invitedRoomIds(client);
    seen.current = new Set(baseline);
    previous.current = baseline;
    stale.current = invites;
    setInvites({ type: 'INITIALIZE', rooms: baseline });
    // Only a client change resets the baseline; `invites` is read for the stale marker alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, setInvites]);

  useEffect(() => {
    if (synced) invitedRoomIds(client).forEach((roomId) => seen.current.add(roomId));
  }, [client, synced]);

  useEffect(() => {
    if (invites === stale.current) return;
    const before = new Set(previous.current);
    previous.current = invites;
    const current = new Set(invites);
    // A room that left the list can invite again later, and then it is new again.
    seen.current.forEach((roomId) => {
      if (!current.has(roomId)) seen.current.delete(roomId);
    });
    const added = invites.filter((roomId) => !before.has(roomId) && !seen.current.has(roomId));
    added.forEach((roomId) => seen.current.add(roomId));
    if (!synced || added.length === 0) return;

    const keys = added.map((roomId) => `invite:${roomId}`);
    raiseOnce(
      client.getUserId() ?? '',
      keys,
      (claimed) => {
        if (notificationSounds) playChime(InviteSound).catch(() => undefined);
        const SystemNotification = typeof window === 'undefined' ? undefined : window.Notification;
        if (showNotifications && SystemNotification?.permission === 'granted') {
          // eslint-disable-next-line no-new
          new SystemNotification(t('mindroomUi.notifications.invitation.title'), {
            body: t('mindroomUi.notifications.invitation.body', { count: claimed.length }),
            silent: true,
          });
        }
      },
      MESSAGE_NOTIFY_MAX_AGE_MS
    );
  }, [client, invites, notificationSounds, showNotifications, synced, t]);

  return null;
}
