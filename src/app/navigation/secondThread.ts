import { createContext } from 'react';

/**
 * What the room page offers for a second thread beside the one it shows: whether a thread of the
 * room `roomId` may open there (`offers`, false for another room's or a thread the page already
 * shows), and opening it. Absent off a room page and on phones, where no second thread shows.
 */
export type SecondThreadControl = {
  offers: (roomId: string, rootId: string) => boolean;
  open: (roomId: string, rootId: string) => void;
};

export const SecondThreadContext = createContext<SecondThreadControl | undefined>(undefined);

/**
 * The drag data type of a thread card dragged toward the second column: JSON `{ roomId, rootId }`.
 * A drag shows only its types until it drops, so the room page tells a thread's drag by this one.
 */
export const THREAD_DRAG_TYPE = 'application/x-mindroom-thread';

export type ThreadDragData = { roomId: string; rootId: string };

/** Puts the thread in a drag about to start, to be moved (into the second column). */
export const setThreadDragData = (data: DataTransfer, thread: ThreadDragData): void => {
  data.setData(THREAD_DRAG_TYPE, JSON.stringify(thread));
  // eslint-disable-next-line no-param-reassign -- how a drag source says what it allows
  data.effectAllowed = 'move';
};

/** Whether a drag under way carries a thread (its data is not readable before it drops). */
export const isThreadDrag = (data: DataTransfer | null | undefined): boolean =>
  !!data && Array.from(data.types).includes(THREAD_DRAG_TYPE);

/** The thread a drag dropped, when it carries one. */
export const readThreadDragData = (
  data: DataTransfer | null | undefined
): ThreadDragData | undefined => {
  const raw = data?.getData(THREAD_DRAG_TYPE);
  if (!raw) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return undefined;
    const { roomId, rootId } = value as Record<string, unknown>;
    return typeof roomId === 'string' && typeof rootId === 'string'
      ? { roomId, rootId }
      : undefined;
  } catch {
    return undefined;
  }
};
