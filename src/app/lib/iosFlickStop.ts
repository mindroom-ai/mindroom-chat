import { isIOS } from './user-agent';

type AnimationFrameView = Pick<Window, 'requestAnimationFrame' | 'cancelAnimationFrame'>;

type ActiveFlickStop = {
  overflowY: string;
  frame: number;
  view: AnimationFrameView;
};

const activeFlickStops = new WeakMap<HTMLElement, ActiveFlickStop>();

const noop = (): void => undefined;

/** Whether `element` currently has its inline overflow hidden by `stopIOSFlick`. */
export const isIOSFlickStopped = (element: HTMLElement): boolean => activeFlickStops.has(element);

/** Restores `element` immediately if an iOS flick-stop is active on it. */
export const restoreIOSFlick = (element: HTMLElement | null | undefined): void => {
  if (!element) return;
  const stopped = activeFlickStops.get(element);
  if (!stopped) return;
  activeFlickStops.delete(element);
  stopped.view.cancelAnimationFrame(stopped.frame);
  element.style.overflowY = stopped.overflowY;
};

/**
 * Stops an active iOS momentum flick on `element` before a programmatic scroll write by hiding its
 * vertical overflow for two animation frames, then restoring its original inline `overflowY`.
 * Shared across callers via a WeakMap so overlapping stops on the same element never save
 * `hidden` as the original value. No-op on non-iOS platforms.
 */
export const stopIOSFlick = (
  element: HTMLElement | null | undefined,
  view?: AnimationFrameView | null
): (() => void) => {
  if (!element || !isIOS()) return noop;
  restoreIOSFlick(element);
  const rafView: AnimationFrameView = view ?? element.ownerDocument?.defaultView ?? globalThis;
  const stopped: ActiveFlickStop = {
    overflowY: element.style.overflowY,
    frame: 0,
    view: rafView,
  };
  activeFlickStops.set(element, stopped);
  element.style.overflowY = 'hidden';
  stopped.frame = rafView.requestAnimationFrame(() => {
    if (activeFlickStops.get(element) !== stopped) return;
    stopped.frame = rafView.requestAnimationFrame(() => {
      if (activeFlickStops.get(element) === stopped) {
        restoreIOSFlick(element);
      }
    });
  });
  return () => {
    if (activeFlickStops.get(element) === stopped) {
      restoreIOSFlick(element);
    }
  };
};
