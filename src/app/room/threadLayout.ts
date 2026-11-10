import { type RefObject, useLayoutEffect, useState } from 'react';
import { useAtom } from 'jotai';
import {
  atomWithLocalStorage,
  getLocalStorageItem,
  setLocalStorageItem,
} from '../lib/state/atomWithLocalStorage';
import { ScreenSize, useScreenSizeContext } from '../lib/hooks/useScreenSize';
import { CONVERSATION_MIN_WIDTH } from '../ui/panels/ResizablePanel';

/**
 * How a thread opens on a room page wide enough for two columns: in a column beside the room's
 * messages, or in their place. The last choice holds on this device, for every account; until
 * one is made, threads open in the messages' place.
 */
export type ThreadLayout = 'beside' | 'full';

/** The thread column's width, on this device. */
export const THREAD_COLUMN_WIDTH_KEY = 'mindroom.threadColumn.width';

const threadLayoutAtom = atomWithLocalStorage<ThreadLayout>(
  'mindroom.threadColumn.layout',
  (key) => (getLocalStorageItem<unknown>(key, undefined) === 'beside' ? 'beside' : 'full'),
  setLocalStorageItem
);

/** The room's messages and the thread beside them each keep a conversation's least width. */
const BESIDE_MIN_WIDTH = 2 * CONVERSATION_MIN_WIDTH;

/**
 * The layout a thread opens in on the room page `pageRef` holds: `roomy` while the page has room
 * for the thread beside the messages (never on phones), `beside` while it shows there, and
 * `setLayout`, which stores the choice. A page not laid out yet, or a test renderer's, which lays
 * out nothing, counts as roomy.
 */
export const useThreadLayout = (pageRef: RefObject<HTMLElement>) => {
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  const [layout, setLayout] = useAtom(threadLayoutAtom);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const page = pageRef.current;
    if (!page) return undefined;
    const measure = () => setWidth(page.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(page);
    return () => observer.disconnect();
  }, [pageRef]);
  const roomy = !phone && (width === 0 || width >= BESIDE_MIN_WIDTH);
  return { roomy, beside: roomy && layout === 'beside', setLayout };
};
