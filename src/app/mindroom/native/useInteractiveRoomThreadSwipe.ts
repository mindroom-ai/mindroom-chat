import { useAtomValue } from 'jotai';
import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import { imageViewerOpenAtom } from '../../state/imageViewer';
import { markInteractiveSwipeOwned } from './swipeGestureFlag';

const EDGE_START_MAX_X = 28;
const INTENT_DISTANCE_X = 8;
const MAX_VERTICAL_DRIFT = 64;
const COMMIT_PROGRESS = 0.5;
const COMMIT_VELOCITY_PX_PER_MS = 0.6;
const RELEASE_VELOCITY_MAX_AGE_MS = 80;
const SETTLE_DURATION_MS = 180;
const ACTIVE_X_VAR = '--mindroom-room-thread-swipe-active-x';
const PREVIEW_X_VAR = '--mindroom-room-thread-swipe-preview-x';

export type InteractiveRoomThreadSwipeDirection = 'left' | 'right';
export type InteractiveRoomThreadSwipePhase =
  | 'idle'
  | 'armed'
  | 'dragging'
  | 'settling'
  | 'canceling';

export type InteractiveRoomThreadSwipeTarget = {
  direction: InteractiveRoomThreadSwipeDirection;
  roomId?: string;
  threadId?: string;
  label?: string;
};

export type InteractiveRoomThreadSwipeSnapshot = {
  phase: InteractiveRoomThreadSwipePhase;
  target?: InteractiveRoomThreadSwipeTarget;
};

type InteractiveRoomThreadSwipeStore = {
  getSnapshot: () => InteractiveRoomThreadSwipeSnapshot;
  setSnapshot: (snapshot: InteractiveRoomThreadSwipeSnapshot) => void;
  subscribe: (listener: () => void) => () => void;
};

type SwipeRuntime = {
  cancelAnimationFrame: (handle: number) => void;
  clearTimeout: (handle: number) => void;
  matchMedia: (query: string) => Pick<MediaQueryList, 'matches'> | undefined;
  now: () => number;
  requestAnimationFrame: (callback: FrameRequestCallback) => number;
  setTimeout: (callback: () => void, delay: number) => number;
};

export type UseInteractiveRoomThreadSwipeOptions = {
  enabled: boolean;
  leftTarget?: Omit<InteractiveRoomThreadSwipeTarget, 'direction'>;
  onCommit: (target: InteractiveRoomThreadSwipeTarget) => void;
  onPreviewFreeze?: (target: InteractiveRoomThreadSwipeTarget) => void;
  rightTarget?: Omit<InteractiveRoomThreadSwipeTarget, 'direction'>;
  runtime?: Partial<SwipeRuntime>;
  shellRef: RefObject<HTMLElement>;
  isLeftEdgeBlocked?: () => boolean;
  isPortalOpen?: () => boolean;
};

type TrackingState = {
  direction: InteractiveRoomThreadSwipeDirection;
  startX: number;
  startY: number;
  startTime: number;
  target: InteractiveRoomThreadSwipeTarget;
  travel: number;
  lastTravel: number;
  lastTime: number;
  sampleTime: number;
  mode: 'armed' | 'dragging';
};

const createSwipeStore = (): InteractiveRoomThreadSwipeStore => {
  let snapshot: InteractiveRoomThreadSwipeSnapshot = { phase: 'idle' };
  const listeners = new Set<() => void>();

  return {
    getSnapshot: () => snapshot,
    setSnapshot: (nextSnapshot) => {
      if (snapshot.phase === nextSnapshot.phase && snapshot.target === nextSnapshot.target) return;
      snapshot = nextSnapshot;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};

export const getInteractiveSwipeEdge = (
  localX: number,
  width: number,
  isLeftEdgeBlocked = false
): InteractiveRoomThreadSwipeDirection | undefined => {
  if (localX < 0 || localX > width) return undefined;
  if (!isLeftEdgeBlocked && localX <= EDGE_START_MAX_X) return 'left';
  if (localX >= width - EDGE_START_MAX_X) return 'right';
  return undefined;
};

export const getInteractiveSwipeTravel = (
  direction: InteractiveRoomThreadSwipeDirection,
  startX: number,
  clientX: number
): number => (direction === 'left' ? clientX - startX : startX - clientX);

export const shouldIgnoreInteractiveSwipeTarget = (target: EventTarget | null): boolean => {
  if (typeof Element === 'undefined') return false;
  if (!(target instanceof Element)) return false;
  return !!target.closest(
    [
      '[data-room-thread-swipe-ignore="true"]',
      'a[href]',
      'button',
      'input',
      'textarea',
      'select',
      '[contenteditable="true"]',
      '[role="button"]',
    ].join(',')
  );
};

const createDefaultRuntime = (): SwipeRuntime => ({
  cancelAnimationFrame: (handle) => window.cancelAnimationFrame(handle),
  clearTimeout: (handle) => window.clearTimeout(handle),
  matchMedia: (query) => window.matchMedia?.(query),
  now: () => performance.now(),
  requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
  setTimeout: (callback, delay) => window.setTimeout(callback, delay),
});

const isReducedMotion = (runtime: SwipeRuntime): boolean =>
  runtime.matchMedia('(prefers-reduced-motion: reduce)')?.matches === true;

const getSettleDelay = (runtime: SwipeRuntime): number =>
  isReducedMotion(runtime) ? 0 : SETTLE_DURATION_MS;

const setSwipeVariables = (
  shell: HTMLElement,
  direction: InteractiveRoomThreadSwipeDirection,
  travel: number
) => {
  const width = Math.max(shell.clientWidth, 1);
  const clampedTravel = Math.max(0, Math.min(travel, width));
  const activeX = direction === 'left' ? clampedTravel : -clampedTravel;
  const previewX = direction === 'left' ? clampedTravel - width : width - clampedTravel;

  shell.style.setProperty(ACTIVE_X_VAR, `${activeX}px`);
  shell.style.setProperty(PREVIEW_X_VAR, `${previewX}px`);
};

const clearSwipeVariables = (shell: HTMLElement) => {
  shell.style.removeProperty(ACTIVE_X_VAR);
  shell.style.removeProperty(PREVIEW_X_VAR);
};

const getTouch = (evt: TouchEvent): Touch | undefined =>
  evt.touches[0] ?? evt.changedTouches[0] ?? undefined;

const getReleaseTouch = (evt: TouchEvent): Touch | undefined =>
  evt.changedTouches[0] ?? evt.touches[0] ?? undefined;

export const useInteractiveRoomThreadSwipe = ({
  enabled,
  leftTarget,
  onCommit,
  onPreviewFreeze,
  rightTarget,
  runtime: runtimeOverrides,
  shellRef,
  isLeftEdgeBlocked,
  isPortalOpen,
}: UseInteractiveRoomThreadSwipeOptions): InteractiveRoomThreadSwipeSnapshot => {
  const imageViewerOpen = useAtomValue(imageViewerOpenAtom);
  const storeRef = useRef<InteractiveRoomThreadSwipeStore>();
  if (!storeRef.current) {
    storeRef.current = createSwipeStore();
  }

  const runtime = useMemo(
    () => ({ ...createDefaultRuntime(), ...runtimeOverrides }),
    [runtimeOverrides]
  );
  const trackingRef = useRef<TrackingState | null>(null);
  const frameRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const pendingCommitRef = useRef<InteractiveRoomThreadSwipeTarget | null>(null);
  const pendingRenderRef = useRef<{
    direction: InteractiveRoomThreadSwipeDirection;
    travel: number;
  }>();
  const onCommitRef = useRef(onCommit);
  const onPreviewFreezeRef = useRef(onPreviewFreeze);
  const leftTargetRef = useRef(leftTarget);
  const rightTargetRef = useRef(rightTarget);
  const isLeftEdgeBlockedRef = useRef(isLeftEdgeBlocked);
  const isPortalOpenRef = useRef(isPortalOpen);

  useEffect(() => {
    onCommitRef.current = onCommit;
    onPreviewFreezeRef.current = onPreviewFreeze;
    leftTargetRef.current = leftTarget;
    rightTargetRef.current = rightTarget;
    isLeftEdgeBlockedRef.current = isLeftEdgeBlocked;
    isPortalOpenRef.current = isPortalOpen;
  }, [isLeftEdgeBlocked, isPortalOpen, leftTarget, onCommit, onPreviewFreeze, rightTarget]);

  const cleanupFrame = useCallback(() => {
    if (frameRef.current !== null) {
      runtime.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    pendingRenderRef.current = undefined;
  }, [runtime]);

  const cleanupTimer = useCallback(() => {
    if (timerRef.current !== null) {
      runtime.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, [runtime]);

  const flushPendingCommit = useCallback(() => {
    const target = pendingCommitRef.current;
    if (!target) return;
    pendingCommitRef.current = null;
    onCommitRef.current(target);
  }, []);

  const renderTravel = useCallback(
    (shell: HTMLElement, direction: InteractiveRoomThreadSwipeDirection, travel: number) => {
      pendingRenderRef.current = { direction, travel };
      if (frameRef.current !== null) return;

      frameRef.current = runtime.requestAnimationFrame(() => {
        frameRef.current = null;
        const pending = pendingRenderRef.current;
        pendingRenderRef.current = undefined;
        if (!pending) return;
        setSwipeVariables(shell, pending.direction, pending.travel);
      });
    },
    [runtime]
  );

  const finish = useCallback(
    (
      shell: HTMLElement,
      target: InteractiveRoomThreadSwipeTarget | undefined,
      commit: boolean,
      finalTravel?: number
    ) => {
      cleanupFrame();
      cleanupTimer();
      trackingRef.current = null;
      pendingCommitRef.current = commit && target ? target : null;
      if (target && finalTravel !== undefined) {
        frameRef.current = runtime.requestAnimationFrame(() => {
          frameRef.current = null;
          setSwipeVariables(shell, target.direction, finalTravel);
        });
      }
      const timerHandle = runtime.setTimeout(() => {
        if (timerRef.current === timerHandle) {
          timerRef.current = null;
        }
        cleanupFrame();
        clearSwipeVariables(shell);
        storeRef.current?.setSnapshot({ phase: 'idle' });
        if (commit) {
          flushPendingCommit();
        }
      }, getSettleDelay(runtime));
      timerRef.current = timerHandle;
    },
    [cleanupFrame, cleanupTimer, flushPendingCommit, runtime]
  );

  useEffect(() => {
    const shell = shellRef.current;
    if (!enabled || !shell || imageViewerOpen) {
      trackingRef.current = null;
      storeRef.current?.setSnapshot({ phase: 'idle' });
      return undefined;
    }

    const cancelGesture = (phase: 'idle' | 'canceling' = 'canceling') => {
      const tracking = trackingRef.current;
      const target = tracking?.target;
      trackingRef.current = null;
      cleanupFrame();
      if (phase === 'idle') {
        clearSwipeVariables(shell);
        storeRef.current?.setSnapshot({ phase: 'idle' });
        return;
      }
      if (tracking) {
        setSwipeVariables(shell, tracking.direction, tracking.travel);
      }
      storeRef.current?.setSnapshot({ phase, target });
      finish(shell, target, false, 0);
    };

    const handleTouchStart = (evt: TouchEvent) => {
      if (timerRef.current !== null) return;
      if (evt.touches.length !== 1) {
        cancelGesture('idle');
        return;
      }
      if (isPortalOpenRef.current?.() || shouldIgnoreInteractiveSwipeTarget(evt.target)) {
        trackingRef.current = null;
        storeRef.current?.setSnapshot({ phase: 'idle' });
        return;
      }

      const touch = evt.touches[0];
      const rect = shell.getBoundingClientRect();
      const shellWidth = Math.max(rect.width || shell.clientWidth, 1);
      const localX = touch.clientX - rect.left;
      const edge = getInteractiveSwipeEdge(
        localX,
        shellWidth,
        isLeftEdgeBlockedRef.current?.() === true
      );
      if (!edge) {
        trackingRef.current = null;
        storeRef.current?.setSnapshot({ phase: 'idle' });
        return;
      }

      const targetBase = edge === 'left' ? leftTargetRef.current : rightTargetRef.current;
      if (!targetBase) {
        trackingRef.current = null;
        storeRef.current?.setSnapshot({ phase: 'idle' });
        return;
      }

      const target = { ...targetBase, direction: edge };
      const now = runtime.now();
      trackingRef.current = {
        direction: edge,
        startX: touch.clientX,
        startY: touch.clientY,
        startTime: now,
        target,
        travel: 0,
        lastTravel: 0,
        lastTime: now,
        sampleTime: now,
        mode: 'armed',
      };
      storeRef.current?.setSnapshot({ phase: 'armed', target });
      onPreviewFreezeRef.current?.(target);
    };

    const handleTouchMove = (evt: TouchEvent) => {
      const tracking = trackingRef.current;
      if (!tracking) return;
      if (evt.touches.length !== 1) {
        cancelGesture();
        return;
      }

      const touch = getTouch(evt);
      if (!touch) {
        cancelGesture();
        return;
      }

      const deltaY = touch.clientY - tracking.startY;
      const absDeltaY = Math.abs(deltaY);
      const travel = getInteractiveSwipeTravel(tracking.direction, tracking.startX, touch.clientX);
      const absDeltaX = Math.abs(touch.clientX - tracking.startX);

      if (absDeltaY > MAX_VERTICAL_DRIFT && absDeltaY > absDeltaX) {
        cancelGesture();
        return;
      }

      if (tracking.mode === 'armed') {
        if (
          travel < -INTENT_DISTANCE_X ||
          (absDeltaY > INTENT_DISTANCE_X && absDeltaY > absDeltaX)
        ) {
          cancelGesture('idle');
          return;
        }
        if (travel < INTENT_DISTANCE_X || absDeltaY > MAX_VERTICAL_DRIFT) return;

        tracking.mode = 'dragging';
        markInteractiveSwipeOwned(evt);
        evt.preventDefault();
        storeRef.current?.setSnapshot({ phase: 'dragging', target: tracking.target });
      } else {
        markInteractiveSwipeOwned(evt);
        evt.preventDefault();
      }

      const now = runtime.now();
      tracking.lastTravel = tracking.travel;
      tracking.lastTime = tracking.sampleTime;
      tracking.travel = Math.max(0, travel);
      tracking.sampleTime = now;
      renderTravel(shell, tracking.direction, tracking.travel);
    };

    const handleTouchEnd = (evt: TouchEvent) => {
      const tracking = trackingRef.current;
      if (!tracking) return;

      if (tracking.mode !== 'dragging') {
        cancelGesture('idle');
        return;
      }

      const releaseTime = runtime.now();
      const releaseTouch = getReleaseTouch(evt);
      if (releaseTouch) {
        const releaseTravel = getInteractiveSwipeTravel(
          tracking.direction,
          tracking.startX,
          releaseTouch.clientX
        );
        tracking.lastTravel = tracking.travel;
        tracking.lastTime = tracking.sampleTime;
        tracking.travel = Math.max(0, releaseTravel);
        tracking.sampleTime = releaseTime;
      }

      const width = Math.max(shell.clientWidth, 1);
      const progress = tracking.travel / width;
      const sampleAge = releaseTime - tracking.sampleTime;
      const elapsed = Math.max(tracking.sampleTime - tracking.lastTime, 1);
      const velocity =
        sampleAge <= RELEASE_VELOCITY_MAX_AGE_MS
          ? Math.max(0, (tracking.travel - tracking.lastTravel) / elapsed)
          : 0;
      const commit = progress >= COMMIT_PROGRESS || velocity >= COMMIT_VELOCITY_PX_PER_MS;

      cleanupFrame();
      setSwipeVariables(shell, tracking.direction, tracking.travel);
      storeRef.current?.setSnapshot({
        phase: commit ? 'settling' : 'canceling',
        target: tracking.target,
      });
      finish(shell, tracking.target, commit, commit ? width : 0);
    };

    const handleTouchCancel = () => {
      if (!trackingRef.current) return;
      cancelGesture();
    };

    shell.addEventListener('touchstart', handleTouchStart, { passive: true });
    shell.addEventListener('touchmove', handleTouchMove, { passive: false });
    shell.addEventListener('touchend', handleTouchEnd, { passive: true });
    shell.addEventListener('touchcancel', handleTouchCancel, { passive: true });

    return () => {
      shell.removeEventListener('touchstart', handleTouchStart);
      shell.removeEventListener('touchmove', handleTouchMove);
      shell.removeEventListener('touchend', handleTouchEnd);
      shell.removeEventListener('touchcancel', handleTouchCancel);
      cleanupFrame();
      flushPendingCommit();
      cleanupTimer();
      clearSwipeVariables(shell);
      trackingRef.current = null;
      storeRef.current?.setSnapshot({ phase: 'idle' });
    };
  }, [
    cleanupFrame,
    cleanupTimer,
    enabled,
    finish,
    flushPendingCommit,
    imageViewerOpen,
    renderTravel,
    runtime,
    shellRef,
  ]);

  return useSyncExternalStore(
    storeRef.current.subscribe,
    storeRef.current.getSnapshot,
    storeRef.current.getSnapshot
  );
};
