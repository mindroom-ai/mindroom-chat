import { createTouchpadRecognizer, type TouchPoint, type TouchpadAction } from './touchpadGestures';

// While in control on a touch screen, the computer screen works like a laptop touchpad.
// noVNC's own touch handling is direct touch, so this layer takes touches in front of its
// canvas, keeps a pointer position, and hands noVNC the mouse and wheel events of a touchpad.
// noVNC then sends pointer messages and draws its touch-device cursor as it does for a mouse.

export type ComputerTouchpadOptions = {
  isControlling: () => boolean;
};

type Point = { x: number; y: number };

const TOUCH_EVENTS = ['touchstart', 'touchmove', 'touchend', 'touchcancel'] as const;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// noVNC takes the mouse on every press. Without Element.setCapture (all but Firefox) it
// covers the page with an element, and lets go when a mouseup reaches the window, as a
// real mouse's does. Its canvas listener stops a mouseup there from bubbling.
const holdsNoVncCapture = (canvas: HTMLCanvasElement) =>
  (canvas.ownerDocument as Document & { captureElement?: unknown }).captureElement === canvas &&
  !('setCapture' in canvas);

const windowOf = (element: Element) => element.ownerDocument.defaultView ?? window;

/**
 * Lets go of noVNC's capture of a canvas that closed while a touchpad drag held it: its
 * disconnect leaves the page-covering element up, which would take the next tap or click.
 * Call it after `disconnect()`, so noVNC sends nothing more.
 */
export function releaseNoVncCapture(canvas: HTMLCanvasElement | null): void {
  if (!canvas || !holdsNoVncCapture(canvas)) return;
  windowOf(canvas).dispatchEvent(
    new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0 })
  );
}

export function attachComputerTouchpad(
  target: HTMLElement,
  options: ComputerTouchpadOptions
): () => void {
  const { isControlling } = options;
  const recognizer = createTouchpadRecognizer();
  // In client coordinates. It starts at the canvas centre on the first touch in control.
  let pointer: Point | undefined;
  // Where the last mousemove put noVNC's cursor.
  let shown: Point | undefined;
  let dragging = false;

  // The touches that started on the screen, the canvas or its letterbox. `targetTouches`
  // would leave out a finger on the letterbox while another is on the canvas.
  const screenTouches = (event: TouchEvent): TouchPoint[] =>
    Array.from(event.touches)
      .filter((touch) => touch.target instanceof Node && target.contains(touch.target))
      .map((touch) => ({ id: touch.identifier, x: touch.clientX, y: touch.clientY }));

  // While noVNC holds the canvas, a release goes to the window, and noVNC hands it on to the
  // canvas. Otherwise its page-covering element would keep the next touch off the screen.
  const releaseTarget = (canvas: HTMLCanvasElement): EventTarget =>
    holdsNoVncCapture(canvas) ? windowOf(canvas) : canvas;

  const sendMouse = (
    canvas: HTMLCanvasElement,
    type: 'mousedown' | 'mousemove' | 'mouseup',
    at: Point,
    button: number,
    buttons: number
  ) => {
    const init = { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y };
    const on = type === 'mouseup' ? releaseTarget(canvas) : canvas;
    on.dispatchEvent(new MouseEvent(type, { ...init, button, buttons }));
    if (type === 'mousemove') shown = at;
  };

  // Moves the pointer, kept inside the canvas as it is now, which may have been resized.
  const movePointer = (canvas: HTMLCanvasElement, dx: number, dy: number): Point => {
    const rect = canvas.getBoundingClientRect();
    const from = pointer ?? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    pointer = {
      x: clamp(from.x + dx, rect.left, rect.left + rect.width),
      y: clamp(from.y + dy, rect.top, rect.top + rect.height),
    };
    return pointer;
  };

  // A mouse is over the canvas before it presses there, so noVNC's cursor follows it. A tap
  // before any move, or after the canvas shrank under the pointer, moves the cursor first.
  const pointAt = (canvas: HTMLCanvasElement): Point => {
    const at = movePointer(canvas, 0, 0);
    if (shown?.x !== at.x || shown?.y !== at.y) sendMouse(canvas, 'mousemove', at, 0, 0);
    return at;
  };

  const perform = (canvas: HTMLCanvasElement, action: TouchpadAction) => {
    switch (action.type) {
      case 'move':
        sendMouse(
          canvas,
          'mousemove',
          movePointer(canvas, action.dx, action.dy),
          0,
          dragging ? 1 : 0
        );
        return;
      case 'click': {
        const [button, buttons] = action.button === 'left' ? [0, 1] : [2, 2];
        const at = pointAt(canvas);
        sendMouse(canvas, 'mousedown', at, button, buttons);
        sendMouse(canvas, 'mouseup', at, button, 0);
        return;
      }
      case 'dragStart':
        dragging = true;
        sendMouse(canvas, 'mousedown', pointAt(canvas), 0, 1);
        return;
      case 'dragEnd':
        dragging = false;
        sendMouse(canvas, 'mouseup', movePointer(canvas, 0, 0), 0, 0);
        return;
      case 'scroll': {
        const at = pointAt(canvas);
        canvas.dispatchEvent(
          new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            clientX: at.x,
            clientY: at.y,
            deltaX: action.dx,
            deltaY: action.dy,
            deltaMode: 0,
          })
        );
        return;
      }
      // no default
    }
  };

  const run = (canvas: HTMLCanvasElement, actions: TouchpadAction[]) => {
    actions.forEach((action) => perform(canvas, action));
  };

  const handleTouch = (event: TouchEvent) => {
    // noVNC makes its canvas on connect; until then touches pass through.
    const canvas = target.querySelector('canvas');
    if (!canvas) return;
    if (!isControlling()) {
      // Control ended mid-gesture: end it here and let go of noVNC's capture. noVNC sends
      // nothing once view-only; the stream closing releases the computer's button. Touches
      // pass through.
      run(canvas, recognizer.cancel());
      return;
    }
    // No page scroll or zoom, and noVNC's own gesture handler on the canvas never sees it.
    event.preventDefault();
    event.stopPropagation();
    if (!pointer) movePointer(canvas, 0, 0);
    const time = event.timeStamp;
    switch (event.type) {
      case 'touchstart':
        run(canvas, recognizer.start(screenTouches(event), time));
        break;
      case 'touchmove':
        run(canvas, recognizer.move(screenTouches(event), time));
        break;
      case 'touchend':
        run(canvas, recognizer.end(screenTouches(event), time));
        break;
      case 'touchcancel':
        run(canvas, recognizer.cancel());
        break;
      default:
        break;
    }
  };

  const listenerOptions = { capture: true, passive: false };
  TOUCH_EVENTS.forEach((type) => target.addEventListener(type, handleTouch, listenerOptions));

  return () => {
    TOUCH_EVENTS.forEach((type) => target.removeEventListener(type, handleTouch, true));
    // A new stream on the same screen: release a held button before noVNC disconnects.
    // On unmount React has already taken the screen out of the page, and noVNC would place
    // a release on a canvas with no size at (65535, 65535). The stream closes right after,
    // and the computer lets go of held buttons then.
    const canvas = target.querySelector('canvas');
    const rect = canvas?.getBoundingClientRect();
    if (canvas?.isConnected && rect && rect.width > 0 && rect.height > 0) {
      run(canvas, recognizer.cancel());
    }
  };
}
