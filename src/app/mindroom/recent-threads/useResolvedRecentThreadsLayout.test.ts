import { describe, expect, it } from 'vitest';
import { ScreenSize } from '../../hooks/useScreenSize';
import { RECENT_THREADS_PANEL_COLLAPSED_HEIGHT } from '../../state/recentThreadsPanelHeight';
import { resolveRecentThreadsLayout } from './useResolvedRecentThreadsLayout';

const screenSizes = [ScreenSize.Desktop, ScreenSize.Tablet, ScreenSize.Mobile] as const;
const viewportHeights = [360, 480, 768, 1080] as const;
const storedHeights = [0, 32, 80, 200, 600] as const;
const mobileExpandedStates = [false, true] as const;

const getExpectedDesktopHeight = (storedHeight: number, viewportHeight: number): number => {
  const maxHeight = Math.max(80, Math.round(viewportHeight * 0.6));

  if (storedHeight < 80) {
    return RECENT_THREADS_PANEL_COLLAPSED_HEIGHT;
  }

  return Math.min(Math.max(storedHeight, 80), maxHeight);
};

const getExpectedMobileHeight = (viewportHeight: number, mobileExpanded: boolean): number => {
  if (!mobileExpanded) {
    return 0;
  }

  return Math.max(80, Math.min(240, Math.round(viewportHeight * 0.45)));
};

describe('resolveRecentThreadsLayout', () => {
  it.each(
    screenSizes.flatMap((screenSize) =>
      viewportHeights.flatMap((viewportHeight) =>
        storedHeights.flatMap((storedDesktopHeight) =>
          mobileExpandedStates.map((mobileExpanded) => ({
            screenSize,
            viewportHeight,
            storedDesktopHeight,
            mobileExpanded,
          }))
        )
      )
    )
  )(
    'resolves $screenSize layout for viewport=$viewportHeight storedHeight=$storedDesktopHeight mobileExpanded=$mobileExpanded',
    ({ screenSize, viewportHeight, storedDesktopHeight, mobileExpanded }) => {
      const resolved = resolveRecentThreadsLayout({
        screenSize,
        viewportHeight,
        storedDesktopHeight,
        mobileExpanded,
      });

      const expectedHeight =
        screenSize === ScreenSize.Mobile
          ? getExpectedMobileHeight(viewportHeight, mobileExpanded)
          : getExpectedDesktopHeight(storedDesktopHeight, viewportHeight);

      expect(resolved.height).toBe(expectedHeight);
      expect(resolved.dividerMode).toBe(
        screenSize === ScreenSize.Mobile ? 'toggle' : 'resize'
      );
      expect(resolved.isCollapsed).toBe(expectedHeight <= RECENT_THREADS_PANEL_COLLAPSED_HEIGHT);
      expect(resolved.isExpanded).toBe(expectedHeight > RECENT_THREADS_PANEL_COLLAPSED_HEIGHT);
      expect(resolved.maxHeight).toBe(Math.max(80, Math.round(viewportHeight * 0.6)));
    }
  );
});
