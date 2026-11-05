import { createContext, useContext } from 'react';
import type { Room } from 'matrix-js-sdk';

const SpaceContext = createContext<Room | null>(null);
SpaceContext.displayName = 'Space';

/** Provides the space whose pages render below it. */
export const { Provider: SpaceProvider } = SpaceContext;

/** The surrounding space, or undefined outside space pages. */
export function useSpaceOptionally(): Room | undefined {
  return useContext(SpaceContext) ?? undefined;
}

/** The space of the surrounding space page; calling it elsewhere is a programming error. */
export function useSpace(): Room {
  const space = useSpaceOptionally();
  if (!space) throw new Error('useSpace() needs a SpaceProvider above it');
  return space;
}
