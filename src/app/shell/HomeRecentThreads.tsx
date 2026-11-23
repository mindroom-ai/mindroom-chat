import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Text } from 'folds';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { archivedRoomsAtom, isRoomVisible } from '../matrix/state/archivedRooms';
import { getThreadsPath } from '../routes/pathUtils';
import { buildSidebarThreadEntries } from '../sidebar/threads/threadNavCategoryUtils';
import { useThreadEntryRow } from '../sidebar/threads/ThreadNavItem';
import {
  crossRoomThreadIndexAtom,
  type CrossRoomThreadIndexEntry,
} from '../threads/cross-room/crossRoomThreadIndex';
import { useSnoozeNow } from '../threads/tags/useSnoozeNow';
import { ownDirectionLine, revealDirectionControls } from '../ui/directional';
import { Badge } from './HomeAsk';
import * as noticeCss from '../account/onboarding/WelcomeNotice.css';
import * as css from './Home.css';

/** How many threads Home lists. */
const HOME_RECENT_THREADS = 4;

function RecentThreadRow({ entry }: { entry: CrossRoomThreadIndexEntry }) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const { room, viewModel, relativeTime, shownRef, open } = useThreadEntryRow(entry);
  if (!room) return null;
  const title = viewModel?.displayTitleText ?? entry.summaryText;
  // The thread's face: the first agent or person who answered in it, else whoever started it.
  const face =
    viewModel?.participants.find((person) => person.userId !== mx.getUserId()) ??
    viewModel?.participants[0];
  const roomName = revealDirectionControls(entry.roomName);
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
        {face ? (
          <Badge id={face.userId} name={face.displayName} src={face.avatarUrl} />
        ) : (
          <span className={css.PickerAvatar} />
        )}
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
          <Text
            as="span"
            size="T200"
            priority="300"
            className={css.ThreadRoom}
            {...ownDirectionLine}
          >
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
  const visible = useMemo(
    () =>
      Array.from(index.entries.values()).filter((entry) => isRoomVisible(entry.roomId, archived)),
    [archived, index.entries]
  );
  // Renewed when a snooze ends, so its thread is listed again then, as in the sidebar.
  const now = useSnoozeNow(useMemo(() => visible.map((entry) => entry.snoozedUntilTs), [visible]));
  const entries = useMemo(
    () => buildSidebarThreadEntries(visible, [], new Set(), HOME_RECENT_THREADS, now),
    [now, visible]
  );
  if (entries.length === 0) return null;
  return (
    <section className={css.Recent} aria-labelledby="home-recent-threads">
      <div className={css.RecentHeader}>
        <Text as="h2" size="L400" priority="300" id="home-recent-threads">
          {t('home.recent.title')}
        </Text>
        <button
          type="button"
          className={noticeCss.NoticeAction}
          onClick={() => void navigate(getThreadsPath())}
        >
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
