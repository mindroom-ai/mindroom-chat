import React, { ReactNode, useEffect, useMemo, useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { Box, Scroll, Text } from 'folds';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { makeRecentThreadsAtom } from '../../state/recentThreads';
import {
  RECENT_THREADS_PANEL_COLLAPSED_HEIGHT,
  RECENT_THREADS_PANEL_DEFAULT_HEIGHT,
  RECENT_THREADS_PANEL_MIN_HEIGHT,
  makeRecentThreadsPanelHeightAtom,
} from '../../state/recentThreadsPanelHeight';
import { RecentThreadEntry } from './RecentThreadEntry';
import { RecentThreadsResizer } from './RecentThreadsResizer';
import {
  buildVisibleRecentThreadEntries,
  type VisibleRecentThreadItem,
} from './recentThreadsPanelUtils';
import * as css from './recentThreads.css';

type RecentThreadsPanelProps = {
  entries: VisibleRecentThreadItem[];
  height: number;
};

const VIEWPORT_RESIZE_DEBOUNCE_MS = 100;

const getViewportHeight = (): number =>
  typeof window === 'undefined' ? 0 : window.innerHeight;

const getMaxPanelHeight = (viewportHeight: number): number =>
  Math.max(RECENT_THREADS_PANEL_MIN_HEIGHT, Math.round(viewportHeight * 0.6));

const resolvePanelHeight = (height: number, maxHeight: number): number => {
  if (height < RECENT_THREADS_PANEL_MIN_HEIGHT) {
    return RECENT_THREADS_PANEL_COLLAPSED_HEIGHT;
  }

  return Math.min(Math.max(height, RECENT_THREADS_PANEL_MIN_HEIGHT), maxHeight);
};

export function RecentThreadsPanel({ entries, height }: RecentThreadsPanelProps) {
  const collapsed = height <= RECENT_THREADS_PANEL_COLLAPSED_HEIGHT;
  const countLabel = entries.length === 0 ? undefined : `${entries.length}`;

  return (
    <div className={css.Panel} style={{ height: `${height}px` }}>
      <div className={css.PanelHeader}>
        <Text size="T200" priority="300">
          Recent Threads
        </Text>
        {countLabel && (
          <Text size="T200" priority="400">
            {countLabel}
          </Text>
        )}
      </div>
      {!collapsed && (
        <div className={css.PanelBody} aria-live="polite">
          {entries.length === 0 ? (
            <div className={css.EmptyState}>
              <Text size="T200" align="Center">
                No recent threads
              </Text>
            </div>
          ) : (
            <Scroll variant="Background" direction="Vertical" size="300" hideTrack visibility="Hover">
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
};

export function RecentThreadsPageNav({ children }: RecentThreadsPageNavProps) {
  const mx = useMatrixClient();
  const screenSize = useScreenSizeContext();
  const userId = mx.getUserId()!;

  const recentThreadsAtom = useMemo(() => makeRecentThreadsAtom(userId), [userId]);
  const recentThreadsPanelHeightAtom = useMemo(
    () => makeRecentThreadsPanelHeightAtom(userId),
    [userId]
  );

  const recentThreads = useAtomValue(recentThreadsAtom);
  const [storedPanelHeight, setStoredPanelHeight] = useAtom(recentThreadsPanelHeightAtom);
  const [viewportHeight, setViewportHeight] = useState(getViewportHeight);

  useEffect(() => {
    let timeoutId: number | undefined;

    const handleResize = () => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        setViewportHeight(getViewportHeight());
        timeoutId = undefined;
      }, VIEWPORT_RESIZE_DEBOUNCE_MS);
    };

    handleResize();
    window.addEventListener('resize', handleResize);

    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const maxPanelHeight = useMemo(() => getMaxPanelHeight(viewportHeight), [viewportHeight]);
  const resolvedStoredPanelHeight = useMemo(
    () => resolvePanelHeight(storedPanelHeight, maxPanelHeight),
    [maxPanelHeight, storedPanelHeight]
  );
  const [panelHeight, setPanelHeight] = useState(resolvedStoredPanelHeight);

  useEffect(() => {
    setPanelHeight(resolvedStoredPanelHeight);
  }, [resolvedStoredPanelHeight]);

  const visibleEntries = useMemo(
    () => buildVisibleRecentThreadEntries((roomId) => mx.getRoom(roomId), recentThreads),
    [mx, recentThreads]
  );

  if (screenSize === ScreenSize.Mobile) {
    return <div className={css.PageNavSection}>{children}</div>;
  }

  return (
    <div className={css.PageNavSection}>
      <Box grow="Yes" direction="Column" style={{ minHeight: 0 }}>
        {children}
      </Box>
      <RecentThreadsResizer
        panelHeight={panelHeight}
        minHeight={RECENT_THREADS_PANEL_MIN_HEIGHT}
        maxHeight={maxPanelHeight}
        collapsedHeight={RECENT_THREADS_PANEL_COLLAPSED_HEIGHT}
        onPreviewHeightChange={setPanelHeight}
        onCommitHeightChange={setStoredPanelHeight}
      />
      <RecentThreadsPanel
        entries={visibleEntries}
        height={panelHeight || RECENT_THREADS_PANEL_DEFAULT_HEIGHT}
      />
    </div>
  );
}
