import { createContext } from 'react';

/**
 * What the room page offers for a second thread beside the one it shows: whether a thread may open
 * there (`offers`, false for a thread the page already shows), and opening it. Absent off a room
 * page and on phones, where no second thread shows.
 */
export type SecondThreadControl = {
  offers: (rootId: string) => boolean;
  open: (rootId: string) => void;
};

export const SecondThreadContext = createContext<SecondThreadControl | undefined>(undefined);
