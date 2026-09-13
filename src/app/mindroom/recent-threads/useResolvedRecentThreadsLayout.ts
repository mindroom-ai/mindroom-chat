import { useCallback, useMemo } from 'react';
import { ScreenSize } from '../../hooks/useScreenSize';
import {
  RECENT_THREADS_PANEL_COLLAPSED_HEIGHT,
  RECENT_THREADS_PANEL_MIN_HEIGHT,
} from './recentThreadsPanelHeight';

export type RecentThreadsDividerMode = 'resize' | 'toggle';

export type ResolvedRecentThreadsLayout = {
  dividerMode: RecentThreadsDividerMode;
  height: number;
  isCollapsed: boolean;
  isExpanded: boolean;
  maxHeight: number;
  onTogglePanel: () => void;
};

type ResolvedRecentThreadsLayoutState = Omit<ResolvedRecentThreadsLayout, 'onTogglePanel'>;

type ResolveRecentThreadsLayoutOptions = {
  mobileExpanded: boolean;
  onToggleMobileExpanded?: (expanded: boolean) => void;
  screenSize: ScreenSize;
  storedDesktopHeight: number;
  viewportHeight: number;
};

const RECENT_THREADS_PANEL_MOBILE_MAX_HEIGHT = 240;
const RECENT_THREADS_PANEL_MOBILE_COLLAPSED_HEIGHT = 0;
const RECENT_THREADS_PANEL_MOBILE_VIEWPORT_RATIO = 0.45;
const RECENT_THREADS_PANEL_DESKTOP_VIEWPORT_RATIO = 0.6;

export const getMaxRecentThreadsPanelHeight = (viewportHeight: number): number =>
  Math.max(
    RECENT_THREADS_PANEL_MIN_HEIGHT,
    Math.round(viewportHeight * RECENT_THREADS_PANEL_DESKTOP_VIEWPORT_RATIO)
  );

export const getExpandedMobileRecentThreadsPanelHeight = (viewportHeight: number): number =>
  Math.max(
    RECENT_THREADS_PANEL_MIN_HEIGHT,
    Math.min(
      RECENT_THREADS_PANEL_MOBILE_MAX_HEIGHT,
      Math.round(viewportHeight * RECENT_THREADS_PANEL_MOBILE_VIEWPORT_RATIO)
    )
  );

export const getCollapsedMobileRecentThreadsPanelHeight = (): number =>
  RECENT_THREADS_PANEL_MOBILE_COLLAPSED_HEIGHT;

export const resolveDesktopRecentThreadsPanelHeight = (
  height: number,
  maxHeight: number
): number => {
  if (height < RECENT_THREADS_PANEL_MIN_HEIGHT) {
    return RECENT_THREADS_PANEL_COLLAPSED_HEIGHT;
  }

  return Math.min(Math.max(height, RECENT_THREADS_PANEL_MIN_HEIGHT), maxHeight);
};

export const resolveRecentThreadsLayout = ({
  screenSize,
  viewportHeight,
  storedDesktopHeight,
  mobileExpanded,
}: ResolveRecentThreadsLayoutOptions): ResolvedRecentThreadsLayoutState => {
  const maxHeight = getMaxRecentThreadsPanelHeight(viewportHeight);

  if (screenSize === ScreenSize.Mobile) {
    const height = mobileExpanded
      ? getExpandedMobileRecentThreadsPanelHeight(viewportHeight)
      : getCollapsedMobileRecentThreadsPanelHeight();

    return {
      dividerMode: 'toggle',
      height,
      isCollapsed: !mobileExpanded,
      isExpanded: mobileExpanded,
      maxHeight,
    };
  }

  const height = resolveDesktopRecentThreadsPanelHeight(storedDesktopHeight, maxHeight);

  return {
    dividerMode: 'resize',
    height,
    isCollapsed: height <= RECENT_THREADS_PANEL_COLLAPSED_HEIGHT,
    isExpanded: height > RECENT_THREADS_PANEL_COLLAPSED_HEIGHT,
    maxHeight,
  };
};

export const useResolvedRecentThreadsLayout = (
  options: ResolveRecentThreadsLayoutOptions
): ResolvedRecentThreadsLayout => {
  const {
    mobileExpanded,
    onToggleMobileExpanded,
    screenSize,
    storedDesktopHeight,
    viewportHeight,
  } = options;

  const layout = useMemo(
    () =>
      resolveRecentThreadsLayout({
        mobileExpanded,
        screenSize,
        storedDesktopHeight,
        viewportHeight,
      }),
    [mobileExpanded, screenSize, storedDesktopHeight, viewportHeight]
  );

  const onTogglePanel = useCallback(() => {
    if (screenSize !== ScreenSize.Mobile || !onToggleMobileExpanded) return;
    onToggleMobileExpanded(!mobileExpanded);
  }, [mobileExpanded, onToggleMobileExpanded, screenSize]);

  return {
    ...layout,
    onTogglePanel,
  };
};
