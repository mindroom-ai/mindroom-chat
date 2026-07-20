import React, { ReactNode, useEffect, useMemo, useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { Box, Scroll, Text } from 'folds';
import { PageNav } from '../../components/page';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useScreenSizeContext } from '../../hooks/useScreenSize';
import { allRoomsAtom } from '../../state/room-list/roomList';
import { makeRecentThreadsAtom } from './recentThreads';
import {
  RECENT_THREADS_PANEL_COLLAPSED_HEIGHT,
  RECENT_THREADS_PANEL_MIN_HEIGHT,
  makeRecentThreadsPanelHeightAtom,
} from './recentThreadsPanelHeight';
import { makeRecentThreadsPanelMobileExpandedAtom } from './recentThreadsPanelMobileExpanded';
import { RecentThreadEntry } from './RecentThreadEntry';
import { RecentThreadsDivider } from './RecentThreadsDivider';
import {
  buildVisibleRecentThreadEntries,
  type VisibleRecentThreadItem,
} from './recentThreadsPanelUtils';
import { useDebouncedViewportHeight } from './useDebouncedViewportHeight';
import { useResolvedRecentThreadsLayout } from './useResolvedRecentThreadsLayout';
import * as css from './recentThreads.css';

type RecentThreadsPanelProps = {
  collapsed?: boolean;
  entries: VisibleRecentThreadItem[];
  height: number;
  showHeader?: boolean;
};

export function RecentThreadsPanel({
  entries,
  height,
  collapsed,
  showHeader = true,
}: RecentThreadsPanelProps) {
  const { t } = useTranslation();
  const isCollapsed = collapsed ?? height <= RECENT_THREADS_PANEL_COLLAPSED_HEIGHT;
  const countLabel = entries.length === 0 ? undefined : `${entries.length}`;
  const headerContent = (
    <>
      <Text as="h2" size="T200" priority="300">
        {t('recentThreads.title')}
      </Text>
      <Box as="span" alignItems="Center" gap="100">
        {countLabel && (
          <Text as="span" size="T200" priority="400">
            {countLabel}
          </Text>
        )}
      </Box>
    </>
  );

  if (!showHeader && isCollapsed) {
    return null;
  }

  return (
    <div className={css.Panel} data-testid="recent-threads-panel" style={{ height: `${height}px` }}>
      {showHeader && <div className={css.PanelHeader}>{headerContent}</div>}
      {!isCollapsed && (
        <div className={css.PanelBody} aria-live="polite">
          {entries.length === 0 ? (
            <div className={css.EmptyState}>
              <Text size="T200" align="Center">
                {t('recentThreads.empty')}
              </Text>
            </div>
          ) : (
            <Scroll
              variant="Background"
              direction="Vertical"
              size="300"
              hideTrack
              visibility="Hover"
            >
              <div className={css.PanelList}>
                {entries.map((entry) => (
                  <RecentThreadEntry
                    key={`${entry.roomId}|${entry.threadId}`}
                    room={entry.room}
                    threadId={entry.threadId}
                    openedAt={entry.openedAt}
                    summaryText={entry.summaryText}
                  />
                ))}
              </div>
            </Scroll>
          )}
        </div>
      )}
    </div>
  );
}

type RecentThreadsPageNavProps = {
  children: ReactNode;
  header: ReactNode;
};

export function RecentThreadsPageNav({ children, header }: RecentThreadsPageNavProps) {
  const mx = useMatrixClient();
  const screenSize = useScreenSizeContext();
  const userId = mx.getUserId()!;

  const recentThreadsAtom = useMemo(() => makeRecentThreadsAtom(userId), [userId]);
  const recentThreadsPanelHeightAtom = useMemo(
    () => makeRecentThreadsPanelHeightAtom(userId),
    [userId]
  );
  const recentThreadsPanelMobileExpandedAtom = useMemo(
    () => makeRecentThreadsPanelMobileExpandedAtom(userId),
    [userId]
  );

  const recentThreads = useAtomValue(recentThreadsAtom);
  const allRoomIds = useAtomValue(allRoomsAtom);
  const [storedPanelHeight, setStoredPanelHeight] = useAtom(recentThreadsPanelHeightAtom);
  const [mobileExpanded, setMobileExpanded] = useAtom(recentThreadsPanelMobileExpandedAtom);
  const viewportHeight = useDebouncedViewportHeight();
  const resolvedLayout = useResolvedRecentThreadsLayout({
    screenSize,
    viewportHeight,
    storedDesktopHeight: storedPanelHeight,
    mobileExpanded,
    onToggleMobileExpanded: setMobileExpanded,
  });
  const [panelHeight, setPanelHeight] = useState(resolvedLayout.height);

  useEffect(() => {
    setPanelHeight(resolvedLayout.height);
  }, [resolvedLayout.height]);

  const maxPanelHeight = resolvedLayout.maxHeight;

  const visibleEntries = useMemo(() => {
    // allRoomsAtom changes when joined-room membership changes; mx.getRoom alone is not reactive.
    void allRoomIds;
    return buildVisibleRecentThreadEntries((roomId) => mx.getRoom(roomId), recentThreads);
  }, [allRoomIds, mx, recentThreads]);

  return (
    <PageNav>
      {header}
      <div className={css.PageNavSection}>
        <Box grow="Yes" direction="Column" style={{ minHeight: 0 }}>
          {children}
        </Box>
        {resolvedLayout.dividerMode === 'toggle' ? (
          <RecentThreadsDivider
            mode="toggle"
            entryCount={visibleEntries.length}
            isExpanded={resolvedLayout.isExpanded}
            onToggle={resolvedLayout.onTogglePanel}
          />
        ) : (
          <RecentThreadsDivider
            mode="resize"
            panelHeight={panelHeight}
            minHeight={RECENT_THREADS_PANEL_MIN_HEIGHT}
            maxHeight={maxPanelHeight}
            collapsedHeight={RECENT_THREADS_PANEL_COLLAPSED_HEIGHT}
            onPreviewHeightChange={setPanelHeight}
            onCommitHeightChange={setStoredPanelHeight}
          />
        )}
        <RecentThreadsPanel
          entries={visibleEntries}
          height={panelHeight}
          collapsed={resolvedLayout.isCollapsed}
          showHeader={resolvedLayout.dividerMode === 'resize'}
        />
      </div>
    </PageNav>
  );
}
