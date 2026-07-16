import React, { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Icon, IconButton, Icons, Text, Tooltip, TooltipProvider, toRem } from 'folds';
import { NavButton, NavItem, NavItemContent, NavItemOptions } from '../../components/nav';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { useRelativeTime } from '../../hooks/useRelativeTime';
import type { CrossRoomThreadIndexEntry } from '../cross-room-threads/crossRoomThreadIndex';
import { isMindroomAgentUserId } from '../matrix/agentIdentity';
import { buildCompactThreadCardViewModelFromRecord } from '../threads/compactThreadCardViewModel';
import { useRoomViewMode } from '../threads/useRoomViewMode';
import * as css from './threadNav.css';

type ThreadNavItemProps = {
  entry: CrossRoomThreadIndexEntry;
  onTogglePin: () => void;
  pinned: boolean;
  selected: boolean;
};

export const ThreadNavItem = memo(
  ({ entry, onTogglePin, pinned, selected }: ThreadNavItemProps) => {
    const { t } = useTranslation();
    const mx = useMatrixClient();
    const useAuthentication = useMediaAuthentication();
    const room = mx.getRoom(entry.roomId);
    const viewModel = useMemo(() => {
      if (!room) return undefined;

      return buildCompactThreadCardViewModelFromRecord({
        record: entry.threadRecord,
        room,
        currentUserId: mx.getUserId() ?? undefined,
        mx,
        useAuthentication,
      });
    }, [entry.threadRecord, mx, room, useAuthentication]);
    const relativeTime = useRelativeTime(entry.lastActivityTs);
    const { navigateRoom, navigateRoomThreadDirect } = useRoomNavigate();
    const { viewMode } = useRoomViewMode(entry.roomId);
    const agentNames = useMemo(() => {
      return Array.from(
        new Set(
          (viewModel?.participants ?? [])
            .filter((participant) => isMindroomAgentUserId(participant.userId))
            .map((participant) => participant.displayName)
        )
      );
    }, [viewModel?.participants]);
    const summaryText = viewModel?.displayTitleText ?? entry.summaryText;
    const ariaLabel = [
      t('thread.aria.openThread', { title: summaryText }),
      entry.roomName,
      relativeTime ? t('thread.aria.lastActivity', { time: relativeTime }) : undefined,
      pinned ? t('threadNav.pinned') : undefined,
    ]
      .filter(Boolean)
      .join('. ');

    if (!room || !viewModel) return null;

    return (
      <TooltipProvider
        position="Right"
        align="Center"
        delay={450}
        tooltip={
          <Tooltip className={css.EntryTooltip} style={{ maxWidth: toRem(300) }}>
            <Box direction="Column" gap="200">
              <Text size="H5">{summaryText}</Text>
              <div className={css.EntryTooltipDetails}>
                <Text size="T200" priority="400">
                  {t('threadNav.room')}
                </Text>
                <Text size="T200">{entry.roomName}</Text>
                <Text size="T200" priority="400">
                  {t('threadNav.agents')}
                </Text>
                <Text size="T200">
                  {agentNames.length > 0 ? agentNames.join(', ') : t('threadNav.agentsUnknown')}
                </Text>
                <Text size="T200" priority="400">
                  {t('threadNav.messages')}
                </Text>
                <Text size="T200">{viewModel.messageCountLabel}</Text>
                <Text size="T200" priority="400">
                  {t('threadNav.lastActivity')}
                </Text>
                <Text size="T200">
                  {relativeTime ?? viewModel.lastActivityTitle ?? t('threadNav.unknownActivity')}
                </Text>
              </div>
            </Box>
          </Tooltip>
        }
      >
        {(triggerRef) => (
          <div ref={triggerRef} data-sidebar-thread-root-id={entry.threadRootId}>
            <NavItem
              className={css.Entry}
              variant="Background"
              radii="400"
              highlight={entry.isUnread}
              aria-selected={selected}
            >
              <NavButton
                onClick={() => {
                  if (viewMode === 'classic') {
                    navigateRoom(room.roomId, viewModel.id.threadRootId);
                    return;
                  }
                  navigateRoomThreadDirect(room.roomId, viewModel.id.threadRootId);
                }}
                aria-label={ariaLabel}
              >
                <NavItemContent>
                  <Box as="span" grow="Yes" alignItems="Center" gap="200">
                    <Text
                      className={css.EntrySummary}
                      priority={entry.isUnread ? '500' : '300'}
                      as="span"
                      size="Inherit"
                      truncate
                    >
                      {summaryText}
                    </Text>
                    {entry.isUnread && <span className={css.EntryUnreadDot} aria-hidden="true" />}
                  </Box>
                </NavItemContent>
              </NavButton>
              <NavItemOptions className={css.EntryPinOptions}>
                <IconButton
                  className={pinned ? css.EntryPinButtonPinned : undefined}
                  type="button"
                  variant="Background"
                  fill="None"
                  size="300"
                  radii="300"
                  aria-label={pinned ? t('threadNav.unpin') : t('threadNav.pin')}
                  aria-pressed={pinned}
                  onClick={onTogglePin}
                >
                  <Icon src={Icons.Pin} size="50" filled={pinned} aria-hidden="true" />
                </IconButton>
              </NavItemOptions>
            </NavItem>
          </div>
        )}
      </TooltipProvider>
    );
  }
);

ThreadNavItem.displayName = 'ThreadNavItem';
