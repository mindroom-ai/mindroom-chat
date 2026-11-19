import { useEffect, useState } from 'react';
import { isThreadDrag } from '../navigation/secondThread';

/**
 * Whether a thread card's drag is under way on the page (`THREAD_DRAG_TYPE` among its types): from
 * its start until it drops anywhere or ends, which is also how Escape cancels it. It answers a task
 * after the drag starts, so nothing the drag shows changes the page under the card being picked up.
 */
export const useThreadDrag = (): boolean => {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const start = (evt: DragEvent) => {
      if (!isThreadDrag(evt.dataTransfer)) return;
      clearTimeout(timer);
      timer = setTimeout(() => setDragging(true), 0);
    };
    const end = () => {
      clearTimeout(timer);
      setDragging(false);
    };
    window.addEventListener('dragstart', start);
    window.addEventListener('dragend', end);
    window.addEventListener('drop', end);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('dragstart', start);
      window.removeEventListener('dragend', end);
      window.removeEventListener('drop', end);
    };
  }, []);
  return dragging;
};
