import { createContext, useContext } from 'react';
import type { PanelLayout } from './roomPanels';

/** The frame around a room's side panel: the panel's name, its layout, and how to change it. */
export type PanelFrame = {
  label: string;
  layout: PanelLayout;
  setLayout: (layout: PanelLayout) => void;
};

const PanelFrameContext = createContext<PanelFrame | undefined>(undefined);

/**
 * Frames the side panel inside: ResizablePanel draws the frame (PanelFrame.tsx), or a plugin's
 * panel with `frame: 'own'` draws its own. A panel outside one has none. Apart from the strip, so
 * the client SDK's `usePanelFrame` loads without it.
 */
export const PanelFrameProvider = PanelFrameContext.Provider;
export const usePanelFrame = (): PanelFrame | undefined => useContext(PanelFrameContext);
