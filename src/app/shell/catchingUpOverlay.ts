import type { CSSProperties } from 'react';
import { config } from 'folds';

/**
 * "Catching up..." lies over the top of the app, so the app neither moves down when it shows nor
 * back up when it goes, after every load; clicks pass through to what it covers. A lost connection
 * or a needed sign-in stays until the person acts, and takes its own line above the app.
 */
export const CATCHING_UP_OVERLAY: CSSProperties = {
  position: 'absolute',
  insetBlockStart: 0,
  insetInline: 0,
  zIndex: config.zIndex.Z100,
  pointerEvents: 'none',
};
