import { defaultAnimateLayoutChanges, type AnimateLayoutChanges } from '@dnd-kit/sortable';

// The release that ends a drag started by each kind of press.
const POINTER_DRAG_RELEASES: Record<string, string[]> = {
  mousedown: ['mouseup'],
  pointerdown: ['pointerup', 'pointercancel'],
  touchstart: ['touchend', 'touchcancel'],
};

// The drag library stops every click from the start of a drag until 50 ms after its release.
const DRAG_LIBRARY_CLICK_GUARD_MS = 50;

export const animateSortableLayoutDuringDrag: AnimateLayoutChanges = (args) => {
  if (args.wasDragging && !args.isSorting) {
    return false;
  }

  return defaultAnimateLayoutChanges(args);
};

/**
 * Keeps the clicks that the drag library stops during a pointer drag from acting by default (a
 * link would otherwise load its page): from the start of the drag, however long it lasts, until
 * the library lets clicks through again after the release.
 */
export const preventClickDefaultsDuringPointerDrag = (activatorEvent: Event): void => {
  const releases = POINTER_DRAG_RELEASES[activatorEvent.type];
  const target = activatorEvent.target;
  const ownerDocument = target instanceof Node ? target.ownerDocument : null;
  const ownerWindow = ownerDocument?.defaultView;
  if (!releases || !ownerDocument || !ownerWindow) return;

  const preventDefault = (event: MouseEvent) => {
    if (event.cancelable) event.preventDefault();
  };
  const stop = () => ownerDocument.removeEventListener('click', preventDefault, true);
  // Listening on the window as the release bubbles runs after the drag library's own listener,
  // so this timer is queued after the one that ends its guard, and fires after it.
  const onRelease = () => {
    releases.forEach((type) => ownerWindow.removeEventListener(type, onRelease));
    ownerWindow.setTimeout(stop, DRAG_LIBRARY_CLICK_GUARD_MS);
  };

  ownerDocument.addEventListener('click', preventDefault, true);
  releases.forEach((type) => ownerWindow.addEventListener(type, onRelease));
};
