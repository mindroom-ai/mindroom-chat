import { createContext } from 'react';

/**
 * What the room page offers for a second thread beside the one it shows: whether a thread of the
 * room `roomId` may open there (`offers`, false for another room's or a thread the page already
 * shows), and opening it. Absent off a room page and on phones, where no second thread shows.
 */
export type SecondThreadControl = {
  offers: (roomId: string, rootId: string) => boolean;
  open: (roomId: string, rootId: string) => void;
};

export const SecondThreadContext = createContext<SecondThreadControl | undefined>(undefined);
