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
  (document as Document & { captureElement?: unknown }).captureElement === canvas &&
  !('setCapture' in canvas);

/**
 * Lets go of noVNC's capture of a canvas that closed while a touchpad drag held it: its
 * disconnect leaves the page-covering element up, which would take the next tap or click.
 * Call it after `disconnect()`, so noVNC sends nothing more.
 */
export function releaseNoVncCapture(canvas: HTMLCanvasElement | null): void {
  if (!canvas || !holdsNoVncCapture(canvas)) return;
  window.dispatchEvent(
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

  // The touches that started on the screen, the canvas or its letterbox. `targetTouches`
  // would leave out a finger on the letterbox while another is on the canvas.
  const screenTouches = (event: TouchEvent): TouchPoint[] =>
    Array.from(event.touches)
      .filter((touch) => touch.target instanceof Node && target.contains(touch.target))
      .map((touch) => ({ id: touch.identifier, x: touch.clientX, y: touch.clientY }));

  // While noVNC holds the canvas, a release goes to the window, and noVNC hands it on to the
  // canvas. Otherwise its page-covering element would keep the next touch off the screen.
  const releaseTarget = (canvas: HTMLCanvasElement): EventTarget =>
    holdsNoVncCapture(canvas) ? window : canvas;

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

  // Moves the pointer, kept inside the canvas as it is now, which may have been resized, up
  // to its last pixel at right - 1 and bottom - 1: on the edge, noVNC hides its cursor.
  const movePointer = (canvas: HTMLCanvasElement, dx: number, dy: number): Point => {
    const rect = canvas.getBoundingClientRect();
    const from = pointer ?? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    pointer = {
      x: clamp(from.x + dx, rect.left, rect.right - 1),
      y: clamp(from.y + dy, rect.top, rect.bottom - 1),
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
        // noVNC sends a move with the buttons of its last press or release.
        sendMouse(canvas, 'mousemove', movePointer(canvas, action.dx, action.dy), 0, 0);
        return;
      case 'click': {
        const [button, buttons] = action.button === 'left' ? [0, 1] : [2, 2];
        const at = pointAt(canvas);
        sendMouse(canvas, 'mousedown', at, button, buttons);
        sendMouse(canvas, 'mouseup', at, button, 0);
        return;
      }
      case 'dragStart':
        sendMouse(canvas, 'mousedown', pointAt(canvas), 0, 1);
        return;
      case 'dragEnd':
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
    const time = event.timeStamp;
    switch (event.type) {
      case 'touchstart': {
        const fingers = screenTouches(event);
        // A gesture starts: no finger was on the screen yet. noVNC keeps the buttons of its
        // own gestures, even while watching, and sends them with every move. One that control
        // cut short never ended there, and its timers can still press. So let go of them
        // first; with none held, noVNC sends one move without buttons to the pointer.
        if (event.changedTouches.length === fingers.length) {
          sendMouse(canvas, 'mouseup', movePointer(canvas, 0, 0), 0, 0);
        }
        run(canvas, recognizer.start(fingers, time));
        break;
      }
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

  // A held button is let go by the stream closing, and noVNC's capture by
  // `releaseNoVncCapture`.
  return () => {
    TOUCH_EVENTS.forEach((type) => target.removeEventListener(type, handleTouch, true));
  };
}
