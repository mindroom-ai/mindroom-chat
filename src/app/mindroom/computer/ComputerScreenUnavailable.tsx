import { createContext, useContext, useEffect } from 'react';

/** Closes the computer panel; the room (MindroomRoom.tsx) provides it around the panel. */
export const CloseComputerPanelContext = createContext<(() => void) | undefined>(undefined);

/**
 * The computer screen when its chunk could not load: a deployment removed it while this page
 * still ran the old build (the new version notice then says so), or the device went offline
 * before the computer ever opened. The panel closes instead of the app showing its crash screen,
 * and the next open loads the screen again.
 */
export function ComputerScreenUnavailable() {
  const closePanel = useContext(CloseComputerPanelContext);
  useEffect(() => closePanel?.(), [closePanel]);
  return null;
}
