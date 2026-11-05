import { createContext, useContext, useSyncExternalStore } from 'react';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { shortViewport } from '../../mindroom/threads/shortViewport';

/**
 * Whether the signed-in layout shows its pages and side panels as floating cards (wherever the
 * navigation and the content share the screen). A panel that paints its own container color
 * takes the cards' surface then.
 */
export const FloatingCardsContext = createContext(false);

export const useFloatingCards = (): boolean => useContext(FloatingCardsContext);

const subscribeShortViewport = (onChange: () => void) => {
  if (typeof window.matchMedia !== 'function') return () => undefined;
  const query = window.matchMedia(shortViewport);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};

const isShortViewport = () =>
  typeof window.matchMedia === 'function' && window.matchMedia(shortViewport).matches;

/**
 * Whether this screen floats the content as cards: wider than a phone, and not a phone held
 * sideways, whose short screen keeps every pixel for the conversation.
 */
export const useFloatingCardsLayout = (): boolean => {
  const mobile = useScreenSizeContext() === ScreenSize.Mobile;
  const short = useSyncExternalStore(subscribeShortViewport, isShortViewport, () => false);
  return !mobile && !short;
};
