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
 * How the thread column shows on a room page wide enough for two columns: beside the room's
 * messages, or filling the page. The last choice holds on this device, for every account; until
 * one is made, threads fill the page.
 */
export type ThreadLayout = 'beside' | 'full';

/** The thread column's width, on this device. */
export const THREAD_COLUMN_WIDTH_KEY = 'mindroom.threadColumn.width';

const LAYOUT_KEY = 'mindroom.threadColumn.layout';

/** The stored layout as storage has it now. */
const storedThreadLayout = (): ThreadLayout =>
  getLocalStorageItem<unknown>(LAYOUT_KEY, undefined) === 'beside' ? 'beside' : 'full';

const threadLayoutAtom = atomWithLocalStorage<ThreadLayout>(
  LAYOUT_KEY,
  storedThreadLayout,
  setLocalStorageItem
);

/** The room's messages and the thread beside them each keep a conversation's least width. */
const BESIDE_MIN_WIDTH = 2 * CONVERSATION_MIN_WIDTH;

/**
 * The layout threads show in on the room page `pageRef` holds: `roomy` while the page has room for
 * a thread beside the messages (never on phones), the stored `layout`, and `setLayout`, which
 * stores a choice. Before the page has a layout the room's row answers; a row with none either (a
 * test renderer's) counts as roomy.
 */
export const useThreadLayout = (pageRef: RefObject<HTMLElement>) => {
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  const [layout, setLayout] = useAtom(threadLayoutAtom);
  // Whether the page is wide enough, not its width: a page that resizes as a panel moves renders
  // again only when that changes. Before the page has a layout, the room's row answers.
  const rowWidth = usePanelRowWidth();
  const [wide, setWide] = useState(() => {
    const width = rowWidth();
    return width === 0 || width >= BESIDE_MIN_WIDTH;
  });
  useLayoutEffect(() => {
    const page = pageRef.current;
    if (!page) return undefined;
    // No width (behind a side panel that fills the room) keeps the last answer.
    const measure = () => {
      if (page.clientWidth > 0) setWide(page.clientWidth >= BESIDE_MIN_WIDTH);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(page);
    return () => observer.disconnect();
  }, [pageRef]);
  const roomy = !phone && wide;
  return { roomy, layout, setLayout };
};
