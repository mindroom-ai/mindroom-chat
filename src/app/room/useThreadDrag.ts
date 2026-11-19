import { useEffect, useState } from 'react';
import { isThreadDrag } from '../navigation/secondThread';

/** Where a thread card's drag started, on the page. */
export type ThreadDragStart = { x: number; y: number };

/**
 * A thread card's drag under way on the page (`THREAD_DRAG_TYPE` among its types), with where it
 * started: from its start until it drops anywhere or ends, which is also how Escape cancels it. The
 * card hears its own end where the window may not (a card that left the page mid-drag), and a card
 * that leaves the page ends it at once. A drag its card refused is none. It answers a task after
 * the drag starts, so nothing it shows changes the page under the card being picked up.
 */
export const useThreadDrag = (): ThreadDragStart | undefined => {
  const [drag, setDrag] = useState<ThreadDragStart>();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let source: Node | undefined;
    let sourceGone: MutationObserver | undefined;
    const stop = () => {
      clearTimeout(timer);
      source?.removeEventListener('dragend', end);
      sourceGone?.disconnect();
      source = undefined;
      sourceGone = undefined;
    };
    function end() {
      stop();
      setDrag(undefined);
    }
    const start = (evt: DragEvent) => {
      if (evt.defaultPrevented || !isThreadDrag(evt.dataTransfer)) return;
      end();
      const from = { x: evt.clientX, y: evt.clientY };
      if (evt.target instanceof Node) {
        const card = evt.target;
        source = card;
        card.addEventListener('dragend', end);
        sourceGone = new MutationObserver(() => {
          if (!card.isConnected) end();
        });
        sourceGone.observe(card.ownerDocument ?? document, { childList: true, subtree: true });
      }
      timer = setTimeout(() => setDrag(from), 0);
    };
    window.addEventListener('dragstart', start);
    window.addEventListener('dragend', end);
    window.addEventListener('drop', end);
    return () => {
      stop();
      window.removeEventListener('dragstart', start);
      window.removeEventListener('dragend', end);
      window.removeEventListener('drop', end);
    };
  }, []);
  return drag;
};
