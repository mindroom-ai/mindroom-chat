import { memo, useMemo, useState } from 'react';
import classNames from 'classnames';
import { useAtom } from 'jotai';
import { Badge, Button, Icon, Icons, Input, Text } from 'folds';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useRelativeTime } from '../../i18n/useRelativeTime';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useLoadedRoomMembers } from '../../matrix/hooks/useLoadedRoomMembers';
import { getCanonicalAliasOrRoomId } from '../../matrix/matrix';
import { getViewedPlace, type ViewedPlace } from '../../navigation/viewedPlace';
import { getThreadsRoomPath, withSearchParam } from '../../routes/pathUtils';
import { ownDirectionLine, revealDirectionControls } from '../../ui/directional';
import { PageNav, PageNavContent } from '../../ui/page/Page';
import { UnreadBadge } from '../../ui/UnreadBadge';
import {
  threadActorName,
  threadIndexReplyPreview,
  threadPreviewText,
  threadTitleText,
} from '../cross-room/threadText';
import {
  groupThreads,
  type ThreadGroupId,
  type ThreadListItem,
  type ThreadsScope,
} from './threadGroups';
import { getThreadsScopeAtom } from './threadsScope';
import { useJoinedRoomThreadLists } from './useJoinedRoomThreadLists';
import { useThreadListItems } from './useThreadListItems';
import * as css from './ThreadsNav.css';

const SCOPES: ThreadsScope[] = ['mine', 'following', 'all'];
/** How many recent threads show at first, and how many more each Show more adds. */
export const RECENT_PAGE = 50;

/** The room and thread the section shows beside the list, to mark its row. */
const useShownThread = (): ViewedPlace => getViewedPlace(useMatrixClient(), useLocation());

type ThreadRowProps = {
  item: ThreadListItem;
  selected: boolean;
  onOpen: (item: ThreadListItem) => void;
  /** Changes when a member list arrives, so the row names its sender again. */
  namesVersion: number;
};

/** One thread: its title and what waits in it, the last reply with its sender, the room. */
const ThreadRow = memo(function ThreadRow({ item, selected, onOpen }: ThreadRowProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const { entry, signals } = item;
  const time = useRelativeTime(entry.lastActivityTs, 'compact');
  const room = mx.getRoom(entry.roomId);
  let chip: string | undefined;
  if (signals.pendingApproval) chip = t('threadsPage.chips.approval');
  else if (signals.pendingQuestion) chip = t('threadsPage.chips.question');
  else if (signals.mentionedMe) chip = t('threadsPage.chips.mention');
  const reply = signals.lastReply;
  const senderName = (senderId: string) =>
    senderId === mx.getUserId() ? t('threadPreview.you') : threadActorName(mx, room, senderId);
  const indexed = reply ? undefined : threadIndexReplyPreview(entry);
  let preview = '';
  if (reply) preview = `${senderName(reply.senderId)}: ${threadPreviewText(t, reply.preview)}`;
  else if (indexed?.senderId) preview = `${senderName(indexed.senderId)}: ${indexed.text}`;
  else if (indexed) preview = indexed.text;
  const read = signals.newCount === 0 && !chip;

  return (
    <button
      type="button"
      className={classNames(css.Row, read && css.RowRead)}
      aria-current={selected ? 'page' : undefined}
      onClick={() => onOpen(item)}
    >
      <span className={css.Body}>
        <span className={css.Line}>
          <Text as="span" size="T300" truncate className={css.Grow} {...ownDirectionLine}>
            {read ? threadTitleText(entry) : <b>{threadTitleText(entry)}</b>}
          </Text>
        </span>
        <span className={css.Line}>
          {chip && (
            <Badge
              variant={
                signals.mentionedMe && !signals.pendingApproval && !signals.pendingQuestion
                  ? 'Primary'
                  : 'Warning'
              }
              fill="Soft"
              radii="300"
              size="400"
            >
              <Text as="span" size="L400">
                {chip}
              </Text>
            </Badge>
          )}
          {entry.threadRecord.status.isStreaming && (
            <span className={css.LiveDot} aria-label={t('threadsPage.working')} role="img" />
          )}
          <Text
            as="span"
            size="T200"
            priority="300"
            truncate
            className={css.Grow}
            {...ownDirectionLine}
          >
            {preview}
          </Text>
        </span>
        <Text
          as="span"
          size="T200"
          priority="300"
          truncate
          className={css.Muted}
          {...ownDirectionLine}
        >
          {revealDirectionControls(entry.roomName)}
        </Text>
      </span>
      <span className={css.Side}>
        <Text as="span" size="T200" priority="300">
          {time}
        </Text>
        {signals.newCount > 0 && <UnreadBadge count={signals.newCount} />}
        {entry.isResolved && (
          <Icon size="100" src={Icons.Check} aria-label={t('threadsPage.chips.resolved')} />
        )}
      </span>
    </button>
  );
});

/**
 * The Threads section's navigation column: the threads of the joined rooms for the chosen scope,
 * grouped by what they need (needs you, unread, agents working, recent, automations folded), with
 * a search; a row opens its thread beside the list.
 */
export function ThreadsNav() {
  // Every page of every room's thread list, so the page lists all threads.
  useJoinedRoomThreadLists(true);
  const items = useThreadListItems();
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const scopeAtom = useMemo(() => getThreadsScopeAtom(mx.getSafeUserId()), [mx]);
  const userId = mx.getSafeUserId();
  const navigate = useNavigate();
  const [scope, setScope] = useAtom(scopeAtom);
  const [query, setQuery] = useState('');
  const [recentLimit, setRecentLimit] = useState(RECENT_PAGE);
  const [automationsOpen, setAutomationsOpen] = useState(false);
  const shown = useShownThread();
  const groups = useMemo(
    () => groupThreads(items, scope, userId, query),
    [items, scope, userId, query]
  );
  // Senders are named from the member lists, which a room the user has not opened lacks.
  const namesVersion = useLoadedRoomMembers(
    mx,
    groups.flatMap((group) => group.items.map((it) => it.entry.roomId))
  );

  const open = (item: ThreadListItem) => {
    const roomSegment = getCanonicalAliasOrRoomId(mx, item.entry.roomId);
    navigate(
      withSearchParam(getThreadsRoomPath(roomSegment), { threadId: item.entry.threadRootId })
    );
  };
  const row = (item: ThreadListItem) => (
    <ThreadRow
      key={item.entry.key}
      item={item}
      selected={shown.roomId === item.entry.roomId && shown.threadId === item.entry.threadRootId}
      onOpen={open}
      namesVersion={namesVersion}
    />
  );
  const groupName = (id: ThreadGroupId) => t(`threadsPage.groups.${id}`);

  return (
    <PageNav label={t('threadsPage.title')}>
      <PageNavContent>
        <div className={css.Top}>
          <Text as="h2" size="H4">
            {t('threadsPage.title')}
          </Text>
          <div className={css.TitleRow}>
            <div className={css.Scopes} role="radiogroup" aria-label={t('threadsPage.scopeLabel')}>
              {SCOPES.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={scope === id}
                  className={css.Scope}
                  onClick={() => setScope(id)}
                >
                  {t(`threadsPage.scope.${id}`)}
                </button>
              ))}
            </div>
          </div>
          <Input
            type="search"
            size="400"
            radii="400"
            variant="Background"
            aria-label={t('threadsPage.search')}
            placeholder={t('threadsPage.search')}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            before={<Icon size="100" src={Icons.Search} />}
          />
        </div>
        {groups.length === 0 && (
          <div className={css.Empty}>
            <Icon size="400" src={Icons.Thread} />
            <Text size="H6">{query ? t('threadsPage.noMatches') : t('threadsPage.noThreads')}</Text>
            {!query && (
              <Text size="T200" priority="300">
                {t('threadsPage.noThreadsDescription')}
              </Text>
            )}
          </div>
        )}
        {groups.map(({ id, items: groupItems }) => {
          if (id === 'automations') {
            return (
              <section key={id} aria-label={groupName(id)}>
                <Button
                  size="300"
                  variant="Secondary"
                  fill="None"
                  radii="300"
                  aria-expanded={automationsOpen}
                  onClick={() => setAutomationsOpen(!automationsOpen)}
                  before={
                    <Icon
                      size="100"
                      src={automationsOpen ? Icons.ChevronBottom : Icons.ChevronRight}
                    />
                  }
                >
                  <Text size="B300">{`${groupName(id)} · ${groupItems.length}`}</Text>
                </Button>
                {automationsOpen && groupItems.map(row)}
              </section>
            );
          }
          const visible = id === 'recent' ? groupItems.slice(0, recentLimit) : groupItems;
          return (
            <section key={id} aria-label={groupName(id)}>
              <Text as="h3" size="L400" priority="300" className={css.GroupHeading}>
                {id === 'working' && <span className={css.LiveDot} aria-hidden />}
                {`${groupName(id)} · ${groupItems.length}`}
              </Text>
              {visible.map(row)}
              {visible.length < groupItems.length && (
                <Button
                  size="300"
                  variant="Secondary"
                  fill="None"
                  radii="300"
                  onClick={() => setRecentLimit(recentLimit + RECENT_PAGE)}
                >
                  <Text size="B300">{t('threadsPage.showMore')}</Text>
                </Button>
              )}
            </section>
          );
        })}
      </PageNavContent>
    </PageNav>
  );
}
