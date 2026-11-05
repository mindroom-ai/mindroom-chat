import { createContext, useContext } from 'react';

/**
 * Whether the signed-in layout shows its pages and side panels as floating cards (wherever the
 * navigation and the content share the screen). A panel that paints its own container color
 * takes the cards' surface then.
 */
export const FloatingCardsContext = createContext(false);

export const useFloatingCards = (): boolean => useContext(FloatingCardsContext);
