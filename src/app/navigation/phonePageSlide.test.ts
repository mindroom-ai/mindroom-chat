// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const overlay = vi.hoisted(() => ({ open: false }));
vi.mock('../lib/portalOverlay', () => ({ hasBlockingPortalOverlay: () => overlay.open }));

const traceState = vi.hoisted(() => ({
  recording: false,
  events: [] as Array<{ name: string; data?: Record<string, unknown> }>,
}));
vi.mock('../diagnostics/deepTrace', () => ({
  isDeepTraceRecording: () => traceState.recording,
  recordDeepTraceEvent: (name: string, data?: Record<string, unknown>) => {
    traceState.events.push({ name, data });
  },
}));

import {
  canPlayLiveSlide,
  completeLiveSlideHandoff,
  createLiveBackSwipeScene,
  createLiveForwardSwipeScene,
  isLiveSlideActive,
  PHONE_PAGE,
  PHONE_STAGE,
  playLiveSlide,
  skipActiveLiveSlide,
  SWIPE_OVER_THREAD,
  SWIPE_THREAD_STAGE,
  SWIPE_UNDER_THREAD,
} from './phonePageSlide';

type MockAnimationRecord = {
  element: HTMLElement;
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions | undefined;
  finish: () => void;
  cancel: ReturnType<typeof vi.fn>;
};

const rectOf = (width: number, height = 800): DOMRect =>
  ({
    width,
    height,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }) as DOMRect;

const createLiveStage = (width = 390) => {
  const stage = document.createElement('div');
  stage.setAttribute(SWIPE_THREAD_STAGE, '');
  const under = document.createElement('div');
  under.setAttribute(SWIPE_UNDER_THREAD, '');
  const over = document.createElement('div');
  stage.append(under, over);
  document.body.append(stage);
  vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue(rectOf(width));
  return { stage, under, over };
};

const createPhoneStage = (width = 390, topBarHeight = 52) => {
  const stage = document.createElement('div');
  stage.setAttribute(PHONE_STAGE, '');
  const topBar = document.createElement('div');
  topBar.setAttribute('data-phone-top-bar', '');
  const page = document.createElement('div');
  page.setAttribute(PHONE_PAGE, '');
  stage.append(topBar, page);
  document.body.append(stage);
  vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue(rectOf(width));
  vi.spyOn(topBar, 'getBoundingClientRect').mockReturnValue(rectOf(width, topBarHeight));
  return { stage, topBar, page };
};

const installDeferredAnimate = () => {
  const records: MockAnimationRecord[] = [];
  const original = HTMLElement.prototype.animate;
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true,
    value(this: HTMLElement, keyframes: Keyframe[], options?: KeyframeAnimationOptions) {
      let finish: () => void = () => undefined;
      const finished = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const cancel = vi.fn();
      records.push({ element: this, keyframes, options, finish, cancel });
      return { finished, cancel } as unknown as Animation;
    },
  });
  return {
    records,
    finishAll: async () => {
      const current = records.splice(0, records.length);
      current.forEach((record) => record.finish());
      await Promise.resolve();
      await Promise.resolve();
    },
    restore: () => {
      Object.defineProperty(HTMLElement.prototype, 'animate', {
        configurable: true,
        value: original,
      });
    },
  };
};

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const setReducedMotion = (reduced: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: reduced && query === '(prefers-reduced-motion: reduce)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
};

beforeEach(() => {
  overlay.open = false;
  traceState.recording = false;
  traceState.events = [];
  setReducedMotion(false);
  document.documentElement.removeAttribute('dir');
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

afterEach(() => {
  skipActiveLiveSlide();
  document.body.replaceChildren();
  document.documentElement.removeAttribute('dir');
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('playLiveSlide', () => {
  it('waits double-rAF on forward push, animates 280 ms Standard curve with shield and deepTrace, then cleans up', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame'] });
    const anim = installDeferredAnimate();
    traceState.recording = true;
    const { stage, under, over } = createLiveStage(390);
    const exit = vi.fn();

    try {
      const handle = playLiveSlide({ direction: 'forward', stage, over, under, exit });
      expect(isLiveSlideActive()).toBe(true);
      expect(over.hasAttribute(SWIPE_OVER_THREAD)).toBe(true);
      expect(over.hasAttribute('data-swipe-shadow')).toBe(true);
      expect(over.style.translate).toBe('390px');
      expect(under.style.translate).toBe('0px');
      expect(stage.querySelector('[data-swipe-hold-shield]')).not.toBeNull();
      expect(stage.querySelector('[data-swipe-dim]')).not.toBeNull();
      expect(traceState.events.map((e) => e.name)).toEqual([
        'navigation.phone_slide.forward.start',
      ]);

      // First rAF: still waiting for second paint frame before starting 280 ms clock.
      vi.advanceTimersToNextFrame();
      expect(anim.records).toHaveLength(0);

      // Second rAF: animation starts with exact 280 ms Standard curve and iMessage parallax.
      vi.advanceTimersToNextFrame();
      expect(anim.records).toHaveLength(3);
      const overAnim = anim.records.find((r) => r.element === over)!;
      const underAnim = anim.records.find((r) => r.element === under)!;
      const dimAnim = anim.records.find((r) => r.element.hasAttribute('data-swipe-dim'))!;
      expect(overAnim.options).toMatchObject({
        duration: 280,
        easing: 'cubic-bezier(0.2, 0, 0, 1)',
      });
      expect(overAnim.keyframes).toEqual([{ translate: '390px 0' }, { translate: '0px 0' }]);
      expect(underAnim.keyframes).toEqual([{ translate: '0px 0' }, { translate: '-117px 0' }]);
      expect(dimAnim.keyframes).toEqual([{ opacity: '0' }, { opacity: '0.12' }]);

      await anim.finishAll();
      await handle.finished;

      expect(isLiveSlideActive()).toBe(false);
      expect(exit).toHaveBeenCalledWith(true);
      expect(over.style.translate).toBe('');
      expect(under.style.translate).toBe('');
      expect(over.hasAttribute(SWIPE_OVER_THREAD)).toBe(false);
      expect(over.hasAttribute('data-swipe-shadow')).toBe(false);
      expect(stage.querySelector('[data-swipe-dim]')).toBeNull();
      expect(stage.querySelector('[data-swipe-hold-shield]')).toBeNull();
      expect(traceState.events.map((e) => e.name)).toEqual([
        'navigation.phone_slide.forward.start',
        'navigation.phone_slide.forward.end',
      ]);
    } finally {
      anim.restore();
    }
  });

  it('mirrors forward and back slide keyframes in RTL', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame'] });
    document.documentElement.dir = 'rtl';
    const anim = installDeferredAnimate();
    const { stage, under, over } = createLiveStage(400);

    try {
      const fwd = playLiveSlide({ direction: 'forward', stage, over, under, exit: vi.fn() });
      vi.advanceTimersToNextFrame();
      vi.advanceTimersToNextFrame();
      expect(anim.records.find((r) => r.element === over)?.keyframes).toEqual([
        { translate: '-400px 0' },
        { translate: '0px 0' },
      ]);
      expect(anim.records.find((r) => r.element === under)?.keyframes).toEqual([
        { translate: '0px 0' },
        { translate: '120px 0' },
      ]);
      await anim.finishAll();
      await fwd.finished;

      const back = playLiveSlide({ direction: 'back', stage, over, under, exit: vi.fn() });
      expect(anim.records.find((r) => r.element === over)?.keyframes).toEqual([
        { translate: '0px 0' },
        { translate: '-400px 0' },
      ]);
      expect(anim.records.find((r) => r.element === under)?.keyframes).toEqual([
        { translate: '120px 0' },
        { translate: '0px 0' },
      ]);
      await anim.finishAll();
      await back.finished;
    } finally {
      anim.restore();
    }
  });

  it('defers onCommit on back slide until over reaches offscreen and holds shield across async commit handoff', async () => {
    const anim = installDeferredAnimate();
    traceState.recording = true;
    const { stage, under, over } = createLiveStage(390);
    const onCommit = vi.fn();
    const exit = vi.fn();

    try {
      const handle = playLiveSlide({ direction: 'back', stage, over, under, exit, onCommit });
      expect(anim.records).toHaveLength(3);
      expect(onCommit).not.toHaveBeenCalled();
      expect(stage.querySelector('[data-swipe-hold-shield]')).not.toBeNull();

      await anim.finishAll();
      expect(onCommit).toHaveBeenCalledTimes(1);
      // Handoff keeps over hidden offscreen and shield mounted while async history.back() settles.
      expect(over.style.visibility).toBe('hidden');
      expect(over.style.translate).toBe('390px');
      expect(stage.querySelector('[data-swipe-hold-shield]')).not.toBeNull();
      expect(exit).not.toHaveBeenCalled();

      completeLiveSlideHandoff();
      await handle.finished;

      expect(isLiveSlideActive()).toBe(false);
      expect(exit).toHaveBeenCalledWith(true);
      expect(stage.querySelector('[data-swipe-hold-shield]')).toBeNull();
      expect(over.style.visibility).toBe('');
      expect(traceState.events.map((e) => e.name)).toEqual([
        'navigation.phone_slide.back.start',
        'navigation.phone_slide.back.end',
      ]);
    } finally {
      anim.restore();
    }
  });

  it('releases back commit handoff immediately when over disconnects, and falls back on timeout if stalled', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const anim = installDeferredAnimate();

    try {
      // 1. Over unmounts synchronously inside onCommit.
      const first = createLiveStage(390);
      const exit1 = vi.fn();
      const h1 = playLiveSlide({
        direction: 'back',
        ...first,
        exit: exit1,
        onCommit: () => first.over.remove(),
      });
      await anim.finishAll();
      await h1.finished;
      expect(exit1).toHaveBeenCalledWith(true);
      expect(first.stage.querySelector('[data-swipe-hold-shield]')).toBeNull();

      // 2. Stalled handoff (route never changes): releases after safety timeout with committed=false.
      const second = createLiveStage(390);
      const exit2 = vi.fn();
      const h2 = playLiveSlide({
        direction: 'back',
        ...second,
        exit: exit2,
        onCommit: vi.fn(),
      });
      await anim.finishAll();
      expect(exit2).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1000);
      await h2.finished;
      expect(exit2).toHaveBeenCalledWith(false);
      expect(second.stage.querySelector('[data-swipe-hold-shield]')).toBeNull();
      expect(second.over.style.visibility).toBe('');
    } finally {
      anim.restore();
    }
  });

  it('skipActiveLiveSlide and external popstate/visibilitychange cancel deferred onCommit immediately', async () => {
    const anim = installDeferredAnimate();

    try {
      // 1. skipActiveLiveSlide() mid-back-slide (e.g. drawer open or Universal Link).
      const s1 = createLiveStage(390);
      const onCommit1 = vi.fn();
      const exit1 = vi.fn();
      const h1 = playLiveSlide({ direction: 'back', ...s1, exit: exit1, onCommit: onCommit1 });
      skipActiveLiveSlide();
      await h1.finished;
      expect(onCommit1).not.toHaveBeenCalled();
      expect(exit1).toHaveBeenCalledWith(false);
      expect(s1.stage.querySelector('[data-swipe-hold-shield]')).toBeNull();

      // 2. External popstate mid-back-slide cancels without firing deferred onCommit.
      const s2 = createLiveStage(390);
      const onCommit2 = vi.fn();
      const exit2 = vi.fn();
      const h2 = playLiveSlide({ direction: 'back', ...s2, exit: exit2, onCommit: onCommit2 });
      window.dispatchEvent(new PopStateEvent('popstate'));
      await h2.finished;
      expect(onCommit2).not.toHaveBeenCalled();
      expect(exit2).toHaveBeenCalledWith(false);

      // 3. Tab hide mid-back-slide cancels without firing deferred onCommit.
      const s3 = createLiveStage(390);
      const onCommit3 = vi.fn();
      const exit3 = vi.fn();
      const h3 = playLiveSlide({ direction: 'back', ...s3, exit: exit3, onCommit: onCommit3 });
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      await h3.finished;
      expect(onCommit3).not.toHaveBeenCalled();
      expect(exit3).toHaveBeenCalledWith(false);
    } finally {
      anim.restore();
    }
  });

  it('respects prefers-reduced-motion, hasUAVisualTransition, and blocking portal overlays', async () => {
    const anim = installDeferredAnimate();
    createPhoneStage(390);
    const { stage, under, over } = createLiveStage(390);

    try {
      // 1. prefers-reduced-motion skips animation immediately.
      setReducedMotion(true);
      expect(canPlayLiveSlide()).toBe(false);
      const exitReduced = vi.fn();
      const commitReduced = vi.fn();
      await playLiveSlide({
        direction: 'back',
        stage,
        over,
        under,
        exit: exitReduced,
        onCommit: commitReduced,
      }).finished;
      expect(anim.records).toHaveLength(0);
      expect(commitReduced).toHaveBeenCalledTimes(1);
      expect(exitReduced).toHaveBeenCalledWith(true);

      // 2. hasUAVisualTransition cancels any active slide and skips animation for that popstate.
      setReducedMotion(false);
      expect(canPlayLiveSlide()).toBe(true);
      const uaEvent = new PopStateEvent('popstate');
      Object.defineProperty(uaEvent, 'hasUAVisualTransition', { value: true });
      window.dispatchEvent(uaEvent);
      expect(canPlayLiveSlide()).toBe(false);
      const exitUA = vi.fn();
      await playLiveSlide({ direction: 'forward', stage, over, under, exit: exitUA }).finished;
      expect(anim.records).toHaveLength(0);
      expect(exitUA).toHaveBeenCalledWith(true);
      await flushMicrotasks();
      expect(canPlayLiveSlide()).toBe(true);

      // 3. Blocking portal overlay suppresses slides.
      overlay.open = true;
      expect(canPlayLiveSlide()).toBe(false);
      const exitOverlay = vi.fn();
      await playLiveSlide({ direction: 'forward', stage, over, under, exit: exitOverlay }).finished;
      expect(anim.records).toHaveLength(0);
      expect(exitOverlay).toHaveBeenCalledWith(true);
    } finally {
      anim.restore();
    }
  });
});

describe('createLiveBackSwipeScene & createLiveForwardSwipeScene', () => {
  it('tracks live 2-layer back swipe 1:1 with zero clones, handles cancel and commit handoff', async () => {
    const { stage, under, over } = createLiveStage(390);
    const exit = vi.fn();
    const onCommit = vi.fn();

    const cancelScene = createLiveBackSwipeScene({
      enterLiveUnder: () => ({ stage, under, over, exit }),
      onCommit,
      dirSign: 1,
    })!;
    expect(cancelScene.extent).toBe(390);
    expect(over.hasAttribute('data-swipe-shadow')).toBe(true);
    expect(under.style.translate).toBe('-117px');

    cancelScene.update(195, 0.5);
    expect(over.style.translate).toBe('195px');
    expect(under.style.translate).toBe('-58.5px');
    expect(stage.querySelector<HTMLElement>('[data-swipe-dim]')?.style.opacity).toBe('0.06');

    await cancelScene.settle(false, 0, 195);
    cancelScene.cleanup(false);
    expect(exit).toHaveBeenCalledWith(false);
    expect(onCommit).not.toHaveBeenCalled();
    expect(over.style.translate).toBe('');
    expect(under.style.translate).toBe('');
    expect(stage.querySelector('[data-swipe-hold-shield]')).toBeNull();

    // Commit path holds shield & hides over offscreen until completeLiveSlideHandoff().
    exit.mockClear();
    const commitScene = createLiveBackSwipeScene({
      enterLiveUnder: () => ({ stage, under, over, exit }),
      onCommit,
      dirSign: 1,
    })!;
    commitScene.update(300, 300 / 390);
    await commitScene.settle(true, 0, 300);
    commitScene.commit();
    commitScene.cleanup(true);

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(over.style.visibility).toBe('hidden');
    expect(stage.querySelector('[data-swipe-hold-shield]')).not.toBeNull();
    expect(exit).not.toHaveBeenCalled();

    completeLiveSlideHandoff();
    expect(exit).toHaveBeenCalledWith(true);
    expect(over.style.visibility).toBe('');
    expect(stage.querySelector('[data-swipe-hold-shield]')).toBeNull();
  });

  it('falls back cleanly to a lightweight neutral backdrop on cold reload when enterLiveUnder returns null', async () => {
    const { stage, page } = createPhoneStage(390, 52);
    const onCommit = vi.fn();

    const scene = createLiveBackSwipeScene({
      enterLiveUnder: () => null,
      onCommit,
      dirSign: 1,
    })!;
    expect(scene).not.toBeNull();
    const backdrop = stage.querySelector<HTMLElement>('[data-swipe-backdrop]');
    expect(backdrop).not.toBeNull();
    expect(backdrop?.style.insetBlockStart).toBe('52px');
    expect(backdrop?.childElementCount).toBe(0);

    scene.update(120, 120 / 390);
    expect(page.style.translate).toBe('120px');

    await scene.settle(true, 0, 120);
    scene.commit();
    scene.cleanup(true);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(page.style.visibility).toBe('hidden');

    completeLiveSlideHandoff();
    expect(stage.querySelector('[data-swipe-backdrop]')).toBeNull();
    expect(stage.querySelector('[data-swipe-hold-shield]')).toBeNull();
    expect(page.style.visibility).toBe('');
  });

  it('tracks live end-edge forward swipe 1:1 from +100% over under-layer, supporting cancel and flicker-free commit', async () => {
    const { stage, under, over } = createLiveStage(400);
    const exit = vi.fn();
    const onCommit = vi.fn();

    // Cancel path.
    const cancelScene = createLiveForwardSwipeScene({
      enterLiveOver: () => ({ stage, under, over, exit }),
      onCommit,
      dirSign: 1,
    })!;
    expect(over.style.translate).toBe('400px');
    expect(under.style.translate).toBe('0px');

    cancelScene.update(200, 0.5);
    expect(over.style.translate).toBe('200px');
    expect(under.style.translate).toBe('-60px');
    expect(stage.querySelector<HTMLElement>('[data-swipe-dim]')?.style.opacity).toBe('0.06');

    await cancelScene.settle(false, 0, 200);
    cancelScene.cleanup(false);
    expect(exit).toHaveBeenCalledWith(false);
    expect(onCommit).not.toHaveBeenCalled();

    // Commit path keeps over visible at 0 without hiding until completeLiveSlideHandoff().
    exit.mockClear();
    const commitScene = createLiveForwardSwipeScene({
      enterLiveOver: () => ({ stage, under, over, exit }),
      onCommit,
      dirSign: -1, // RTL check too!
    })!;
    expect(over.style.translate).toBe('-400px');
    commitScene.update(300, 0.75);
    expect(over.style.translate).toBe('-100px');
    expect(under.style.translate).toBe('90px');

    await commitScene.settle(true, 0, 300);
    commitScene.commit();
    commitScene.cleanup(true);

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(over.style.visibility).toBe('');
    expect(over.style.translate).toBe('');
    expect(stage.querySelector('[data-swipe-hold-shield]')).not.toBeNull();
    expect(exit).not.toHaveBeenCalled();

    completeLiveSlideHandoff();
    expect(exit).toHaveBeenCalledWith(true);
    expect(stage.querySelector('[data-swipe-hold-shield]')).toBeNull();
  });
});
