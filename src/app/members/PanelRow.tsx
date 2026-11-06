import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { Box } from 'folds';
import { CONVERSATION_MIN_WIDTH } from '../ui/panels/ResizablePanel';
import { MembersOverlayProvider } from './useMembersDrawer';

/** The members panel's default width (ResizableMembersPanel) beside the conversation's minimum. */
const MEMBERS_BESIDE_MIN_WIDTH = 266 + CONVERSATION_MIN_WIDTH;

/**
 * The row a room or a lobby lays out in: the conversation, and a side panel beside it. Narrower
 * than the members panel and the conversation together, it shows the members over the
 * conversation instead (useMembersDrawer). It measures itself before its content mounts, so the
 * members start where they belong instead of moving there.
 */
export function PanelRow({ children }: { children: ReactNode }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [overlay, setOverlay] = useState<boolean>();

  useLayoutEffect(() => {
    const row = rowRef.current;
    // A row without a layout (hidden, or a test renderer) keeps the members beside it.
    const measure = () =>
      setOverlay(!!row && row.clientWidth > 0 && row.clientWidth < MEMBERS_BESIDE_MIN_WIDTH);
    measure();
    if (!row || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  return (
    <Box ref={rowRef} grow="Yes" style={{ minWidth: 0, minHeight: 0 }}>
      {overlay !== undefined && (
        <MembersOverlayProvider value={overlay}>{children}</MembersOverlayProvider>
      )}
    </Box>
  );
}
