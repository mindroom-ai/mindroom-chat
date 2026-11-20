import { createContext, useContext, useSyncExternalStore } from 'react';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';
import { shortViewport } from '../styles/shortViewport';

/**
 * Whether the signed-in layout shows its pages and side panels as floating cards (wherever the
 * navigation and the content share the screen). A panel that paints its own container color
 * takes the cards' surface then.
 */
export const FloatingCardsContext = createContext(false);

export const useFloatingCards = (): boolean => useContext(FloatingCardsContext);

const subscribeShortViewport = (onChange: () => void) => {
  if (typeof matchMedia !== 'function') return () => undefined;
  const query = matchMedia(shortViewport);
  query.addEventListener?.('change', onChange);
  return () => query.removeEventListener?.('change', onChange);
};

const isShortViewport = () => typeof matchMedia === 'function' && matchMedia(shortViewport).matches;

/** Whether the screen is short (a phone held sideways), following changes. */
export const useShortViewport = (): boolean =>
  useSyncExternalStore(subscribeShortViewport, isShortViewport, () => false);

/**
 * Whether this screen floats the content as cards: wider than a phone, and not a phone held
 * sideways, whose short screen keeps every pixel for the conversation.
 */
export const useFloatingCardsLayout = (): boolean => {
  const mobile = useScreenSizeContext() === ScreenSize.Mobile;
  const short = useShortViewport();
  return !mobile && !short;
};
