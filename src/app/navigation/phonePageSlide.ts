import { isDeepTraceRecording, recordDeepTraceEvent } from '../diagnostics/deepTrace';
import { flushSync } from 'react-dom';
import { NavigationType, type createBrowserRouter } from 'react-router-dom';
import { hasBlockingPortalOverlay } from '../lib/portalOverlay';
import { getImperativeJotaiStore } from '../lib/state/jotaiStore';
import { conversationUnderThreadAtom } from './conversationCover';
import {
  animateSwipeElements,
  type InteractiveSwipeScene,
  isReducedMotion,
  resolveLogicalDirectionSign,
  setInteractivePhoneSlideClaimed,
  SWIPE_SETTLE_EASING,
} from './interactiveSwipe';
import { phoneNavDrawerOpenAtom } from './phoneNavDrawer';
import './phonePageSlide.css';

/**
 * Marks the phone layout's box (shell/ClientLayout.tsx): what slides, and the sign that the page
 * is laid out for a phone.
 */
export const PHONE_STAGE = 'data-phone-stage';
/** Marks the page in it, below the top bar: what casts the slide's shadow. */
export const PHONE_PAGE = 'data-phone-page';

/** Marks the top bar in it (sidebar/PhoneTopBar.tsx), which no slide moves. */
const PHONE_TOP_BAR = 'data-phone-top-bar';
/** Marks overlay layers inside the stage (such as PhoneNavDrawer) that thread swipes must not slide. */
const PHONE_OVERLAY_LAYER = 'data-phone-overlay-layer';
/** Marks the still copy of the phone layout that a slide shows (phonePageSlide.css.ts). */
const COPY = 'data-page-slide-copy';
/** Marks the stage while an interactive thread <-> room swipe is active. */
const SWIPE_STAGE = 'data-swipe-stage';
/** Marks an interactive swipe preview or hold layer inside the stage. */
const SWIPE_PREVIEW = 'data-swipe-preview';
/** Marks a neutral themed surface backdrop fallback (kept below the top bar). */
const SWIPE_BACKDROP = 'data-swipe-backdrop';
/** Marks the subtle dim veil between the upper and lower swipe layers. */
const SWIPE_DIM = 'data-swipe-dim';
/**
 * Marks the input shield below the top bar, from the release of an interactive thread swipe until
 * it has settled back or its handoff has seen the route commit.
 */
const SWIPE_HOLD_SHIELD = 'data-swipe-hold-shield';
/** Marks `RoomView`'s page container during a live in-place room peek behind a sliding thread. */
export const SWIPE_THREAD_STAGE = 'data-swipe-thread-stage';
/** Marks the live inert room area revealed behind a sliding thread during a cache-miss back swipe. */
export const SWIPE_UNDER_THREAD = 'data-swipe-under-thread';
/** Marks the sliding thread column above the live peeked room. */
const SWIPE_OVER_THREAD = 'data-swipe-over-thread';
/** Elements inside the stage that belong to active slide/swipe chrome and must never be cloned. */
const SKIP_CLONE = `[${SWIPE_PREVIEW}], [${SWIPE_DIM}], [${SWIPE_HOLD_SHIELD}], [${COPY}], [${SWIPE_UNDER_THREAD}]`;
/** A vertical scroll clip. */
const CLIP = '[data-page-slide-clip]';
/** A row in a clip becomes an empty box once it is more than one screen out of view. */
const ROW = '[data-page-slide-row]';
/** The slide's keyframes (phonePageSlide.css.ts), apart from any other animation in the page. */
const KEYFRAMES = 'phone-page-';
/** How long the frame before the changes, and the slide itself, may take: a hidden tab has neither. */
const FRAME_MS = 100;
const PLAY_MS = 2000;
const DEFAULT_HANDOFF_TIMEOUT_MS = 1000;
const DIM_MAX_OPACITY = 0.12;
/** What would load or play to show in the copy. */
const MEDIA = 'img, iframe, video, audio, source';
/** The fields whose value shows as the text a person typed, which may be a secret. */
const TYPED =
  'textarea, input:not([type]), input:is([type=text], [type=password], [type=search], [type=email], [type=url], [type=tel], [type=number])';
/** Rich-text editable regions (such as the Slate composer) whose draft text must not be retained. */
const CONTENTEDITABLE = '[contenteditable]:not([contenteditable="false"])';

/** A change to the page; `sliding` tells whether it runs inside a slide. */
type Change = (sliding: boolean) => void;

/** A slide: `skip` runs its changes with nothing sliding, or cuts it short while it plays. */
type Slide = { finished: Promise<void>; skip: () => void };

type Router = ReturnType<typeof createBrowserRouter>;

export type StageSnapshot = {
  copy: HTMLElement;
  scrolled: [Element, number, number][];
};

export type PhoneSwipePreviewKey = {
  sessionId: string;
  roomId: string;
  threadId?: string;
};

export type ActivePhoneSwipeContext = PhoneSwipePreviewKey;

export type LiveThreadBackUnder = {
  stage: HTMLElement;
  over: HTMLElement;
  under: HTMLElement;
  exit: (committed: boolean) => void;
};

type StoredPreviewKey = {
  sessionId: string;
  roomId: string;
  threadId: string;
  width: number;
};

type StoredPreview = {
  snapshot: StageSnapshot;
  key: StoredPreviewKey;
};

type InteractiveHandoff = {
  fromLocationKey: string;
  consumed: boolean;
  finishAfterPaint: () => void;
  release: () => void;
};

/**
 * How deep a phone shows: its list (the navigation drawer over the page), a page, or a thread
 * that fills the page. Deeper comes in from the end edge, as a page of a phone's own apps does.
 */
const depth = (): number => {
  const store = getImperativeJotaiStore();
  if (store.get(phoneNavDrawerOpenAtom)) return 0;
  return store.get(conversationUnderThreadAtom) ? 2 : 1;
};

const clearInlineTranslate = (element: HTMLElement): void => {
  element.style.removeProperty('translate');
  element.style.translate = '';
};

const clearInlineTransition = (element: HTMLElement): void => {
  element.style.removeProperty('transition');
  element.style.transition = '';
};

const detachPreviewElement = (element: HTMLElement): void => {
  clearInlineTransition(element);
  element.remove();
  element.removeAttribute(SWIPE_PREVIEW);
  clearInlineTranslate(element);
};

/**
 * Settles a swipe scene: cloned snapshots transition via CSS `translate` (clocked by
 * `animateSwipeElements`), while live layers, `dim`, and fallback empty backdrops stay on WAAPI
 * because only cloned snapshot subtrees trigger WebKit's retained-subtree / `<canvas>` leak.
 */
const settleSwipeWithPreview = (
  snapshot: StageSnapshot | undefined,
  element: HTMLElement,
  fromTranslate: string,
  toTranslate: string,
  animations: Array<{ element: HTMLElement; keyframes: Keyframe[] }>,
  durationMs: number,
  isCleanedUp: () => boolean
): Promise<void> => {
  if (!snapshot) {
    animations.push({
      element,
      keyframes: [{ translate: fromTranslate }, { translate: toTranslate }],
    });
    return animateSwipeElements(animations, durationMs);
  }
  element.removeAttribute('data-swiping');
  clearInlineTransition(element);
  if (durationMs <= 0 || isReducedMotion()) {
    element.style.translate = toTranslate;
  } else {
    element.style.translate = fromTranslate;
    // Flush the start `translate` before enabling the transition so WebKit interpolates cleanly.
    void element.offsetWidth;
    element.style.transition = `translate ${durationMs}ms ${SWIPE_SETTLE_EASING}`;
    element.style.translate = toTranslate;
  }
  return animateSwipeElements(animations, durationMs).finally(() => {
    if (!isCleanedUp()) clearInlineTransition(element);
  });
};

const getStageSlidingChildren = (stage: Element): HTMLElement[] =>
  Array.from(stage.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement &&
      !child.hasAttribute(PHONE_TOP_BAR) &&
      !child.hasAttribute(PHONE_OVERLAY_LAYER) &&
      !child.hasAttribute(COPY) &&
      !child.hasAttribute(SWIPE_PREVIEW) &&
      !child.hasAttribute(SWIPE_DIM) &&
      !child.hasAttribute(SWIPE_HOLD_SHIELD)
  );

/**
 * Refreshes inline `--room-header-height` on cloned conversation areas after mounting `copy`.
 * A preview captured in a short room area (`<= 240px`, where `HeaderInShortArea` hides the
 * floating header) stores `--room-header-height: 0px`; once mounted at a taller height, the
 * cloned header becomes visible again and its parent's inset must match before scroll restoration.
 */
const syncMountedOverlayInsets = (copy: HTMLElement): void => {
  copy.querySelectorAll<HTMLElement>('[data-room-header="true"]').forEach((header) => {
    const area = header.parentElement;
    if (!area || !area.style.getPropertyValue('--room-header-height').trim()) return;
    area.style.setProperty('--room-header-height', `${header.offsetHeight}px`);
  });
};

const mountStageSnapshot = (snapshot: StageSnapshot, over: Element): HTMLElement => {
  over.append(snapshot.copy);
  syncMountedOverlayInsets(snapshot.copy);
  snapshot.scrolled.forEach(([element, scrollTop, scrollLeft]) =>
    Object.assign(element, { scrollTop, scrollLeft })
  );
  return snapshot.copy;
};

/**
 * Captures a still, sanitized snapshot of `stage` and its scrollable descendants' offsets.
 * Strips typed form values, `[contenteditable]` drafts, media sources, active swipe chrome, and
 * inline `translate` / swipe attributes so the snapshot always starts cleanly at rest.
 */
export const captureStageSnapshot = (
  stage: Element,
  options?: { horizontalShiftPx?: number }
): StageSnapshot => {
  const horizontalShiftPx = options?.horizontalShiftPx ?? 0;
  const bounds = stage.getBoundingClientRect();
  // Keep a screen of rows on either side: the keyboard can go away or text can shrink mid-slide.
  const buffer = Math.max(window.screen.height, window.innerHeight);
  const buffered = { top: bounds.top - buffer, bottom: bounds.bottom + buffer };
  // Read live geometry while writing only into a detached document. No write there can dirty
  // the live layout, and nothing loads before the copy loses its media sources.
  const still = document.implementation.createHTMLDocument('');
  const scrolled: [Element, number, number][] = [];
  const drawn: [HTMLCanvasElement, HTMLCanvasElement | HTMLImageElement][] = [];
  const sizeBox = (twin: HTMLElement, { width, height }: { width: number; height: number }) => {
    Object.assign(twin.style, {
      boxSizing: 'border-box',
      width: `${width}px`,
      height: `${height}px`,
    });
  };
  const prepare = (element: Element, twin: Element): Element => {
    if (element.closest(SKIP_CLONE) || element.closest(CONTENTEDITABLE)) return twin;
    const { scrollTop, scrollLeft } = element;
    if (scrollTop || scrollLeft) scrolled.push([twin, scrollTop, scrollLeft]);
    if (element instanceof HTMLCanvasElement && element.width && element.height) {
      drawn.push([twin as HTMLCanvasElement, element]);
    }
    if (!(element instanceof HTMLElement) || !element.matches(MEDIA)) return twin;
    const blank = twin as HTMLElement;
    ['src', 'srcset', 'srcdoc', 'poster', 'autoplay', 'loading', 'alt'].forEach((name) =>
      blank.removeAttribute(name)
    );
    // A frame, video or unloaded picture stays a blank box. A loaded picture is drawn from
    // the page's own, even if the address (such as a revoked avatar URL) no longer works.
    const { offsetWidth: width, offsetHeight: height } = element;
    sizeBox(blank, { width, height });
    if (!(element instanceof HTMLImageElement)) return blank;
    const { complete, naturalWidth, naturalHeight } = element;
    const box = element.getBoundingClientRect();
    const shift = element.closest(`[${PHONE_TOP_BAR}]`) ? 0 : horizontalShiftPx;
    const restingLeft = box.left - shift;
    const restingRight = box.right - shift;
    if (
      !complete ||
      !naturalWidth ||
      !naturalHeight ||
      !box.width ||
      !box.height ||
      restingRight <= bounds.left ||
      restingLeft >= bounds.right ||
      box.bottom < buffered.top ||
      box.top > buffered.bottom
    )
      return blank;
    const picture = still.createElement('canvas');
    Array.from(blank.attributes).forEach(({ name, value }) => picture.setAttribute(name, value));
    // Keep the picture's aspect ratio, with no more pixels than its box can show.
    const pixels = window.devicePixelRatio || 1;
    const scale = Math.min(1, (width / naturalWidth) * pixels, (height / naturalHeight) * pixels);
    picture.width = Math.max(1, Math.round(naturalWidth * scale));
    picture.height = Math.max(1, Math.round(naturalHeight * scale));
    drawn.push([picture, element]);
    return picture;
  };
  const shellOf = (element: Element, box: DOMRect) => {
    const shell = still.importNode(element, false) as HTMLElement;
    sizeBox(shell, box);
    return shell;
  };
  const clone = (element: Element, clip?: { top: number; bottom: number }): Element => {
    if (element.matches(CONTENTEDITABLE)) {
      return still.importNode(element, false);
    }
    if (element.matches(CLIP)) {
      const view = element.getBoundingClientRect();
      const { top, bottom } = clip ?? buffered;
      if (!view.width || !view.height || view.bottom < top || view.top > bottom)
        return shellOf(element, view);
      clip = {
        top: Math.max(top, view.top - buffer),
        bottom: Math.min(bottom, view.bottom + buffer),
      };
    }
    if (clip && element.matches(ROW)) {
      const box = element.getBoundingClientRect();
      if (box.bottom < clip.top || box.top > clip.bottom) return shellOf(element, box);
    }
    const split = !!element.querySelector(clip ? `${CLIP}, ${ROW}` : CLIP);
    const twin = still.importNode(element, !split);
    const prepared = element === stage ? twin : prepare(element, twin);
    if (split) {
      for (const child of element.childNodes) {
        if (child instanceof Element && child.matches(SKIP_CLONE)) continue;
        twin.appendChild(
          child instanceof Element ? clone(child, clip) : still.importNode(child, false)
        );
      }
    } else {
      // With no clip or rows to split below us, use the browser's native deep clone.
      const children = twin.querySelectorAll('*');
      element.querySelectorAll('*').forEach((child, index) => {
        const match = children[index]!;
        const ready = prepare(child, match);
        if (ready !== match) match.replaceWith(ready);
      });
    }
    return prepared;
  };
  const copy = clone(stage) as HTMLElement;
  copy.querySelectorAll(SKIP_CLONE).forEach((element) => element.remove());
  // Clear editable draft subtrees inside the detached document before adoption so no draft
  // media (e.g. <img src>) is ever adopted into the live document.
  copy.querySelectorAll<HTMLElement>(CONTENTEDITABLE).forEach((field) => {
    field.textContent = '';
  });
  document.adoptNode(copy);
  drawn.forEach(([canvas, from]) =>
    canvas.getContext('2d')?.drawImage(from, 0, 0, canvas.width, canvas.height)
  );
  copy.removeAttribute(PHONE_STAGE);
  copy.removeAttribute('id');
  copy.removeAttribute(SWIPE_STAGE);
  copy.removeAttribute(SWIPE_PREVIEW);
  copy.removeAttribute(SWIPE_BACKDROP);
  copy.removeAttribute('data-swiping');
  copy.removeAttribute('data-swipe-shadow');
  copy.removeAttribute(SWIPE_THREAD_STAGE);
  copy.removeAttribute(SWIPE_OVER_THREAD);
  clearInlineTranslate(copy);
  copy.setAttribute(COPY, '');
  copy.setAttribute('aria-hidden', 'true');
  copy.setAttribute('inert', '');
  copy.style.position = 'absolute';
  // The top bar stays above every page: the layout's own shows in the place of the copy's.
  Array.from(copy.children).forEach((child) => {
    if (child.hasAttribute(PHONE_TOP_BAR)) (child as HTMLElement).style.visibility = 'hidden';
    child.removeAttribute(PHONE_TOP_BAR);
  });
  // `name` and `form`: a radio button of the copy would uncheck the page's own of that name, and
  // a field of it would join the page's form.
  copy.querySelectorAll('[id], [data-testid], [name], [form], [for]').forEach((element) => {
    ['id', 'data-testid', 'name', 'form', 'for'].forEach((name) => element.removeAttribute(name));
  });
  copy
    .querySelectorAll<HTMLElement>(
      `[data-swiping], [data-swipe-shadow], [${SWIPE_THREAD_STAGE}], [${SWIPE_OVER_THREAD}]`
    )
    .forEach((element) => {
      element.removeAttribute('data-swiping');
      element.removeAttribute('data-swipe-shadow');
      element.removeAttribute(SWIPE_THREAD_STAGE);
      element.removeAttribute(SWIPE_OVER_THREAD);
    });
  copy.querySelectorAll<HTMLElement>('[style]').forEach((element) => {
    if (element.style.translate || element.style.getPropertyValue('translate')) {
      clearInlineTranslate(element);
    }
  });
  copy
    .querySelectorAll<HTMLInputElement>(TYPED)
    .forEach((field) => Object.assign(field, { defaultValue: '', value: '' }));
  return {
    copy,
    scrolled: scrolled.filter(([element]) => copy.contains(element)),
  };
};

/** Two single-entry retained preview slots for finger-following thread <-> room swipes. */
let roomPreview: StoredPreview | undefined;
let threadPreview: StoredPreview | undefined;
/** Snapshots currently owned by an active scene, slide, or handoff (must not be disposed mid-use). */
const ownedSnapshots = new WeakSet<StageSnapshot>();
let resizeListenerAttached = false;
/** The currently active room/thread context, synced by `useRoomViewThreadState`. */
let activeSwipeContext: ActivePhoneSwipeContext | undefined;
/** The latest router location key observed by `withPhonePageSlide`. */
let currentPhoneLocationKey: string | undefined;
let activeRouterSubscribers = 0;
/** Active interactive swipe handoff waiting for the router to commit the target route. */
let interactiveHandoff: InteractiveHandoff | undefined;

export const setActivePhoneSwipeContext = (context: ActivePhoneSwipeContext | undefined): void => {
  activeSwipeContext = context;
};

export const clearActivePhoneSwipeContext = (context: ActivePhoneSwipeContext): void => {
  if (activeSwipeContext === context) activeSwipeContext = undefined;
};

export const getCurrentPhoneLocationKey = (): string | undefined => currentPhoneLocationKey;

export const isInteractivePhoneSlideClaimed = (): boolean => interactiveHandoff !== undefined;

const isRetainedPreview = (snapshot: StageSnapshot): boolean =>
  roomPreview?.snapshot === snapshot || threadPreview?.snapshot === snapshot;

/**
 * Releases `<canvas>` backing stores, active animations, and detached children for a snapshot that
 * is neither retained in a preview slot nor currently owned by an active scene/slide/handoff.
 */
export const disposeStageSnapshot = (snapshot: StageSnapshot): void => {
  if (ownedSnapshots.has(snapshot) || isRetainedPreview(snapshot)) return;
  snapshot.copy.getAnimations?.().forEach((animation) => {
    try {
      animation.cancel();
    } catch {
      // Ignore cancellation errors on detached or mocked animations.
    }
  });
  snapshot.copy.querySelectorAll('canvas').forEach((canvas) => {
    canvas.width = 0;
    canvas.height = 0;
  });
  snapshot.copy.replaceChildren();
  snapshot.scrolled.length = 0;
};

const releaseOwnedSnapshot = (snapshot: StageSnapshot | undefined): void => {
  if (!snapshot) return;
  ownedSnapshots.delete(snapshot);
  disposeStageSnapshot(snapshot);
};

const setPreviewSlot = (kind: 'room' | 'thread', next: StoredPreview | undefined): void => {
  const previous = kind === 'room' ? roomPreview : threadPreview;
  if (kind === 'room') roomPreview = next;
  else threadPreview = next;
  if (previous && previous.snapshot !== next?.snapshot) {
    disposeStageSnapshot(previous.snapshot);
  }
  syncPreviewResizeListener();
};

/**
 * Another width discards a preview. Height-only changes (soft keyboard, browser toolbar) keep and
 * display the preview: `copy` fills the stage with `inset: 0` and retains buffered rows.
 */
const handlePreviewResize = (): void => {
  if (typeof window === 'undefined') return;
  const width = window.innerWidth;
  if (roomPreview && roomPreview.key.width !== width) {
    setPreviewSlot('room', undefined);
  }
  if (threadPreview && threadPreview.key.width !== width) {
    setPreviewSlot('thread', undefined);
  }
  syncPreviewResizeListener();
};

const syncPreviewResizeListener = (): void => {
  if (typeof window === 'undefined') return;
  const hasPreview = roomPreview !== undefined || threadPreview !== undefined;
  if (hasPreview && !resizeListenerAttached) {
    window.addEventListener('resize', handlePreviewResize);
    resizeListenerAttached = true;
  } else if (!hasPreview && resizeListenerAttached) {
    window.removeEventListener('resize', handlePreviewResize);
    resizeListenerAttached = false;
  }
};

const storePhoneSwipePreview = (
  kind: 'room' | 'thread',
  key: PhoneSwipePreviewKey,
  snapshot: StageSnapshot
): StoredPreview | undefined => {
  if (typeof window === 'undefined') return undefined;
  if (!key.sessionId || !key.roomId || !key.threadId) return undefined;
  const stored: StoredPreview = {
    snapshot,
    key: {
      sessionId: key.sessionId,
      roomId: key.roomId,
      threadId: key.threadId,
      width: window.innerWidth,
    },
  };
  setPreviewSlot(kind, stored);
  return stored;
};

const capturePhoneSwipePreviewEntry = (
  kind: 'room' | 'thread',
  key: PhoneSwipePreviewKey,
  options?: { horizontalShiftPx?: number }
): StoredPreview | undefined => {
  if (typeof document === 'undefined' || typeof window === 'undefined') return undefined;
  if (!key.sessionId || !key.roomId || !key.threadId) return undefined;
  const stage = document.querySelector(`[${PHONE_STAGE}]`);
  if (!stage) return undefined;
  try {
    const snapshot = captureStageSnapshot(stage, options);
    const stored = storePhoneSwipePreview(kind, key, snapshot);
    if (!stored) disposeStageSnapshot(snapshot);
    return stored;
  } catch {
    // Snapshot failures must never block navigation or swipes.
    return undefined;
  }
};

/** Captures `[data-phone-stage]` into the retained `room` or `thread` swipe preview slot. */
export const capturePhoneSwipePreview = (
  kind: 'room' | 'thread',
  key: PhoneSwipePreviewKey,
  options?: { horizontalShiftPx?: number }
): void => {
  capturePhoneSwipePreviewEntry(kind, key, options);
};

/** Rekeys a retained `room` or `thread` preview when its local-echo thread ID confirms. */
export const rekeyPhoneSwipePreviewThread = (
  kind: 'room' | 'thread',
  key: { sessionId: string; roomId: string; threadId: string },
  nextThreadId: string
): void => {
  if (!key.sessionId || !key.roomId || !key.threadId || !nextThreadId) return;
  if (key.threadId === nextThreadId) return;
  const entry = kind === 'room' ? roomPreview : threadPreview;
  if (
    !entry ||
    entry.key.sessionId !== key.sessionId ||
    entry.key.roomId !== key.roomId ||
    entry.key.threadId !== key.threadId
  ) {
    return;
  }
  entry.key.threadId = nextThreadId;
};

/** Discards both retained phone swipe previews (e.g. on account switch, sign-out, or resize). */
export const clearPhoneSwipePreviews = (): void => {
  setPreviewSlot('room', undefined);
  setPreviewSlot('thread', undefined);
};

/**
 * Returns the retained preview when width, session, room, and thread match.
 * Width changes discard previews; height-only changes (soft keyboard, browser toolbar) keep and
 * display the preview.
 */
const getMatchingPreview = (
  kind: 'room' | 'thread',
  key: PhoneSwipePreviewKey
): StageSnapshot | undefined => {
  const entry = kind === 'room' ? roomPreview : threadPreview;
  if (!entry || typeof window === 'undefined') return undefined;
  if (entry.key.width !== window.innerWidth) {
    handlePreviewResize();
    return undefined;
  }
  if (entry.key.sessionId !== key.sessionId) {
    clearPhoneSwipePreviews();
    return undefined;
  }
  if (entry.key.roomId !== key.roomId) {
    setPreviewSlot(kind, undefined);
    return undefined;
  }
  if (!key.threadId || entry.key.threadId !== key.threadId) {
    return undefined;
  }
  if (entry.snapshot.copy.isConnected) return undefined;
  return entry.snapshot;
};

const isSceneContextCurrent = (
  kind: 'back' | 'forward',
  key: PhoneSwipePreviewKey,
  fromLocationKey: string,
  startedWithContext: boolean
): boolean => {
  if (
    fromLocationKey &&
    activeRouterSubscribers > 0 &&
    currentPhoneLocationKey !== undefined &&
    currentPhoneLocationKey !== fromLocationKey
  ) {
    return false;
  }
  if (startedWithContext && !activeSwipeContext) return false;
  if (activeSwipeContext) {
    if (
      activeSwipeContext.sessionId !== key.sessionId ||
      activeSwipeContext.roomId !== key.roomId
    ) {
      return false;
    }
    if (kind === 'back' && activeSwipeContext.threadId !== key.threadId) {
      return false;
    }
    if (kind === 'forward' && activeSwipeContext.threadId !== undefined) {
      return false;
    }
  }
  return true;
};

/** The changes of the slide that waits for the frame that shows the page as it is. */
let waiting: Change[] | undefined;
let playing = false;
/** The slide from its call until it has played, waiting for its frame or playing. */
let active: Slide | undefined;

/**
 * Claims the next phone navigation leaving `fromLocationKey` for an already-settled interactive
 * swipe: suppresses `slidePhonePage` (surviving async `history.back()`/`history.go(-n)` `popstate`),
 * holds `holdElement` over `[data-phone-stage]` through the synchronous route swap + 1 paint frame,
 * and auto-releases on timeout, tab hide, or stage disconnect so the UI can never strand.
 */
export const claimInteractivePhoneSlide = ({
  fromLocationKey,
  holdElement,
  holdSnapshot,
  shield: settleShield,
  onRelease,
  timeoutMs = DEFAULT_HANDOFF_TIMEOUT_MS,
}: {
  fromLocationKey: string;
  holdElement?: HTMLElement;
  /** Snapshot backing `holdElement`, transferred from a committed swipe scene for disposal on release. */
  holdSnapshot?: StageSnapshot;
  /** The shield the scene mounted for its settle: the handoff keeps it, with no second one. */
  shield?: HTMLElement;
  /** Invoked once when the handoff releases (route commit, timeout, hide, disconnect, or skip). */
  onRelease?: () => void;
  timeoutMs?: number;
}): (() => void) => {
  const heldElement = holdElement ?? holdSnapshot?.copy;
  if (
    fromLocationKey &&
    activeRouterSubscribers > 0 &&
    currentPhoneLocationKey !== undefined &&
    currentPhoneLocationKey !== fromLocationKey
  ) {
    settleShield?.remove();
    if (heldElement) detachPreviewElement(heldElement);
    releaseOwnedSnapshot(holdSnapshot);
    onRelease?.();
    return () => undefined;
  }

  if (interactiveHandoff) interactiveHandoff.release();
  if (active) active.skip();

  if (holdSnapshot) ownedSnapshots.add(holdSnapshot);

  const page = typeof document === 'undefined' ? undefined : document;
  const stage = page?.querySelector(`[${PHONE_STAGE}]`) ?? null;

  if (heldElement) {
    clearInlineTransition(heldElement);
    if (stage && !heldElement.isConnected) stage.append(heldElement);
    heldElement.setAttribute(SWIPE_PREVIEW, 'hold');
    heldElement.style.translate = '0px 0';
  }

  const shield = settleShield ?? (stage ? mountHoldShield(stage) : undefined);

  let released = false;
  let timer = 0;
  let frame = 0;
  let watch: MutationObserver | undefined;
  let finish: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });

  const onVisibilityChange = () => {
    if (page?.visibilityState === 'hidden') release();
  };

  const release = () => {
    if (released) return;
    released = true;
    window.clearTimeout(timer);
    window.cancelAnimationFrame(frame);
    watch?.disconnect();
    page?.removeEventListener('visibilitychange', onVisibilityChange);
    shield?.remove();
    if (heldElement) detachPreviewElement(heldElement);
    releaseOwnedSnapshot(holdSnapshot);
    if (interactiveHandoff === handoff) {
      interactiveHandoff = undefined;
      setInteractivePhoneSlideClaimed(false);
    }
    if (active === handoffSlide) {
      playing = false;
      active = undefined;
    }
    try {
      onRelease?.();
    } finally {
      finish();
    }
  };

  const finishAfterPaint = () => {
    if (released) return;
    window.clearTimeout(timer);
    frame = window.requestAnimationFrame(() => release());
    timer = window.setTimeout(release, FRAME_MS);
  };

  const handoff: InteractiveHandoff = {
    fromLocationKey,
    consumed: false,
    finishAfterPaint,
    release,
  };
  const handoffSlide: Slide = {
    finished,
    skip: release,
  };

  playing = true;
  active = handoffSlide;
  interactiveHandoff = handoff;
  setInteractivePhoneSlideClaimed(true);

  timer = window.setTimeout(release, timeoutMs);
  page?.addEventListener('visibilitychange', onVisibilityChange);
  if (page && stage) {
    watch = new MutationObserver(() => {
      if (!stage.isConnected || !stage.hasAttribute(PHONE_STAGE)) release();
    });
    watch.observe(page, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [PHONE_STAGE],
    });
  }

  return release;
};

const getTopBarHeight = (stage: Element): number => {
  const topBar = Array.from(stage.children).find(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.hasAttribute(PHONE_TOP_BAR)
  );
  return topBar ? topBar.getBoundingClientRect().height : 0;
};

/** Mounts the input shield over `stage`, below its top bar: taps and touches stop at it. */
const mountHoldShield = (stage: Element): HTMLDivElement => {
  const shield = document.createElement('div');
  shield.setAttribute(SWIPE_HOLD_SHIELD, '');
  shield.setAttribute('aria-hidden', 'true');
  const topBarHeight = getTopBarHeight(stage);
  if (topBarHeight > 0) shield.style.insetBlockStart = `${topBarHeight}px`;
  shield.style.pointerEvents = 'auto';
  const stopTouch = (event: Event) => {
    event.stopPropagation();
  };
  shield.addEventListener('touchstart', stopTouch, { passive: true });
  shield.addEventListener('touchmove', stopTouch, { passive: true });
  shield.addEventListener('touchend', stopTouch, { passive: true });
  shield.addEventListener('touchcancel', stopTouch, { passive: true });
  stage.append(shield);
  return shield;
};

const createBackdropElement = (
  mode: 'backdrop' | 'over-backdrop',
  topBarHeight: number
): HTMLDivElement => {
  const backdrop = document.createElement('div');
  backdrop.setAttribute(SWIPE_PREVIEW, mode);
  backdrop.setAttribute(SWIPE_BACKDROP, '');
  backdrop.setAttribute('aria-hidden', 'true');
  if (topBarHeight > 0) backdrop.style.insetBlockStart = `${topBarHeight}px`;
  return backdrop;
};

/**
 * Interactive finger-following scene for dragging start-edge back from an open thread to its room.
 * Reveals the retained room preview (or a neutral themed surface backdrop) with -30% parallax and
 * a subtle dim veil, captures the departing thread preview on commit, and hands off via
 * `claimInteractivePhoneSlide` so the route change never double-slides.
 */
export const createThreadBackSwipeScene = ({
  key,
  fromLocationKey,
  onCommit,
  dirSign,
  enterLiveUnder,
}: {
  key: PhoneSwipePreviewKey;
  fromLocationKey: string;
  onCommit: () => void;
  dirSign?: 1 | -1;
  enterLiveUnder?: () => LiveThreadBackUnder | null;
}): InteractiveSwipeScene | null => {
  if (typeof document === 'undefined' || typeof window === 'undefined' || playing) return null;
  const stage = document.querySelector<HTMLElement>(`[${PHONE_STAGE}]`);
  if (!stage) return null;

  const rect = stage.getBoundingClientRect();
  const width = rect.width > 0 ? rect.width : window.innerWidth;
  if (width <= 0) return null;

  const sign = dirSign ?? resolveLogicalDirectionSign(stage);
  const matchedRoom = getMatchingPreview('room', key);
  if (matchedRoom) ownedSnapshots.add(matchedRoom);
  const live = matchedRoom ? null : (enterLiveUnder?.() ?? null);
  const topElements = live ? [live.over] : getStageSlidingChildren(stage);
  const topPage = live
    ? live.over
    : topElements.find((element) => element.hasAttribute(PHONE_PAGE));
  const topBarHeight = live ? 0 : getTopBarHeight(stage);
  const under = live
    ? live.under
    : matchedRoom
      ? mountStageSnapshot(matchedRoom, stage)
      : (() => {
          const backdrop = createBackdropElement('backdrop', topBarHeight);
          stage.append(backdrop);
          return backdrop;
        })();

  if (live) {
    live.over.setAttribute(SWIPE_OVER_THREAD, '');
  } else {
    if (matchedRoom) under.setAttribute(SWIPE_PREVIEW, 'under');
    stage.setAttribute(SWIPE_STAGE, 'back');
  }
  under.setAttribute('data-swiping', '');
  under.style.translate = `${-0.3 * width * sign}px 0`;

  const dim = document.createElement('div');
  dim.setAttribute(SWIPE_DIM, live ? 'live-back' : 'back');
  dim.setAttribute('aria-hidden', 'true');
  dim.setAttribute('data-swiping', '');
  if (topBarHeight > 0) dim.style.insetBlockStart = `${topBarHeight}px`;
  dim.style.opacity = String(DIM_MAX_OPACITY);
  (live ? live.stage : stage).append(dim);

  topElements.forEach((element) => element.setAttribute('data-swiping', ''));
  topPage?.setAttribute('data-swipe-shadow', '');

  const startedWithContext = activeSwipeContext !== undefined;
  let handedOff = false;
  let cleanedUp = false;
  let liveExited = false;
  let shield: HTMLElement | undefined;
  let capturedPreview: StoredPreview | undefined;

  const rollbackCapturedPreview = () => {
    if (capturedPreview && threadPreview === capturedPreview) {
      setPreviewSlot('thread', undefined);
    }
    capturedPreview = undefined;
  };

  const clearTopStyles = () => {
    topElements.forEach((element) => {
      clearInlineTranslate(element);
      element.removeAttribute('data-swiping');
    });
    topPage?.removeAttribute('data-swipe-shadow');
    stage.removeAttribute(SWIPE_STAGE);
  };

  const finishLive = (committed: boolean) => {
    if (!live || liveExited) return;
    liveExited = true;
    live.over.style.removeProperty('visibility');
    clearInlineTranslate(live.over);
    live.over.removeAttribute(SWIPE_OVER_THREAD);
    live.over.removeAttribute('data-swiping');
    live.over.removeAttribute('data-swipe-shadow');
    clearInlineTranslate(live.under);
    live.under.removeAttribute('data-swiping');
    live.exit(committed);
  };

  return {
    extent: width,
    update(offsetPx, progress) {
      const topTranslate = `${offsetPx * sign}px 0`;
      topElements.forEach((element) => {
        element.style.translate = topTranslate;
      });
      under.style.translate = `${-0.3 * width * (1 - progress) * sign}px 0`;
      dim.style.opacity = String(DIM_MAX_OPACITY * (1 - progress));
    },
    settle(commit, durationMs, currentOffsetPx) {
      // From the release on, whichever way it settles: a tap must not land on what still moves.
      shield ??= mountHoldShield(stage);
      const shouldCommit =
        commit && isSceneContextCurrent('back', key, fromLocationKey, startedWithContext);
      if (shouldCommit) {
        capturedPreview = capturePhoneSwipePreviewEntry('thread', key, {
          horizontalShiftPx: currentOffsetPx * sign,
        });
      }
      const currentProgress = Math.max(0, Math.min(1, currentOffsetPx / width));
      const animations: Array<{ element: HTMLElement; keyframes: Keyframe[] }> = [
        ...topElements.map((element) => ({
          element,
          keyframes: [
            { translate: `${currentOffsetPx * sign}px 0` },
            { translate: `${shouldCommit ? width * sign : 0}px 0` },
          ],
        })),
        {
          element: dim,
          keyframes: [
            { opacity: String(DIM_MAX_OPACITY * (1 - currentProgress)) },
            { opacity: String(shouldCommit ? 0 : DIM_MAX_OPACITY) },
          ],
        },
      ];
      return settleSwipeWithPreview(
        matchedRoom,
        under,
        `${-0.3 * width * (1 - currentProgress) * sign}px 0`,
        `${shouldCommit ? 0 : -0.3 * width * sign}px 0`,
        animations,
        durationMs,
        () => cleanedUp
      );
    },
    commit() {
      if (!isSceneContextCurrent('back', key, fromLocationKey, startedWithContext)) {
        rollbackCapturedPreview();
        return;
      }
      handedOff = true;
      dim.remove();
      under.removeAttribute('data-swiping');
      if (live) {
        clearInlineTranslate(live.under);
        live.over.style.translate = `${width * sign}px 0`;
        live.over.style.visibility = 'hidden';
        live.over.removeAttribute('data-swiping');
        live.over.removeAttribute('data-swipe-shadow');
        claimInteractivePhoneSlide({ fromLocationKey, shield, onRelease: () => finishLive(true) });
        onCommit();
        return;
      }
      clearInlineTransition(under);
      under.style.translate = '0px 0';
      under.setAttribute(SWIPE_PREVIEW, 'hold');
      if (matchedRoom && roomPreview?.snapshot === matchedRoom) {
        setPreviewSlot('room', undefined);
      }
      claimInteractivePhoneSlide({
        fromLocationKey,
        holdElement: under,
        holdSnapshot: matchedRoom,
        shield,
      });
      clearTopStyles();
      onCommit();
    },
    cleanup() {
      if (cleanedUp) return;
      cleanedUp = true;
      dim.remove();
      if (live) {
        if (!handedOff) {
          shield?.remove();
          rollbackCapturedPreview();
          finishLive(false);
        }
        return;
      }
      clearTopStyles();
      if (!handedOff) {
        shield?.remove();
        rollbackCapturedPreview();
        detachPreviewElement(under);
        under.removeAttribute('data-swiping');
        releaseOwnedSnapshot(matchedRoom);
      }
    },
  };
};

/**
 * Interactive finger-following scene for dragging end-edge forward from a room back into its last
 * exited thread. Slides the retained thread preview (or a neutral themed sheet) in over the room
 * while shifting the live room -30%, captures the departing room preview on commit, and hands off
 * via `claimInteractivePhoneSlide` so the route change never double-slides.
 */
export const createThreadForwardSwipeScene = ({
  key,
  fromLocationKey,
  onCommit,
  dirSign,
}: {
  key: PhoneSwipePreviewKey;
  fromLocationKey: string;
  onCommit: () => void;
  dirSign?: 1 | -1;
}): InteractiveSwipeScene | null => {
  if (typeof document === 'undefined' || typeof window === 'undefined' || playing) return null;
  const stage = document.querySelector<HTMLElement>(`[${PHONE_STAGE}]`);
  if (!stage) return null;

  const rect = stage.getBoundingClientRect();
  const width = rect.width > 0 ? rect.width : window.innerWidth;
  if (width <= 0) return null;

  const sign = dirSign ?? resolveLogicalDirectionSign(stage);
  const underElements = getStageSlidingChildren(stage);

  const topBarHeight = getTopBarHeight(stage);
  const dim = document.createElement('div');
  dim.setAttribute(SWIPE_DIM, 'forward');
  dim.setAttribute('aria-hidden', 'true');
  dim.setAttribute('data-swiping', '');
  if (topBarHeight > 0) dim.style.insetBlockStart = `${topBarHeight}px`;
  dim.style.opacity = '0';
  stage.append(dim);

  const matchedThread = getMatchingPreview('thread', key);
  if (matchedThread) ownedSnapshots.add(matchedThread);
  const over = matchedThread
    ? mountStageSnapshot(matchedThread, stage)
    : (() => {
        const backdrop = createBackdropElement('over-backdrop', topBarHeight);
        stage.append(backdrop);
        return backdrop;
      })();
  if (matchedThread) over.setAttribute(SWIPE_PREVIEW, 'over');
  const overShadowTarget = matchedThread
    ? (over.querySelector<HTMLElement>(`[${PHONE_PAGE}]`) ?? over)
    : over;
  over.setAttribute('data-swiping', '');
  overShadowTarget.setAttribute('data-swipe-shadow', '');
  over.style.translate = `${width * sign}px 0`;

  stage.setAttribute(SWIPE_STAGE, 'forward');
  underElements.forEach((element) => element.setAttribute('data-swiping', ''));

  const startedWithContext = activeSwipeContext !== undefined;
  let handedOff = false;
  let cleanedUp = false;
  let shield: HTMLElement | undefined;
  let capturedPreview: StoredPreview | undefined;

  const rollbackCapturedPreview = () => {
    if (capturedPreview && roomPreview === capturedPreview) {
      setPreviewSlot('room', undefined);
    }
    capturedPreview = undefined;
  };

  const clearUnderStyles = () => {
    underElements.forEach((element) => {
      clearInlineTranslate(element);
      element.removeAttribute('data-swiping');
    });
    stage.removeAttribute(SWIPE_STAGE);
  };

  return {
    extent: width,
    update(offsetPx, progress) {
      over.style.translate = `${(width - offsetPx) * sign}px 0`;
      const underTranslate = `${-0.3 * width * progress * sign}px 0`;
      underElements.forEach((element) => {
        element.style.translate = underTranslate;
      });
      dim.style.opacity = String(DIM_MAX_OPACITY * progress);
    },
    settle(commit, durationMs, currentOffsetPx) {
      // From the release on, whichever way it settles: a tap must not land on what still moves.
      shield ??= mountHoldShield(stage);
      const currentProgress = Math.max(0, Math.min(1, currentOffsetPx / width));
      const shouldCommit =
        commit && isSceneContextCurrent('forward', key, fromLocationKey, startedWithContext);
      if (shouldCommit) {
        capturedPreview = capturePhoneSwipePreviewEntry('room', key, {
          horizontalShiftPx: -0.3 * width * currentProgress * sign,
        });
      }
      const animations: Array<{ element: HTMLElement; keyframes: Keyframe[] }> = [
        ...underElements.map((element) => ({
          element,
          keyframes: [
            { translate: `${-0.3 * width * currentProgress * sign}px 0` },
            { translate: `${shouldCommit ? -0.3 * width * sign : 0}px 0` },
          ],
        })),
        {
          element: dim,
          keyframes: [
            { opacity: String(DIM_MAX_OPACITY * currentProgress) },
            { opacity: String(shouldCommit ? DIM_MAX_OPACITY : 0) },
          ],
        },
      ];
      return settleSwipeWithPreview(
        matchedThread,
        over,
        `${(width - currentOffsetPx) * sign}px 0`,
        `${shouldCommit ? 0 : width * sign}px 0`,
        animations,
        durationMs,
        () => cleanedUp
      );
    },
    commit() {
      if (!isSceneContextCurrent('forward', key, fromLocationKey, startedWithContext)) {
        rollbackCapturedPreview();
        return;
      }
      handedOff = true;
      dim.remove();
      over.removeAttribute('data-swiping');
      overShadowTarget.removeAttribute('data-swipe-shadow');
      clearInlineTransition(over);
      over.style.translate = '0px 0';
      over.setAttribute(SWIPE_PREVIEW, 'hold');
      if (matchedThread && threadPreview?.snapshot === matchedThread) {
        setPreviewSlot('thread', undefined);
      }
      claimInteractivePhoneSlide({
        fromLocationKey,
        holdElement: over,
        holdSnapshot: matchedThread,
        shield,
      });
      clearUnderStyles();
      onCommit();
    },
    cleanup() {
      if (cleanedUp) return;
      cleanedUp = true;
      dim.remove();
      clearUnderStyles();
      if (!handedOff) {
        shield?.remove();
        rollbackCapturedPreview();
        detachPreviewElement(over);
        over.removeAttribute('data-swiping');
        overShadowTarget.removeAttribute('data-swipe-shadow');
        releaseOwnedSnapshot(matchedThread);
      }
    },
  };
};

/**
 * Runs `change`, which may change what a phone shows, and slides when it shows deeper or less
 * deep after it: a thread over its room comes in from the end edge, and a thread or a room leaves
 * to it on the way back to the room or the list, the page under them moving a third as far
 * (phonePageSlide.css.ts). The way back to the list slides only for a navigation (the room
 * header's Back): a person brings the list out over the page without one
 * (`movePhoneNavDrawer`). The page stays put where the list goes away, as it does for a tap on a
 * room in it: the drawer slides away to the start edge on its own over the page the change shows
 * (sidebar/PhoneNavDrawer.css.ts).
 *
 * The slide plays between a still copy of the phone layout as it was (`copyOf`), laid over the
 * layout, and the layout as it is: both move with `translate` under the top bar, which changes no
 * layout, and the copy goes when the slide ends. (Not a view transition: the iOS web view's page
 * process crashed in them.) The copy is taken a frame after the call: `change` waits for that,
 * with every change asked for meanwhile, and they run together, in order and committed before
 * they return. The slide starts once the page that slides in has been drawn. While it plays, the
 * page takes no taps (phonePageSlide.css.ts), and further changes run at once, which the page
 * that slides in shows as they happen.
 *
 * `change` runs at once, and nothing slides, off the phone layout and with reduced motion.
 * Nothing slides either when the change leaves the phone layout, or leaves a dialog open over
 * the page (one that closes with the change, as a search that opens a thread, does not count).
 */
export const slidePhonePage = (change: Change): void => {
  if (waiting) {
    waiting.push(change);
    return;
  }
  // No document: a test that renders without one. A hidden one plays nothing.
  const page = typeof document === 'undefined' ? undefined : document;
  if (
    playing ||
    !page?.querySelector(`[${PHONE_STAGE}]`) ||
    page.visibilityState === 'hidden' ||
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  ) {
    change(false);
    return;
  }

  const root = page.documentElement;
  const from = depth();
  const changes = [change];
  waiting = changes;
  // Marks the page as inside a slide (phonePageSlide.css.ts). Not from the list, which goes away
  // on its own and where nothing slides: the drawer keeps its slide, which the marker would turn
  // off. Its changes still wait for the frame, so the room a tap in the list opens comes with the
  // drawer going away, and a slide asked for meanwhile does not stop the drawer's.
  if (from !== 0) root.dataset.pageSlide = '';
  let frame = 0;
  let timer = 0;
  let copy: HTMLElement | undefined;
  let snapshot: StageSnapshot | undefined;
  let watch: MutationObserver | undefined;
  let ended = false;
  let trace: { direction: string; startedAt: number } | undefined;
  let finish: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const onAnimationEnd = (event: AnimationEvent) => {
    if (event.animationName.startsWith(KEYFRAMES)) end();
  };
  const end = () => {
    if (ended) return;
    ended = true;
    window.cancelAnimationFrame(frame);
    window.clearTimeout(timer);
    watch?.disconnect();
    page.removeEventListener('visibilitychange', end);
    copy?.removeEventListener('animationend', onAnimationEnd);
    copy?.remove();
    const owned = snapshot;
    snapshot = undefined;
    releaseOwnedSnapshot(owned);
    playing = false;
    active = undefined;
    delete root.dataset.pageSlide;
    delete root.dataset.pageSlideHeld;
    finish();
    if (trace) {
      try {
        recordDeepTraceEvent(`navigation.phone_slide.${trace.direction}.end`, {
          duration_ms: Math.round(performance.now() - trace.startedAt),
        });
      } catch {
        // A diagnostics failure must not escape slide cleanup.
      }
    }
  };
  const run = (sliding: boolean) => {
    if (waiting !== changes) return;
    window.cancelAnimationFrame(frame);
    window.clearTimeout(timer);
    waiting = undefined;
    playing = true;
    // Hidden while it waited for its frame: the page changes, and nothing slides.
    const slides = sliding && from !== 0 && page.visibilityState !== 'hidden';
    const shown = slides ? page.querySelector(`[${PHONE_STAGE}]`) : null;
    const departingContext = activeSwipeContext;
    try {
      if (shown) {
        snapshot = captureStageSnapshot(shown);
        ownedSnapshots.add(snapshot);
      }
    } catch {
      // No copy: the page still changes, with nothing sliding.
    }
    try {
      flushSync(() => changes.forEach((each) => each(true)));
    } catch (error) {
      // A change that fails leaves no slide behind: the next one plays.
      end();
      throw error;
    }
    const to = depth();
    const stage = page.querySelector(`[${PHONE_STAGE}]`);
    // Leaving a thread via Back (2 -> 1 or 2 -> 0) no longer needs the room overview snapshot.
    if (from === 2 && to < from && roomPreview) {
      setPreviewSlot('room', undefined);
    }
    // Nothing to slide from the list, nor where the page is as deep as it was, and nothing where
    // the copy would not fit: the phone layout is gone (signed out, turned sideways), or a
    // dialog still open over the page would show under it.
    if (ended || !snapshot || to === from || !stage || hasBlockingPortalOverlay()) {
      end();
      return;
    }
    if (from === 1 && to === 2) {
      const enteredContext = activeSwipeContext;
      if (
        enteredContext?.threadId &&
        departingContext &&
        departingContext.sessionId === enteredContext.sessionId &&
        departingContext.roomId === enteredContext.roomId
      ) {
        storePhoneSwipePreview(
          'room',
          {
            sessionId: enteredContext.sessionId,
            roomId: enteredContext.roomId,
            threadId: enteredContext.threadId,
          },
          snapshot
        );
      } else if (roomPreview) {
        setPreviewSlot('room', undefined);
      }
    } else if (from === 2 && to === 1 && departingContext?.threadId) {
      storePhoneSwipePreview('thread', departingContext, snapshot);
    }
    const direction = to > from ? 'forward' : 'back';
    root.dataset.pageSlide = direction;
    if (isDeepTraceRecording()) {
      try {
        trace = { direction, startedAt: performance.now() };
        recordDeepTraceEvent(`navigation.phone_slide.${direction}.start`);
      } catch {
        // Diagnostics must not strand the input shield before its cleanup is armed.
        trace = undefined;
      }
    }
    copy = mountStageSnapshot(snapshot, stage);
    // The slide is over at once where the phone layout goes while it plays (signed out, turned
    // sideways), which takes the copy or its slide with it, and where the page is hidden.
    watch = new MutationObserver(() => {
      if (!stage.isConnected || !stage.hasAttribute(PHONE_STAGE)) end();
    });
    watch.observe(page, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [PHONE_STAGE],
    });
    page.addEventListener('visibilitychange', end);
    // Held at its start (phonePageSlide.css.ts) until the page that slides in has been drawn: that
    // frame is long, and the slide's clock would run through most of its way before it shows.
    // It starts with the frame after the one that draws the page.
    root.dataset.pageSlideHeld = '';
    frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => delete root.dataset.pageSlideHeld);
    });
    // The copy's own slide ends with the layout's; a tab that is hidden plays neither.
    copy.addEventListener('animationend', onAnimationEnd);
    timer = window.setTimeout(end, PLAY_MS);
  };
  active = {
    finished,
    // As a person's own gesture asks (`movePhoneNavDrawer`): the changes of a slide that waits
    // run after the gesture's handler, and one that plays is over at once.
    skip: () => {
      if (waiting === changes) queueMicrotask(() => run(false));
      else end();
    },
  };
  frame = window.requestAnimationFrame(() => run(true));
  timer = window.setTimeout(() => run(true), FRAME_MS);
};

/**
 * Runs `change` now, or after the changes that wait for a slide's frame: what it sets is how
 * the page is left when they have run.
 */
/** Whether a phone page slide is currently waiting for its frame or playing. */
export const isPhonePageSlideActive = (): boolean => Boolean(waiting || playing || active);

export const afterWaitingSlide = (change: () => void): void => {
  if (waiting) waiting.push(change);
  else change();
};

/**
 * Brings a phone's navigation drawer out or puts it away, as a person does (the menu button, a
 * swipe, Escape): `set` changes it. The drawer is over the page, not a level of it, so nothing
 * slides but the drawer itself (sidebar/PhoneNavDrawer.css.ts).
 *
 * Brought out, it never comes inside a page slide, whose marker turns off the drawer's own slide
 * and whose depth would slide the whole page back. The person's gesture wins: a slide that waits
 * for its frame is skipped (its changes still run, with nothing sliding), one that plays jumps
 * to its end, and the drawer comes out once the slide is over and its marker gone. It stays away
 * if the phone layout went meanwhile (a phone turned sideways), which takes the drawer with it.
 *
 * Put away, it goes through `slidePhonePage`, so a tap on a link in it and the navigation that
 * follows run together from the list, where nothing slides.
 */
export const movePhoneNavDrawer = (
  open: boolean,
  set: (open: boolean) => void
): Promise<void> | undefined => {
  if (!open) {
    slidePhonePage(() => set(false));
    return undefined;
  }
  const slide = active;
  if (!slide) {
    set(true);
    return undefined;
  }
  slide.skip();
  // After the slide's own end (`end` in `slidePhonePage`), which takes its marker away.
  return slide.finished.then(() => {
    if (document.querySelector(`[${PHONE_STAGE}]`)) set(true);
  });
};

/**
 * `router` for `RouterProvider`, which then shows a new location inside a slide
 * (`slidePhonePage`). What the router tells without a new location goes on at once, after a
 * location that still waits for its slide. A step back the browser itself showed sliding (a swipe
 * from the screen's edge in a browser that has one) is left as it is.
 */
export const withPhonePageSlide = (router: Router): Router => {
  let browserSlid = false;
  // In the capture phase: before the router's own listener, which tells of the step.
  router.window?.addEventListener(
    'popstate',
    (event) => {
      browserSlid =
        (event as PopStateEvent & { hasUAVisualTransition?: boolean }).hasUAVisualTransition ===
        true;
    },
    true
  );
  const subscribe: Router['subscribe'] = (listener) => {
    let shown = router.state.location.key;
    activeRouterSubscribers += 1;
    currentPhoneLocationKey = shown;
    const unsubscribe = router.subscribe((state, opts) => {
      const moved = state.location.key !== shown;
      shown = state.location.key;
      currentPhoneLocationKey = shown;
      if (moved && interactiveHandoff) {
        if (
          !interactiveHandoff.consumed &&
          state.location.key !== interactiveHandoff.fromLocationKey
        ) {
          browserSlid = false;
          const handoff = interactiveHandoff;
          handoff.consumed = true;
          try {
            listener(state, { ...opts, flushSync: true });
          } catch (error) {
            handoff.release();
            throw error;
          }
          handoff.finishAfterPaint();
          return;
        }
        if (interactiveHandoff.consumed) {
          interactiveHandoff.release();
        }
      }
      const slides = moved && !(browserSlid && state.historyAction === NavigationType.Pop);
      if (moved) browserSlid = false;
      if (slides) {
        slidePhonePage((sliding) => listener(state, sliding ? { ...opts, flushSync: true } : opts));
      } else afterWaitingSlide(() => listener(state, opts));
    });
    return () => {
      unsubscribe();
      activeRouterSubscribers = Math.max(0, activeRouterSubscribers - 1);
      if (activeRouterSubscribers === 0) currentPhoneLocationKey = undefined;
    };
  };
  // The router's own properties are read through it: they are getters over its state.
  return Object.create(router, { subscribe: { value: subscribe } }) as Router;
};
