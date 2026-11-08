import { createContext, useContext, type KeyboardEvent } from 'react';

/** What the call view spreads on its title bar to make it the window's drag handle. */
export type CallWindowHandleProps = {
  'data-call-window-handle': '';
  tabIndex: 0;
  'aria-label': string;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
};

/** The floating window around the call view: whether it is the one-line bar, and its controls. */
export type CallWindowFrame = {
  bar: boolean;
  minimize: () => void;
  expand: () => void;
  handleProps: CallWindowHandleProps;
};

// The call view mounts after the frame (it loads lazily), so the frame hands it the handle's props
// instead of looking for its title bar.
export const CallWindowFrameContext = createContext<CallWindowFrame | undefined>(undefined);

/** The floating frame around the call view; undefined in the docked panel and on phones. */
export const useCallWindowFrame = (): CallWindowFrame | undefined =>
  useContext(CallWindowFrameContext);
