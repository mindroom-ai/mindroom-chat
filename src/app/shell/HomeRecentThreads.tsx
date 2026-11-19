import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Avatar, Text } from 'folds';
import { UserAvatar } from '../avatars/UserAvatar';
import { useRelativeTime } from '../i18n/useRelativeTime';
import { nameInitials } from '../lib/common';
import { useMinuteClock } from '../lib/hooks/useMinuteClock';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../matrix/hooks/useMediaAuthentication';
import { archivedRoomsAtom, isRoomVisible } from '../matrix/state/archivedRooms';
import { useRoomNavigate } from '../navigation/useRoomNavigate';
import { useRoomViewMode } from '../navigation/useRoomViewMode';
import { getThreadsPath } from '../routes/pathUtils';
import { buildSidebarThreadEntries } from '../sidebar/threads/threadNavCategoryUtils';
import {
  crossRoomThreadIndexAtom,
  type CrossRoomThreadIndexEntry,
} from '../threads/cross-room/crossRoomThreadIndex';
import { buildCompactThreadCardViewModelFromRecord } from '../threads/overview/compactThreadCardViewModel';
import { useInitializeShownThread } from '../threads/useInitializeShownThread';
import { ownDirectionLine, revealDirectionControls } from '../ui/directional';
import * as css from './Home.css';

/** How many threads Home lists. */
export const HOME_RECENT_THREADS = 4;

function RecentThreadRow({ entry }: { entry: CrossRoomThreadIndexEntry }) {
  const { t, i18n } = useTranslation();
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const room = mx.getRoom(entry.roomId);
  const { navigateRoom, navigateRoomThreadDirect } = useRoomNavigate();
  const { viewMode } = useRoomViewMode(entry.roomId);
  const relativeTime = useRelativeTime(entry.lastActivityTs);
  const shownRef = useInitializeShownThread(entry.roomId, entry.threadRootId);
  const viewModel = useMemo(
    () =>
      room
        ? buildCompactThreadCardViewModelFromRecord({
            record: entry.threadRecord,
            room,
            currentUserId: mx.getUserId() ?? undefined,
            mx,
            useAuthentication,
            t,
            locale: i18n.language,
          })
        : undefined,
    [entry.threadRecord, i18n.language, mx, room, t, useAuthentication]
  );
  if (!room) return null;
  const title = viewModel?.displayTitleText ?? entry.summaryText;
  // The thread's face: the first agent or person who answered in it, else whoever started it.
  const face = viewModel?.participants.find((person) => person.userId !== mx.getUserId());
  const roomName = revealDirectionControls(entry.roomName);
  const open = () => {
    if (viewMode === 'classic') navigateRoom(entry.roomId, entry.threadRootId);
    else navigateRoomThreadDirect(entry.roomId, entry.threadRootId);
  };
  return (
    <li>
      <button
        type="button"
        className={css.ThreadRow}
        onClick={open}
        aria-label={[
          t('thread.aria.openThread', { title }),
          entry.isUnread && t('home.recent.unread'),
          roomName,
          relativeTime,
        ]
          .filter(Boolean)
          .join('. ')}
      >
        <Avatar size="200" radii="Pill" className={css.ThreadAvatar} aria-hidden="true">
          {face && (
            <UserAvatar
              userId={face.userId}
              src={face.avatarUrl}
              alt=""
              renderFallback={() => <Text size="L400">{nameInitials(face.displayName)}</Text>}
            />
          )}
        </Avatar>
        <span className={css.ThreadDotSlot} aria-hidden="true">
          {entry.isUnread && <span className={css.ThreadDot} />}
        </span>
        <span className={css.ThreadText}>
          <Text
            as="span"
            size="T300"
            className={css.ThreadTitle}
            data-unread={entry.isUnread || undefined}
            ref={shownRef}
            {...ownDirectionLine}
          >
            {title}
          </Text>
          <Text as="span" size="T200" priority="300" className={css.ThreadRoom}>
            {roomName}
          </Text>
        </span>
        <Text as="span" size="T200" priority="300" className={css.ThreadTime}>
          {relativeTime}
        </Text>
      </button>
    </li>
  );
}

/**
 * The four threads with the newest activity across the account's rooms and direct chats, neither
 * resolved nor snoozed, as hairline rows; nothing while there are none.
 */
export function HomeRecentThreads() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const index = useAtomValue(crossRoomThreadIndexAtom);
  const archived = useAtomValue(archivedRoomsAtom);
  const now = useMinuteClock();
  const entries = useMemo(
    () =>
      buildSidebarThreadEntries(
        Array.from(index.entries.values()).filter((entry) => isRoomVisible(entry.roomId, archived)),
        [],
        new Set(),
        HOME_RECENT_THREADS,
        now
      ),
    [archived, index.entries, now]
  );
  if (entries.length === 0) return null;
  return (
    <section className={css.Recent} aria-labelledby="home-recent-threads">
      <div className={css.RecentHeader}>
        <Text as="h2" size="L400" priority="300" id="home-recent-threads">
          {t('home.recent.title')}
        </Text>
        <button type="button" className={css.LinkButton} onClick={() => navigate(getThreadsPath())}>
          <Text as="span" size="T200">
            {t('home.recent.allThreads')}
          </Text>
        </button>
      </div>
      <ul className={css.ThreadList}>
        {entries.map((entry) => (
          <RecentThreadRow key={entry.key} entry={entry} />
        ))}
      </ul>
    </section>
  );
}
