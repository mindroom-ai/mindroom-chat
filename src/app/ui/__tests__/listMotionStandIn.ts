import { vi } from 'vitest';

export const ROW_HEIGHT = 100;
export const ROW_WIDTH = 300;
export const FRAME_MS = 16;

export type MotionPlay = {
  element: HTMLElement;
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
  animation: { playState: AnimationPlayState; currentTime: number };
};

/**
 * What a list in motion (ui/listMotion.tsx) needs and jsdom lacks: a layout and Web Animations.
 * The rows (`data-motion-row`) stack in one column, `ROW_HEIGHT` apart; an element stands where
 * the row it is, is inside of, or holds first stands. `plays` holds every animation started, none
 * of which ends before `finish()`, and each can be paused and played on; `cancel` counts the
 * animations cancelled. As in a browser, a play runs on after `pause()` until the next frame
 * (`frame()`, which moves every play that runs on by `FRAME_MS`), unless its `currentTime` is set
 * meanwhile. Call `restore()` after each test.
 */
export const standInForListMotion = () => {
  const plays: MotionPlay[] = [];
  const finishes: (() => void)[] = [];
  const frames: (() => void)[] = [];
  const cancel = vi.fn();
  const rects = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function rect(this: HTMLElement) {
      const row = this.closest('[data-motion-row]') ?? this.querySelector('[data-motion-row]');
      const index = row ? [...document.querySelectorAll('[data-motion-row]')].indexOf(row) : -1;
      const top = Math.max(index, 0) * ROW_HEIGHT;
      const size = index < 0 ? { width: 0, height: 0 } : { width: ROW_WIDTH, height: ROW_HEIGHT };
      return { top, left: 0, bottom: top + size.height, right: size.width, ...size } as DOMRect;
    });
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true,
    writable: true,
    value(this: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
      let abort: () => void = () => undefined;
      let time = 0;
      let pausing = false;
      frames.push(() => {
        if (animation.playState === 'running' || pausing) time += FRAME_MS;
        pausing = false;
      });
      const animation = {
        playState: 'running' as AnimationPlayState,
        get currentTime() {
          return time;
        },
        set currentTime(value: number) {
          time = value;
          pausing = false;
        },
        effect: {
          target: this,
          getKeyframes: () => play.keyframes,
          setKeyframes: (next: Keyframe[]) => {
            play.keyframes = next;
          },
        },
        finished: new Promise<void>((resolve, reject) => {
          finishes.push(() => {
            if (animation.playState === 'running') animation.playState = 'finished';
            resolve();
          });
          abort = () => reject(new Error('cancelled'));
        }),
        cancel: () => {
          cancel();
          animation.playState = 'idle';
          abort();
        },
        pause: () => {
          if (animation.playState !== 'running') return;
          animation.playState = 'paused';
          pausing = true;
        },
        play: () => {
          if (animation.playState === 'paused') animation.playState = 'running';
        },
      };
      const play: MotionPlay = { element: this, keyframes, options, animation };
      plays.push(play);
      // As in a browser, an animation that is cancelled never finishes, which is no error
      // when nothing waits for it.
      animation.finished.catch(() => undefined);
      return animation;
    },
  });
  return {
    plays,
    cancel,
    rects,
    /** The rows that glided: played their place alone, by their key. */
    glided: () =>
      plays
        .filter(({ keyframes }) => Object.keys(keyframes[0] ?? {}).join() === 'translate')
        .map(({ element }) => element.dataset.motionRow),
    /** The rows that left and fade as copies outside the rows. */
    left: () =>
      plays.filter(({ element }) => element.hasAttribute('inert')).map((play) => play.element),
    /** The browser's next frame. */
    frame: () => frames.forEach((advance) => advance()),
    finish: async () => {
      finishes.splice(0).forEach((resolve) => resolve());
      await Promise.resolve();
    },
    restore: () => {
      rects.mockRestore();
      Reflect.deleteProperty(HTMLElement.prototype, 'animate');
    },
  };
};
