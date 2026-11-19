import { createContext, type MutableRefObject } from 'react';

// A phone's room header holds the open thread's title and status, so its height changes under a
// reader. The layout that measures it hands each `change` to the thread's timeline, set here,
// which reads its place, applies the new inset (`setInset`) and holds its reader's row.
export type HeaderResizeHold = MutableRefObject<
  ((change: number, setInset: () => void) => void) | undefined
>;
export const HeaderResizeHoldContext = createContext<HeaderResizeHold | undefined>(undefined);
