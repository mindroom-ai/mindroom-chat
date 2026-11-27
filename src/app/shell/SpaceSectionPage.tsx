import {
  Activity,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { Outlet, useLocation, useMatch, type Location } from 'react-router-dom';
import { useInert } from '../lib/hooks/useInert';
import { useLatestRef } from '../lib/hooks/useLatestRef';
import { ScreenSize, useScreenSizeContext } from '../lib/hooks/useScreenSize';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useSpace } from '../matrix/hooks/useSpace';
import { getCanonicalAliasOrRoomId } from '../matrix/matrix';
import {
  canPlayLiveSlide,
  completeLiveSlideHandoff,
  isLiveSlideSyncExit,
  playLiveSlide,
  SWIPE_THREAD_STAGE,
  SWIPE_UNDER_THREAD,
  type LiveThreadBackUnder,
} from '../navigation/phonePageSlide';
import { historyPageOf, isSpaceThreadsPage } from '../routes/historyStack';
import { SPACE_ROOM_PATH, SPACE_THREADS_PATH } from '../routes/paths';
import { decodeRouteParam } from '../routes/pathUtils';
import { getRoomThreadExitTargetFromHistoryState } from '../routes/roomNavigateState';
import { SpacePageRoot } from '../sidebar/Navigation';
import { CollapsiblePageNav } from '../sidebar/ResizablePageNav';
import { Space } from '../sidebar/space/Space';
import {
  SpaceThreadsPassiveContext,
  SpaceUnderLayerContext,
  type SpaceUnderLayerContextValue,
} from '../spaces/spaceUnderLayerContext';
import { SpaceThreadsPage } from '../spaces/threads/SpaceThreadsPage';
import * as css from './SpaceSectionPage.css';

const isThisSpaceThreadsPath = (
  path: string | undefined,
  spaceAddresses: readonly string[]
): boolean => {
  if (!path) return false;
  const page = historyPageOf(path);
  if (!isSpaceThreadsPage(page)) return false;
  const [spaceSegment = ''] = page.pathname.split('/').filter(Boolean).map(decodeRouteParam);
  return spaceSegment.length > 0 && spaceAddresses.includes(spaceSegment);
};

const isThreadReturningToSpaceThreads = (
  location: Location,
  space: Room,
  mx: MatrixClient
): boolean => {
  if (!new URLSearchParams(location.search).get('threadId')) return false;
  const [routeSpaceSegment = ''] = location.pathname
    .split('/')
    .filter(Boolean)
    .map(decodeRouteParam);
  const spaceAddresses = [
    space.roomId,
    getCanonicalAliasOrRoomId(mx, space.roomId),
    ...(routeSpaceSegment ? [routeSpaceSegment] : []),
    ...(space.getAltAliases?.() ?? []),
  ];
  const browserHistoryState: unknown =
    typeof window !== 'undefined' ? (window as Partial<Window>).history?.state : undefined;
  const matchingBrowserState =
    browserHistoryState &&
    typeof browserHistoryState === 'object' &&
    (browserHistoryState as { key?: unknown }).key === location.key
      ? browserHistoryState
      : undefined;
  const exitTarget =
    getRoomThreadExitTargetFromHistoryState({ key: location.key, usr: location.state }) ??
    getRoomThreadExitTargetFromHistoryState(matchingBrowserState);
  return (
    exitTarget?.returnToOrigin === true &&
    isThisSpaceThreadsPath(exitTarget.exitPath, spaceAddresses)
  );
};

/**
 * A space with its navigation; it remembers the page open in that space.
 * On phones, parks `<SpaceThreadsPage />` in Layer 0 (`<Activity>`) only while viewing a thread
 * returning to this Space (`returnsToSpaceThreads`) to drive live 2-layer slides and edge swipes.
 * Keeps a single stable `<Outlet />` tree across phone/desktop rotation so staged thread drafts
 * are never unmounted on orientation change.
 */
export function SpaceSectionPage() {
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  const space = useSpace();
  const mx = useMatrixClient();
  const location = useLocation();
  const isOnSpaceThreads = useMatch(SPACE_THREADS_PATH) !== null;
  const isOnSpaceRoom = useMatch(SPACE_ROOM_PATH) !== null;
  const isThreadReturningToThisSpace = useMemo(
    () => isOnSpaceRoom && isThreadReturningToSpaceThreads(location, space, mx),
    [isOnSpaceRoom, location, mx, space]
  );

  // Never eagerly mount SpaceThreadsPage on a cold reload directly inside a thread.
  const [mountedSpaceId, setMountedSpaceId] = useState<string | null>(() =>
    phone && isOnSpaceThreads ? space.roomId : null
  );
  const [prevRoute, setPrevRoute] = useState({ spaceId: space.roomId, isOnSpaceThreads, phone });
  const [slidingForward, setSlidingForward] = useState(false);
  const [peekingThreads, setPeekingThreads] = useState(false);

  const routeChanged =
    prevRoute.spaceId !== space.roomId ||
    prevRoute.isOnSpaceThreads !== isOnSpaceThreads ||
    prevRoute.phone !== phone;
  if (routeChanged) {
    const wasOnThisSpaceThreads =
      prevRoute.phone && prevRoute.spaceId === space.roomId && prevRoute.isOnSpaceThreads;
    setPrevRoute({ spaceId: space.roomId, isOnSpaceThreads, phone });
    if (phone && isOnSpaceThreads) {
      setMountedSpaceId(space.roomId);
      setSlidingForward(false);
    } else if (phone && mountedSpaceId === space.roomId && isThreadReturningToThisSpace) {
      if (wasOnThisSpaceThreads && canPlayLiveSlide()) setSlidingForward(true);
    } else {
      setMountedSpaceId(null);
      setSlidingForward(false);
      setPeekingThreads(false);
    }
  } else if (
    phone &&
    !isOnSpaceThreads &&
    mountedSpaceId !== null &&
    (mountedSpaceId !== space.roomId || !isThreadReturningToThisSpace)
  ) {
    setMountedSpaceId(null);
    setSlidingForward(false);
    setPeekingThreads(false);
  }

  const stageRef = useRef<HTMLDivElement>(null);
  const underRef = useRef<HTMLDivElement>(null);
  const overRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const latestRef = useLatestRef({
    phone,
    mountedSpaceId,
    spaceId: space.roomId,
    isOnSpaceThreads,
    slidingForward,
  });

  const mountThreads = phone && mountedSpaceId === space.roomId;
  const threadsVisible = isOnSpaceThreads || slidingForward || peekingThreads;
  const hideOutlet = phone && isOnSpaceThreads;
  useInert(underRef, mountThreads && !isOnSpaceThreads);

  useLayoutEffect(() => {
    if (phone && isOnSpaceThreads) completeLiveSlideHandoff();
  }, [isOnSpaceThreads, phone]);

  useLayoutEffect(() => {
    if (!phone || !slidingForward) return undefined;
    const [stage, under, over] = [stageRef.current, underRef.current, overRef.current];
    if (!stage || !under || !over) {
      setSlidingForward(false);
      return undefined;
    }
    stage.setAttribute(SWIPE_THREAD_STAGE, '');
    under.setAttribute(SWIPE_UNDER_THREAD, '');
    const slide = playLiveSlide({
      direction: 'forward',
      stage,
      over,
      under,
      exit() {
        if (mountedRef.current) {
          const clear = () => setSlidingForward(false);
          if (isLiveSlideSyncExit()) flushSync(clear);
          else clear();
        }
        stage.removeAttribute(SWIPE_THREAD_STAGE);
        under.removeAttribute(SWIPE_UNDER_THREAD);
      },
    });
    return () => slide.skip(false);
  }, [phone, slidingForward]);

  const enterLiveSpaceThreadsPeek = useCallback((): LiveThreadBackUnder | null => {
    const {
      phone: isPhone,
      mountedSpaceId: warmId,
      spaceId,
      isOnSpaceThreads: onThreads,
    } = latestRef.current;
    const [stage, under, over] = [stageRef.current, underRef.current, overRef.current];
    if (!isPhone || warmId !== spaceId || onThreads || !stage || !under || !over) return null;

    stage.setAttribute(SWIPE_THREAD_STAGE, '');
    under.setAttribute(SWIPE_UNDER_THREAD, '');
    try {
      flushSync(() => setPeekingThreads(true));
    } catch (error) {
      stage.removeAttribute(SWIPE_THREAD_STAGE);
      under.removeAttribute(SWIPE_UNDER_THREAD);
      throw error;
    }

    return {
      stage,
      over,
      under,
      exit() {
        if (mountedRef.current) {
          const clear = () => setPeekingThreads(false);
          if (isLiveSlideSyncExit()) flushSync(clear);
          else clear();
        }
        stage.removeAttribute(SWIPE_THREAD_STAGE);
        under.removeAttribute(SWIPE_UNDER_THREAD);
      },
    };
  }, [latestRef]);

  const contextValue = useMemo<SpaceUnderLayerContextValue>(
    () => ({
      hasWarmSpaceThreads: () =>
        latestRef.current.phone && latestRef.current.mountedSpaceId === latestRef.current.spaceId,
      enterLiveSpaceThreadsPeek,
      isSpaceSlideOwningThread: () => latestRef.current.slidingForward,
    }),
    [enterLiveSpaceThreadsPeek, latestRef]
  );

  return (
    <SpacePageRoot
      nav={
        <CollapsiblePageNav>
          <Space />
        </CollapsiblePageNav>
      }
    >
      <SpaceUnderLayerContext.Provider value={phone ? contextValue : null}>
        <div
          ref={stageRef}
          className={phone ? css.Stage : css.PassThrough}
          data-space-section-stage={phone ? space.roomId : undefined}
        >
          {mountThreads && (
            <div
              ref={underRef}
              className={isOnSpaceThreads ? css.ActiveLayer : css.ParkedUnderLayer}
              aria-hidden={!isOnSpaceThreads || undefined}
              data-space-threads-layer=""
            >
              <SpaceThreadsPassiveContext.Provider value={peekingThreads && !isOnSpaceThreads}>
                <Activity mode={threadsVisible ? 'visible' : 'hidden'}>
                  <SpaceThreadsPage />
                </Activity>
              </SpaceThreadsPassiveContext.Provider>
            </div>
          )}
          {!hideOutlet && (
            <div
              ref={overRef}
              className={phone ? css.ActiveLayer : css.PassThrough}
              data-space-outlet-layer={phone ? '' : undefined}
            >
              <Outlet />
            </div>
          )}
        </div>
      </SpaceUnderLayerContext.Provider>
    </SpacePageRoot>
  );
}
