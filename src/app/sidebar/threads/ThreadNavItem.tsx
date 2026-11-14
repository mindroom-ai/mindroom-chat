import classNames from 'classnames';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { Room } from 'matrix-js-sdk';
import { Box, Icon, IconButton, Icons, Text, Tooltip } from 'folds';
import { TooltipProvider, ownDirectionLine, revealDirectionControls } from '../../ui/directional';
import { NavButton, NavItem, NavItemContent } from '../../ui/nav/NavItem';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useSyncEngine } from '../../event-store/engine/engineContext';
import { requestCachedThreadRoot, saveThreadRoot } from '../../event-store/sdk/cachedThreadRoots';
import { useMediaAuthentication } from '../../matrix/hooks/useMediaAuthentication';
import { useRelativeTime } from '../../i18n/useRelativeTime';
import { useRoomNavigate } from '../../navigation/useRoomNavigate';
import { usePinnedEventIds as useRoomPinnedEvents } from '../../event-store/threads/useThreadPinning';
import type { CrossRoomThreadIndexEntry } from '../../threads/cross-room/crossRoomThreadIndex';
import { buildCompactThreadCardViewModelFromRecord } from '../../threads/overview/compactThreadCardViewModel';
import { useInitializeShownThread } from '../../threads/useInitializeShownThread';
import { ThreadStreamingDot } from '../../threads/ThreadStreamingDot';
import { useRoomViewMode } from '../../navigation/useRoomViewMode';
import { useToggleThreadResolution } from '../../threads/tags/useRoomThreadTags';
import * as css from './threadNav.css';
import './threadNavReveal.css';
import { rowControlsShift } from '../../ui/nav/NavItem.css';

type ThreadNavItemProps = {
  entry: CrossRoomThreadIndexEntry;
  /** Pinned to the top of this user's sidebar list (not a room pin). */
  pinned: boolean;
  onTogglePin: () => void;
  selected: boolean;
};

/**
 * One thread in the sidebar's THREADS list: its title, an unread dot, and on hover the room,
 * agents, size and age of the thread, with actions to pin it in the sidebar and resolve it.
 */
export const ThreadNavItem = memo(
  ({ entry, pinned, onTogglePin, selected }: ThreadNavItemProps) => {
    const { t, i18n } = useTranslation();
    const mx = useMatrixClient();
    const useAuthentication = useMediaAuthentication();
    const room = mx.getRoom(entry.roomId);
    const { navigateRoom, navigateRoomThreadDirect } = useRoomNavigate();
    const { viewMode } = useRoomViewMode(entry.roomId);
    const relativeTime = useRelativeTime(entry.lastActivityTs);
    const shownRef = useInitializeShownThread(entry.roomId, entry.threadRootId);
    const [pinHovered, setPinHovered] = useState(false);
    const engine = useSyncEngine();

    // The row's title is its root's text. A root the SDK has is saved for offline starts; a thread
    // known only from its replies (an offline start) takes its root from the event cache.
    const rootEvent =
      room?.getThread(entry.threadRootId)?.rootEvent ?? room?.findEventById(entry.threadRootId);
    useEffect(() => {
      if (!room) return;
      if (rootEvent) saveThreadRoot(engine.persist, room, entry.threadRootId, rootEvent);
      else requestCachedThreadRoot(mx, engine.sessionId, room, entry.threadRootId);
    }, [engine, entry.threadRootId, mx, room, rootEvent]);

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
    return (
      <ThreadNavItemRow
        entry={entry}
        room={room}
        title={viewModel?.displayTitleText ?? entry.summaryText}
        streaming={viewModel?.attentionState === 'streaming'}
        agentNames={
          viewModel?.participants
            .filter((participant) => participant.userId !== mx.getUserId())
            .map((participant) => participant.displayName) ?? []
        }
        messageCountLabel={viewModel?.messageCountLabel}
        activityTitle={viewModel?.lastActivityTitle}
        relativeTime={relativeTime}
        shownRef={shownRef}
        pinned={pinned}
        pinHovered={pinHovered}
        setPinHovered={setPinHovered}
        onTogglePin={onTogglePin}
        selected={selected}
        onOpen={() => {
          if (viewMode === 'classic') {
            navigateRoom(entry.roomId, entry.threadRootId);
            return;
          }
          navigateRoomThreadDirect(entry.roomId, entry.threadRootId);
        }}
        t={t}
      />
    );
  }
);

ThreadNavItem.displayName = 'ThreadNavItem';

const rowWeightStyle = { fontWeight: 'inherit' } as const;

type RowProps = {
  entry: CrossRoomThreadIndexEntry;
  room: Room;
  title: string;
  /** An agent streams a reply in the thread, which its Compact card shows too. */
  streaming: boolean;
  agentNames: string[];
  messageCountLabel?: string;
  activityTitle?: string;
  relativeTime?: string;
  shownRef: ReturnType<typeof useInitializeShownThread>;
  pinned: boolean;
  pinHovered: boolean;
  setPinHovered: (hovered: boolean) => void;
  onTogglePin: () => void;
  selected: boolean;
  onOpen: () => void;
  t: TFunction;
};

function ThreadNavItemRow({
  entry,
  room,
  title,
  streaming,
  agentNames,
  messageCountLabel,
  activityTitle,
  relativeTime,
  shownRef,
  pinned,
  pinHovered,
  setPinHovered,
  onTogglePin,
  selected,
  onOpen,
  t,
}: RowProps) {
  const roomPinnedIds = useRoomPinnedEvents(room);
  const { canToggle, setResolved, updating } = useToggleThreadResolution(room);
  // A thread pinned in the room is kept there on purpose, so the sidebar offers no Resolve for it.
  const roomPinned = roomPinnedIds.includes(entry.threadRootId);
  const pinLabel = pinned ? t('threadNav.unpin') : t('threadNav.pin');

  const details = (
    <Box direction="Column" gap="200">
      <Text size="T300">{title}</Text>
      <div className={css.EntryTooltipDetails}>
        <Text as="span" size="T200" priority="300">
          {t('threadNav.room')}
        </Text>
        <Text as="span" size="T200">
          {revealDirectionControls(entry.roomName)}
        </Text>
        {agentNames.length > 0 && (
          <>
            <Text as="span" size="T200" priority="300">
              {t('threadNav.agents')}
            </Text>
            <Text as="span" size="T200">
              {agentNames.join(', ')}
            </Text>
          </>
        )}
        {messageCountLabel && (
          <>
            <Text as="span" size="T200" priority="300">
              {t('threadNav.messages')}
            </Text>
            <Text as="span" size="T200">
              {messageCountLabel}
            </Text>
          </>
        )}
        {relativeTime && (
          <>
            <Text as="span" size="T200" priority="300">
              {t('threadNav.lastActivity')}
            </Text>
            <Text as="span" size="T200" title={activityTitle}>
              {relativeTime}
            </Text>
          </>
        )}
      </div>
    </Box>
  );

  return (
    <TooltipProvider
      position="Right"
      align="Start"
      offset={8}
      delay={0}
      tooltip={<Tooltip className={css.EntryTooltip}>{details}</Tooltip>}
    >
      {(triggerRef) => (
        <NavItem
          ref={triggerRef}
          className={css.Entry}
          variant="Background"
          radii="400"
          highlight={entry.isUnread}
          aria-selected={selected}
        >
          <NavButton
            type="button"
            onClick={onOpen}
            aria-label={[
              t('thread.aria.openThread', { title }),
              streaming && t('thread.aria.agentStreaming'),
              revealDirectionControls(entry.roomName),
              relativeTime && `${t('threadNav.lastActivity')} ${relativeTime}`,
            ]
              .filter(Boolean)
              .join('. ')}
          >
            <NavItemContent as="span">
              <Box as="span" alignItems="Center" gap="200" style={{ minWidth: 0 }}>
                <Text
                  as="span"
                  size="T300"
                  priority={entry.isUnread ? '500' : '300'}
                  truncate
                  {...ownDirectionLine}
                  className={css.EntrySummary}
                  // The text size sets its own weight; the title takes the row's instead (medium, bold
                  // when unread), like a room's name.
                  style={rowWeightStyle}
                  ref={shownRef}
                >
                  {title}
                </Text>
                {streaming && <ThreadStreamingDot aria-hidden="true" />}
                {entry.isUnread && <span className={css.EntryUnreadDot} aria-hidden="true" />}
              </Box>
            </NavItemContent>
          </NavButton>
          <Box
            as="span"
            alignItems="Center"
            gap="100"
            className={classNames(css.EntryActions, rowControlsShift)}
          >
            <IconButton
              size="300"
              radii="300"
              variant="Background"
              className={pinned ? css.EntryPinButtonPinned : undefined}
              aria-label={pinLabel}
              aria-pressed={pinned}
              onMouseEnter={() => setPinHovered(true)}
              onMouseLeave={() => setPinHovered(false)}
              onClick={onTogglePin}
            >
              <Icon size="100" src={Icons.Pin} filled={pinned || pinHovered} />
            </IconButton>
            {canToggle && !roomPinned && (
              <IconButton
                size="300"
                radii="300"
                variant="Background"
                aria-label={t('thread.resolve')}
                disabled={updating}
                onClick={() => void setResolved(entry.threadRootId, true)}
              >
                <Icon size="100" src={Icons.CheckTwice} />
              </IconButton>
            )}
          </Box>
        </NavItem>
      )}
    </TooltipProvider>
  );
}
