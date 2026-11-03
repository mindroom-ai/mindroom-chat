import { createContext, useContext } from 'react';
import type { Room } from 'matrix-js-sdk';

const SpaceContext = createContext<Room | null>(null);
SpaceContext.displayName = 'Space';

/** Provides the space whose pages render below it. */





  if (space === null) throw new Error('useSpace() needs a SpaceProvider above it');
  return space;
}

/** The surrounding space, or undefined outside space pages. */
export function useSpaceOptionally(): Room | undefined {
  return useContext(SpaceContext) ?? undefined;
}
