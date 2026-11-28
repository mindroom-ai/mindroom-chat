import { isDeepTraceRecording, recordDeepTraceEvent } from '../diagnostics/deepTrace';
import { hasBlockingPortalOverlay } from '../lib/portalOverlay';
import {
  animateSwipeElements,
  type InteractiveSwipeScene,
  isReducedMotion,
  resolveLogicalDirectionSign,
  setInteractivePhoneSlideClaimed,
} from './interactiveSwipe';
import './phonePageSlide.css';

/** Marks the phone layout container (`ClientLayout`). */
export const PHONE_STAGE = 'data-phone-stage';
/** Marks the active phone page container below `PhoneTopBar`. */
export const PHONE_PAGE = 'data-phone-page';
/** Marks a clipped live 2-layer navigation stage (`RoomView` or `SpaceSectionPage`). */
export const SWIPE_THREAD_STAGE = 'data-swipe-thread-stage';
/** Marks the live inert under-layer revealed behind a sliding upper surface. */
export const SWIPE_UNDER_THREAD = 'data-swipe-under-thread';
/** Marks the live upper layer sliding over the revealed under-layer. */
export const SWIPE_OVER_THREAD = 'data-swipe-over-thread';

const SWIPE_STAGE = 'data-swipe-stage';
const SWIPE_BACKDROP = 'data-swipe-backdrop';
const SWIPE_DIM = 'data-swipe-dim';
const SWIPE_HOLD_SHIELD = 'data-swipe-hold-shield';
const LIVE_SLIDE_DURATION_MS = 280;
const DIM_MAX_OPACITY = 0.12;
const FRAME_WAIT_MS = 100;
const HANDOFF_TIMEOUT_MS = 1000;
const UA_TRANSITION_TTL_MS = 50;

/** Handle to two live DOM layers sharing a clipped stage during a phone slide or swipe. */
export type LiveThreadBackUnder = {
  stage: HTMLElement;
  over: HTMLElement;
  under: HTMLElement;
  exit: (committed: boolean) => void;
};

export type LiveSlideOptions = LiveThreadBackUnder & {
  direction: 'forward' | 'back';
  onCommit?: () => void;
};

export type LiveSlideHandle = { finished: Promise<void>; skip: (sync?: boolean) => void };

let activeSlide: { direction: 'forward' | 'back'; skip: (sync?: boolean) => void } | undefined;
let activeHandoff: { complete: (committed: boolean, sync?: boolean) => void } | undefined;
let activeHistoryBackSlide: (() => boolean) | undefined;
let liveSlideSyncExit = true;

const invokeExit = (exit: (committed: boolean) => void, committed: boolean, sync: boolean) => {
  const prev = liveSlideSyncExit;
  liveSlideSyncExit = sync;
  try {
    exit(committed);
  } finally {
    liveSlideSyncExit = prev;
  }
};
let uaVisualTransition = false;
let uaTransitionTimer: number | undefined;
let popstateInstalled = false;

const clearUATransition = () => {
  uaVisualTransition = false;
  if (uaTransitionTimer !== undefined && typeof window !== 'undefined') {
    window.clearTimeout(uaTransitionTimer);
    uaTransitionTimer = undefined;
  }
};

const ensurePopstateListener = () => {
  if (popstateInstalled || typeof window === 'undefined') return;
  popstateInstalled = true;
  window.addEventListener(
    'popstate',
    (event) => {
      if ((event as PopStateEvent & { hasUAVisualTransition?: boolean }).hasUAVisualTransition) {
        uaVisualTransition = true;
        if (uaTransitionTimer !== undefined) window.clearTimeout(uaTransitionTimer);
        uaTransitionTimer = window.setTimeout(clearUATransition, UA_TRANSITION_TTL_MS);
        skipActiveLiveSlide();
      } else {
        clearUATransition();
      }
    },
    true
  );
};
ensurePopstateListener();

const hasPhoneStage = (): boolean =>
  typeof document !== 'undefined' &&
  typeof window !== 'undefined' &&
  document.querySelector(`[${PHONE_STAGE}]`) !== null;

const resolveWidth = (stage: HTMLElement) =>
  stage.getBoundingClientRect().width || (typeof window !== 'undefined' ? window.innerWidth : 0);

const mountLayer = (stage: HTMLElement, attr: string, top = 0) => {
  const el = document.createElement('div');
  el.setAttribute(attr, '');
  el.setAttribute('aria-hidden', 'true');
  if (top > 0) el.style.insetBlockStart = `${top}px`;
  stage.append(el);
  return el;
};

const mountShield = (stage: HTMLElement, top = 0) => {
  const shield = mountLayer(stage, SWIPE_HOLD_SHIELD, top);
  const stop = (event: Event) => event.stopPropagation();
  for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel'] as const) {
    shield.addEventListener(type, stop, { passive: true });
  }
  return shield;
};

const clearLayers = (over: HTMLElement, under?: HTMLElement) => {
  over.style.removeProperty('visibility');
  over.style.removeProperty('translate');
  over.removeAttribute(SWIPE_OVER_THREAD);
  over.removeAttribute('data-swiping');
  over.removeAttribute('data-swipe-shadow');
  under?.style.removeProperty('translate');
  under?.removeAttribute('data-swiping');
};

const prepareLayers = (
  direction: 'forward' | 'back',
  stage: HTMLElement,
  over: HTMLElement,
  under?: HTMLElement,
  top = 0,
  dirSign?: 1 | -1
) => {
  const width = resolveWidth(stage);
  const sign = dirSign ?? resolveLogicalDirectionSign(stage);
  const isForward = direction === 'forward';
  const overAt = (px: number) => `${(isForward ? width - px : px) * sign}px 0`;
  const underAt = (p: number) => `${-0.3 * width * (isForward ? p : 1 - p) * sign}px 0`;
  const dimAt = (p: number) => String(DIM_MAX_OPACITY * (isForward ? p : 1 - p));

  over.setAttribute(SWIPE_OVER_THREAD, '');
  over.setAttribute('data-swiping', '');
  over.setAttribute('data-swipe-shadow', '');
  over.style.translate = overAt(0);
  if (under) {
    under.setAttribute('data-swiping', '');
    under.style.translate = underAt(0);
  }
  const dim = mountLayer(stage, SWIPE_DIM, top);
  dim.setAttribute('data-swiping', '');
  dim.style.opacity = dimAt(0);
  return { width, isForward, overAt, underAt, dimAt, dim };
};

const handoffCommit = (
  isForward: boolean,
  over: HTMLElement,
  under: HTMLElement | undefined,
  offscreen: string,
  shield: HTMLElement,
  watchDisconnect: boolean,
  onCommit: () => void,
  onRelease: (committed: boolean, sync: boolean) => void
) => {
  over.removeAttribute('data-swiping');
  over.removeAttribute('data-swipe-shadow');
  under?.removeAttribute('data-swiping');
  if (isForward) {
    over.style.removeProperty('translate');
  } else {
    under?.style.removeProperty('translate');
    over.style.translate = offscreen;
    over.style.visibility = 'hidden';
  }

  activeHandoff?.complete(false, true);
  let released = false;
  let observer: MutationObserver | undefined;
  const onHide = () => {
    if (document.visibilityState === 'hidden') complete(false, true);
  };
  const complete = (committed: boolean, sync = true) => {
    if (released) return;
    released = true;
    window.clearTimeout(timer);
    observer?.disconnect();
    document.removeEventListener('visibilitychange', onHide);
    if (activeHandoff === handoff) {
      activeHandoff = undefined;
      setInteractivePhoneSlideClaimed(false);
    }
    try {
      onRelease(committed, sync);
    } finally {
      shield.remove();
    }
  };
  const handoff = { complete };
  activeHandoff = handoff;
  setInteractivePhoneSlideClaimed(true);
  document.addEventListener('visibilitychange', onHide);
  if (watchDisconnect && typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver(() => {
      if (!over.isConnected) complete(true, true);
    });
    observer.observe(document, { childList: true, subtree: true });
  }
  const timer = window.setTimeout(() => complete(false, true), HANDOFF_TIMEOUT_MS);
  try {
    onCommit();
  } catch (error) {
    complete(false, true);
    throw error;
  }
  if (watchDisconnect && !over.isConnected) complete(true, true);
};

/** Pure check of whether the active phone viewport is eligible to play a live 2-layer slide. */
export const canPlayLiveSlide = (): boolean =>
  hasPhoneStage() &&
  !uaVisualTransition &&
  document.visibilityState !== 'hidden' &&
  !isReducedMotion() &&
  !hasBlockingPortalOverlay();

/** Direction of the currently playing live slide, if any. */
export const getActiveLiveSlideDirection = (): 'forward' | 'back' | undefined =>
  activeSlide?.direction;

/** Whether a post-commit live slide/swipe handoff is awaiting route commit. */
export const isLiveHandoffActive = (): boolean => Boolean(activeHandoff);

/** Whether the current `exit` callback is running outside a React commit and may `flushSync`. */
export const isLiveSlideSyncExit = (): boolean => liveSlideSyncExit;

/** Whether a live slide animation or its post-commit handoff is currently active. */
export const isLiveSlideActive = (): boolean => Boolean(activeSlide || activeHandoff);

/** Immediately cancels any active live slide (including deferred `onCommit`) or commit handoff. */
export const skipActiveLiveSlide = (sync = true): void => {
  activeSlide?.skip(sync);
  activeHandoff?.complete(false, sync);
};

/** Notifies the active post-commit handoff that the destination route has committed to the DOM. */
export const completeLiveSlideHandoff = (): void => {
  activeHandoff?.complete(true, false);
};

/** Registers the active filling phone thread's animated handler for native history-back. */
export const registerLiveHistoryBackSlide = (handler: () => boolean): (() => void) => {
  activeHistoryBackSlide = handler;
  return () => {
    if (activeHistoryBackSlide === handler) activeHistoryBackSlide = undefined;
  };
};

/** Runs the registered live slide before `window.history.back()`; returns whether it claimed Back. */
export const runLiveHistoryBackSlide = (): boolean => activeHistoryBackSlide?.() ?? false;

/** Plays a 280 ms iMessage-style slide across two live DOM layers inside `stage`. */
export const playLiveSlide = ({
  direction,
  stage,
  over,
  under,
  exit,
  onCommit,
}: LiveSlideOptions): LiveSlideHandle => {
  ensurePopstateListener();
  skipActiveLiveSlide(direction !== 'forward');

  const skipNow =
    typeof document === 'undefined' ||
    typeof window === 'undefined' ||
    document.visibilityState === 'hidden' ||
    isReducedMotion() ||
    uaVisualTransition ||
    hasBlockingPortalOverlay() ||
    resolveWidth(stage) <= 0;
  if (skipNow) {
    if (uaVisualTransition) queueMicrotask(clearUATransition);
    onCommit?.();
    invokeExit(exit, true, direction !== 'forward');
    return { finished: Promise.resolve(), skip: () => undefined };
  }

  const { width, isForward, overAt, underAt, dimAt, dim } = prepareLayers(
    direction,
    stage,
    over,
    under
  );
  const shield = mountShield(stage);
  const abortController = new AbortController();
  let ended = false;
  let frameId = 0;
  let frameTimer = 0;
  let observer: MutationObserver | undefined;
  let traceStart: number | undefined;
  let resolveFinished: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });

  const endTrace = () => {
    if (traceStart === undefined) return;
    const ms = Math.round(performance.now() - traceStart);
    traceStart = undefined;
    try {
      recordDeepTraceEvent(`navigation.phone_slide.${direction}.end`, { duration_ms: ms });
    } catch {
      // Diagnostics must not break slide cleanup.
    }
  };
  if (isDeepTraceRecording()) {
    try {
      traceStart = performance.now();
      recordDeepTraceEvent(`navigation.phone_slide.${direction}.start`);
    } catch {
      traceStart = undefined;
    }
  }

  const onHide = () => {
    if (document.visibilityState === 'hidden') finish(false, true);
  };
  const onPopstate = () => finish(false, true);
  const detach = () => {
    window.cancelAnimationFrame(frameId);
    window.clearTimeout(frameTimer);
    observer?.disconnect();
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('popstate', onPopstate, true);
  };
  const finish = (committed: boolean, sync = true) => {
    if (ended) return;
    ended = true;
    detach();
    abortController.abort();
    if (activeSlide === record) {
      activeSlide = undefined;
      setInteractivePhoneSlideClaimed(false);
    }
    try {
      if (committed) onCommit?.();
    } finally {
      try {
        invokeExit(exit, committed, sync);
      } finally {
        dim.remove();
        shield.remove();
        clearLayers(over, under);
        endTrace();
        resolveFinished();
      }
    }
  };

  const record = { direction, skip: (sync = true) => finish(false, sync) };
  activeSlide = record;
  setInteractivePhoneSlideClaimed(true);
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('popstate', onPopstate, true);
  if (typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver(() => {
      if (!stage.isConnected || !over.isConnected || !under.isConnected) finish(false, true);
    });
    observer.observe(document, { childList: true, subtree: true });
  }

  const run = () => {
    if (ended) return;
    window.cancelAnimationFrame(frameId);
    window.clearTimeout(frameTimer);
    void animateSwipeElements(
      [
        { element: over, keyframes: [{ translate: overAt(0) }, { translate: overAt(width) }] },
        { element: under, keyframes: [{ translate: underAt(0) }, { translate: underAt(1) }] },
        { element: dim, keyframes: [{ opacity: dimAt(0) }, { opacity: dimAt(1) }] },
      ],
      LIVE_SLIDE_DURATION_MS,
      abortController.signal
    ).then(() => {
      if (ended) return;
      if (!isForward && onCommit) {
        ended = true;
        detach();
        dim.remove();
        if (activeSlide === record) activeSlide = undefined;
        handoffCommit(
          false,
          over,
          under,
          overAt(width),
          shield,
          true,
          onCommit,
          (committed, sync) => {
            try {
              invokeExit(exit, committed, sync);
            } finally {
              clearLayers(over, under);
              endTrace();
              resolveFinished();
            }
          }
        );
        return;
      }
      finish(true, true);
    });
  };

  if (isForward) {
    frameId = window.requestAnimationFrame(() => {
      if (!ended) frameId = window.requestAnimationFrame(run);
    });
    frameTimer = window.setTimeout(run, FRAME_WAIT_MS);
  } else {
    run();
  }
  return { finished, skip: record.skip };
};

const createLiveSwipeScene = (opts: {
  direction: 'back' | 'forward';
  stage: HTMLElement;
  over: HTMLElement;
  under?: HTMLElement;
  top?: number;
  watchDisconnect: boolean;
  exit: (committed: boolean) => void;
  onCommit: () => void;
  dirSign?: 1 | -1;
}): InteractiveSwipeScene | null => {
  const { direction, stage, over, under, top = 0, watchDisconnect, exit, onCommit } = opts;
  if (resolveWidth(stage) <= 0) {
    invokeExit(exit, false, true);
    return null;
  }
  const { width, isForward, overAt, underAt, dimAt, dim } = prepareLayers(
    direction,
    stage,
    over,
    under,
    top,
    opts.dirSign
  );
  let handedOff = false;
  let cleaned = false;
  let exited = false;
  let shield: HTMLElement | undefined;
  const finish = (committed: boolean, sync = true) => {
    if (exited) return;
    exited = true;
    try {
      invokeExit(exit, committed, sync);
    } finally {
      clearLayers(over, under);
    }
  };

  return {
    extent: width,
    update(px, progress) {
      over.style.translate = overAt(px);
      if (under) under.style.translate = underAt(progress);
      dim.style.opacity = dimAt(progress);
    },
    settle(commit, durationMs, px) {
      shield ??= mountShield(stage, top);
      const p = Math.max(0, Math.min(1, px / width));
      const end = commit ? 1 : 0;
      return animateSwipeElements(
        [
          {
            element: over,
            keyframes: [{ translate: overAt(px) }, { translate: overAt(commit ? width : 0) }],
          },
          { element: dim, keyframes: [{ opacity: dimAt(p) }, { opacity: dimAt(end) }] },
          ...(under
            ? [
                {
                  element: under,
                  keyframes: [{ translate: underAt(p) }, { translate: underAt(end) }],
                },
              ]
            : []),
        ],
        durationMs
      );
    },
    commit() {
      handedOff = true;
      dim.remove();
      handoffCommit(
        isForward,
        over,
        under,
        overAt(width),
        shield ?? mountShield(stage, top),
        watchDisconnect,
        onCommit,
        finish
      );
    },
    cleanup() {
      if (cleaned) return;
      cleaned = true;
      if (!handedOff) {
        try {
          finish(false, true);
        } finally {
          dim.remove();
          shield?.remove();
        }
      } else {
        dim.remove();
      }
    },
  };
};

/** 1:1 edge-swipe back scene over a live under-layer, or neutral backdrop on cold reload. */
export const createLiveBackSwipeScene = ({
  enterLiveUnder,
  onCommit,
  dirSign,
}: {
  enterLiveUnder: () => LiveThreadBackUnder | null;
  onCommit: () => void;
  dirSign?: 1 | -1;
}): InteractiveSwipeScene | null => {
  if (!hasPhoneStage() || isLiveSlideActive()) {
    return null;
  }
  const live = enterLiveUnder();
  if (live) {
    return createLiveSwipeScene({
      direction: 'back',
      ...live,
      watchDisconnect: true,
      onCommit,
      dirSign,
    });
  }
  const stage = document.querySelector<HTMLElement>(`[${PHONE_STAGE}]`);
  const page = stage?.querySelector<HTMLElement>(`[${PHONE_PAGE}]`);
  if (!stage || !page) return null;

  const top =
    stage.querySelector<HTMLElement>('[data-phone-top-bar]')?.getBoundingClientRect().height ?? 0;
  const backdrop = mountLayer(stage, SWIPE_BACKDROP, top);
  stage.setAttribute(SWIPE_STAGE, 'back');
  return createLiveSwipeScene({
    direction: 'back',
    stage,
    over: page,
    top,
    watchDisconnect: false,
    exit: () => {
      backdrop.remove();
      stage.removeAttribute(SWIPE_STAGE);
    },
    onCommit,
    dirSign,
  });
};

/** 1:1 end-edge forward swipe scene dragging a passively mounted `over` layer over `under`. */
export const createLiveForwardSwipeScene = ({
  enterLiveOver,
  onCommit,
  dirSign,
}: {
  enterLiveOver: () => LiveThreadBackUnder | null;
  onCommit: () => void;
  dirSign?: 1 | -1;
}): InteractiveSwipeScene | null => {
  if (!hasPhoneStage() || isLiveSlideActive()) {
    return null;
  }
  const live = enterLiveOver();
  return live
    ? createLiveSwipeScene({
        direction: 'forward',
        ...live,
        watchDisconnect: false,
        onCommit,
        dirSign,
      })
    : null;
};
