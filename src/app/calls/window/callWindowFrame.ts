import { createContext, useContext, type KeyboardEvent } from 'react';

/** What the call view spreads on its title bar to make it the window's drag handle. */
export type CallWindowHandleProps = {
  'data-call-window-handle': '';
  tabIndex: 0;
  // Screen readers read the name of a focused element only when it has a role.
  role: 'group';
  'aria-label': string;
  /** The keys that move and size the window, so assistive technology can tell them. */
  'aria-keyshortcuts': string;
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

/** The floating window's size (px) as it stands, a drag's included. */
export type CallWindowSize = { width: number; height: number };

// Apart from the frame: moving the window renders nothing of the call view, and resizing it
// renders only what lays itself out by its size (the live transcript).
export const CallWindowSizeContext = createContext<CallWindowSize | undefined>(undefined);

/** The floating window's size; undefined in the docked panel and on phones. */
export const useCallWindowSize = (): CallWindowSize | undefined =>
  useContext(CallWindowSizeContext);
