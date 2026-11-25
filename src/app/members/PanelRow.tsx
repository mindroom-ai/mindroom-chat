import {
  createContext,
  type CSSProperties,
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Box } from 'folds';
import { CONVERSATION_MIN_WIDTH } from '../ui/panels/ResizablePanel';

/**
 * True inside a room or a lobby too narrow to show the members beside the conversation: there
 * the members lie over it, as on a phone (useMembersDrawer, ResizableMembersPanel).
 */
const MembersOverlayContext = createContext(false);
export const useMembersOverlay = (): boolean => useContext(MembersOverlayContext);

/**
 * True inside a row that laid out too narrow to read the conversation beside the members: there
 * they start closed (useMembersDrawer). Once the row is wide it stays false, so a resize, a stream
 * or a table never closes members already shown.
 */
const MembersStartClosedContext = createContext(false);
export const useMembersStartClosed = (): boolean => useContext(MembersStartClosedContext);

/**
 * The width of the row the room lays out in now, measured before its content mounts; 0 outside a
 * row or before it has a layout. A function, so the row's resizes render nothing.
 */
const RowWidthContext = createContext<() => number>(() => 0);
export const usePanelRowWidth = (): (() => number) => useContext(RowWidthContext);

/** The members panel's default width (ResizableMembersPanel) beside the conversation's minimum. */
const MEMBERS_BESIDE_MIN_WIDTH = 266 + CONVERSATION_MIN_WIDTH;
/**
 * The members panel beside a conversation wide enough to read: a 1280 px window with the sidebar
 * leaves it 692 px, a 1440 px one 852 px.
 */
const MEMBERS_BESIDE_READING_WIDTH = 266 + 768;
/** A laid-out row too narrow to read the conversation beside the members. */
export const tooNarrowToRead = (width: number): boolean =>
  width > 0 && width < MEMBERS_BESIDE_READING_WIDTH;

// Positioned, so what lies over the row (the second column's drop zone) takes its edges.
const ROW_STYLE: CSSProperties = { minWidth: 0, minHeight: 0, position: 'relative' };

/**
 * The row a room or a lobby lays out in: the conversation, and a side panel beside it. Narrower
 * than the members panel and the conversation together, it shows the members over the
 * conversation instead (useMembersDrawer). It measures itself before its content mounts, so the
 * members start where they belong instead of moving there.
 */
export function PanelRow({ children }: { children: ReactNode }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [overlay, setOverlay] = useState<boolean>();
  const [startClosed, setStartClosed] = useState<boolean>();
  const rowWidth = useCallback(() => rowRef.current?.clientWidth ?? 0, []);

  useLayoutEffect(() => {
    const row = rowRef.current;
    // A row without a layout (hidden, or a test renderer) keeps the members beside it.
    const measure = () => {
      const width = row?.clientWidth ?? 0;
      setOverlay(width > 0 && width < MEMBERS_BESIDE_MIN_WIDTH);
      // Narrow from its first layout on, until it is wide once.
      if (width > 0) setStartClosed((was) => (was ?? true) && tooNarrowToRead(width));
    };
    measure();
    if (!row || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  return (
    <Box ref={rowRef} grow="Yes" style={ROW_STYLE} data-panel-row>
      {overlay !== undefined && (
        <MembersOverlayContext value={overlay}>
          <MembersStartClosedContext value={startClosed ?? false}>
            <RowWidthContext value={rowWidth}>{children}</RowWidthContext>
          </MembersStartClosedContext>
        </MembersOverlayContext>
      )}
    </Box>
  );
}
