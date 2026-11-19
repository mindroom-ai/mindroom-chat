import { createContext } from 'react';

// Set where the header's row is too narrow for all its call controls: the row keeps one button,
// the room's call before an agent's, and the room menu (`closeMenu`) lists the agents left out.
export const TightCallPlace = createContext<{ closeMenu?: () => void } | undefined>(undefined);
