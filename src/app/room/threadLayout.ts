import { type RefObject, useLayoutEffect, useState } from 'react';
import { useAtom } from 'jotai';
import {
  atomWithLocalStorage,
  getLocalStorageItem,
  setLocalStorageItem,
} from '../lib/state/atomWithLocalStorage';
import { ScreenSize, useScreenSizeContext } from '../lib/hooks/useScreenSize';
import { CONVERSATION_MIN_WIDTH } from '../ui/panels/ResizablePanel';
import { usePanelRowWidth } from '../members/PanelRow';

/**
 * How a thread opens on a room page wide enough for two columns: in a column beside the room's
 * messages, or in their place. The last choice holds on this device, for every account; until
 * one is made, threads open in the messages' place.
 */
export type ThreadLayout = 'beside' | 'full';

/** The thread column's width, on this device. */
export const THREAD_COLUMN_WIDTH_KEY = 'mindroom.threadColumn.width';

const LAYOUT_KEY = 'mindroom.threadColumn.layout';
const readLayout = (key: string): ThreadLayout =>
  getLocalStorageItem<unknown>(key, undefined) === 'beside' ? 'beside' : 'full';
const threadLayoutAtom = atomWithLocalStorage<ThreadLayout>(
  LAYOUT_KEY,
  readLayout,
  setLocalStorageItem
);

/**
 * The stored layout as storage has it now, for a thread that opens: the atom, which another tab
 * may have changed while it was not mounted, reads it again only after its first render.
 */
export const storedThreadLayout = (): ThreadLayout => readLayout(LAYOUT_KEY);

/** The room's messages and the thread beside them each keep a conversation's least width. */
const BESIDE_MIN_WIDTH = 2 * CONVERSATION_MIN_WIDTH;

/**
 * The layout threads show in on the room page `pageRef` holds: `roomy` while the page has room for
 * a thread beside the messages (never on phones), `measured` once the page itself said so, the
 * stored `layout`, and `setLayout`, which stores a choice. A page not laid out yet, or a test renderer's, which lays out nothing, counts as
 * roomy.
 */
export const useThreadLayout = (pageRef: RefObject<HTMLElement>) => {
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  const [layout, setLayout] = useAtom(threadLayoutAtom);
  // Whether the page is wide enough, not its width: a page that resizes as a panel moves renders
  // again only when that changes. Before the page has a layout, the room's row answers, which a
  // side panel beside the page makes wider than the page: `measured` says when the page answered.
  const rowWidth = usePanelRowWidth();
  const [wide, setWide] = useState(() => {
    const width = rowWidth();
    return width === 0 || width >= BESIDE_MIN_WIDTH;
  });
  const [measured, setMeasured] = useState(false);
  useLayoutEffect(() => {
    const page = pageRef.current;
    if (!page) return undefined;
    // No width (behind a side panel that fills the room) keeps the last answer.
    const measure = () => {
      if (page.clientWidth > 0) setWide(page.clientWidth >= BESIDE_MIN_WIDTH);
    };
    measure();
    setMeasured(true);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(page);
    return () => observer.disconnect();
  }, [pageRef]);
  const roomy = !phone && wide;
  return { roomy, measured, layout, setLayout };
};
