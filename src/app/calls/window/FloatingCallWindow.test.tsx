// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'jotai';
import type { MatrixClient } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import type { WindowRect } from './callWindowGeometry';
import { callWindowStorageKey, clearCallWindowStore } from './callWindowState';
import { useCallWindowFrame, type CallWindowFrame } from './callWindowFrame';
import { FloatingCallWindow } from './FloatingCallWindow';

const USER = '@me:window.test';
const client = { getSafeUserId: () => USER } as unknown as MatrixClient;

// jsdom has no pointer events or pointer capture.
class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;

  readonly isPrimary: boolean;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
    this.isPrimary = init.isPrimary ?? false;
  }
}
const CAPTURE = ['setPointerCapture', 'hasPointerCapture', 'releasePointerCapture'] as const;
const setPointerCapture = vi.fn();

let frame: CallWindowFrame | undefined;
const pressed = vi.fn();

/** Stands in for the call view's title bar, which takes the handle's props from the frame. */
function TitleBar() {
  frame = useCallWindowFrame();
  return (
    <header {...frame?.handleProps}>
      <span>Call in Lobby</span>
      <button type="button" onClick={pressed}>
        Minimize
      </button>
    </header>
  );
}

const renderWindow = () =>
  render(
    <MatrixClientProvider value={client}>
      <Provider>
        <FloatingCallWindow label="Call in Lobby">
          <TitleBar />
        </FloatingCallWindow>
      </Provider>
    </MatrixClientProvider>
  );

const setViewport = (width: number, height: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
};

const section = () => screen.getByTestId('call-window');
const handle = () => screen.getByLabelText('Move call window');
const edge = (name: string) => section().querySelector(`[data-call-window-edge="${name}"]`)!;
const placed = (): WindowRect => {
  const { left, top, width, height } = section().style;
  return {
    x: parseFloat(left),
    y: parseFloat(top),
    width: parseFloat(width),
    height: parseFloat(height),
  };
};
const stored = (): unknown =>
  JSON.parse(localStorage.getItem(callWindowStorageKey(USER)) ?? 'null');
const store = (value: unknown) =>
  localStorage.setItem(callWindowStorageKey(USER), JSON.stringify(value));

// Pointer capture sends the moves and the release to the frame, wherever the pointer goes.
const pointer = { pointerId: 1, isPrimary: true, button: 0 };
const press = (target: Element, x = 500, y = 500) =>
  fireEvent.pointerDown(target, { ...pointer, clientX: x, clientY: y });
const moveTo = (x: number, y: number) =>
  fireEvent.pointerMove(section(), { ...pointer, clientX: x, clientY: y });
const releaseAt = (x: number, y: number) =>
  fireEvent.pointerUp(section(), { ...pointer, clientX: x, clientY: y });
const drag = (target: Element, dx: number, dy: number) => {
  press(target);
  moveTo(500 + dx, 500 + dy);
  releaseAt(500 + dx, 500 + dy);
};

beforeEach(() => {
  localStorage.clear();
  setViewport(1440, 900);
  document.dir = '';
  frame = undefined;
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  Object.assign(HTMLElement.prototype, {
    setPointerCapture,
    hasPointerCapture: () => true,
    releasePointerCapture: () => undefined,
  });
});

afterEach(() => {
  cleanup();
  clearCallWindowStore(USER);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  for (const name of CAPTURE) Reflect.deleteProperty(HTMLElement.prototype, name);
});

describe('FloatingCallWindow', () => {
  it('opens 400 by 480 at 16 px from the bottom and end edges without stored settings', () => {
    renderWindow();
    expect(section().tagName).toBe('SECTION');
    expect(section().getAttribute('aria-label')).toBe('Call in Lobby');
    expect(placed()).toEqual({ x: 1024, y: 404, width: 400, height: 480 });
    expect(section().hasAttribute('data-bar')).toBe(false);
    expect(frame?.bar).toBe(false);
    expect(handle().tagName).toBe('HEADER');
    expect(handle().tabIndex).toBe(0);
  });

  it('opens at the start edge in a right-to-left document', () => {
    document.dir = 'rtl';
    renderWindow();
    expect(placed()).toEqual({ x: 16, y: 404, width: 400, height: 480 });
  });

  it('fits a rectangle stored on a bigger screen into the viewport', () => {
    store({ mode: 'floating', rect: { x: 2000, y: 1200, width: 600, height: 500 } });
    renderWindow();
    expect(placed()).toEqual({ x: 832, y: 392, width: 600, height: 500 });
  });

  it('moves with a drag on the handle and stores the rectangle on release, not before', () => {
    renderWindow();
    press(screen.getByText('Call in Lobby'));
    expect(setPointerCapture).toHaveBeenCalledWith(1);
    moveTo(200, 300);
    expect(placed()).toEqual({ x: 724, y: 204, width: 400, height: 480 });
    expect(stored()).toBeNull();
    releaseAt(200, 300);
    expect(stored()).toEqual({
      mode: 'floating',
      rect: { x: 724, y: 204, width: 400, height: 480 },
    });
  });

  it('lets a button in the handle take its press without moving the window', () => {
    renderWindow();
    const button = screen.getByRole('button', { name: 'Minimize' });
    press(button);
    moveTo(200, 300);
    fireEvent.pointerUp(button, { ...pointer, clientX: 200, clientY: 300 });
    fireEvent.click(button);
    expect(placed()).toEqual({ x: 1024, y: 404, width: 400, height: 480 });
    expect(setPointerCapture).not.toHaveBeenCalled();
    expect(pressed).toHaveBeenCalledTimes(1);
    expect(stored()).toBeNull();
  });

  it('does not move on a press outside the handle', () => {
    renderWindow();
    drag(section(), -300, -200);
    expect(placed()).toEqual({ x: 1024, y: 404, width: 400, height: 480 });
  });

  it('resizes from a corner and turns into the bar when an edge goes past the threshold', () => {
    renderWindow();
    drag(edge('se'), -60, -40);
    expect(placed()).toEqual({ x: 1024, y: 404, width: 340, height: 440 });
    expect(stored()).toEqual({
      mode: 'floating',
      rect: { x: 1024, y: 404, width: 340, height: 440 },
    });

    drag(edge('s'), 0, -400);
    expect(placed().height).toBe(56);
    expect(section().hasAttribute('data-bar')).toBe(true);
    expect(frame?.bar).toBe(true);
    // Expand gives back the height the window had before the drag made it a bar.
    expect(stored()).toMatchObject({ expandedHeight: 440 });
  });

  it('puts all eight resize handles out of the accessibility tree', () => {
    renderWindow();
    const handles = section().querySelectorAll('[data-call-window-edge]');
    expect([...handles].map((element) => element.getAttribute('data-call-window-edge'))).toEqual([
      'n',
      'ne',
      'e',
      'se',
      's',
      'sw',
      'w',
      'nw',
    ]);
    handles.forEach((element) => expect(element.getAttribute('aria-hidden')).toBe('true'));
  });

  it('minimizes into a 56 px bar on the same bottom edge and expands back', () => {
    renderWindow();
    act(() => frame?.minimize());
    expect(placed()).toEqual({ x: 1024, y: 828, width: 400, height: 56 });
    expect(section().hasAttribute('data-bar')).toBe(true);
    expect(frame?.bar).toBe(true);
    expect(stored()).toEqual({
      mode: 'floating',
      rect: { x: 1024, y: 828, width: 400, height: 56 },
      expandedHeight: 480,
    });

    act(() => frame?.expand());
    expect(placed()).toEqual({ x: 1024, y: 404, width: 400, height: 480 });
    expect(section().hasAttribute('data-bar')).toBe(false);
    expect(stored()).toMatchObject({ rect: { x: 1024, y: 404, width: 400, height: 480 } });
  });

  it('drops a moved bar into the nearest corner on release', () => {
    renderWindow();
    act(() => frame?.minimize());
    press(handle());
    moveTo(-200, -100);
    expect(placed()).toEqual({ x: 324, y: 228, width: 400, height: 56 });
    releaseAt(-200, -100);
    expect(placed()).toEqual({ x: 8, y: 8, width: 400, height: 56 });
    expect(stored()).toMatchObject({ rect: { x: 8, y: 8, width: 400, height: 56 } });
  });

  it('moves with the arrows and resizes with Shift and the arrows while the handle has focus', () => {
    renderWindow();
    handle().focus();
    fireEvent.keyDown(handle(), { key: 'ArrowLeft' });
    expect(placed()).toEqual({ x: 1008, y: 404, width: 400, height: 480 });
    expect(stored()).toMatchObject({ rect: { x: 1008, y: 404, width: 400, height: 480 } });
    fireEvent.keyDown(handle(), { key: 'ArrowUp', shiftKey: true });
    expect(placed()).toEqual({ x: 1008, y: 404, width: 400, height: 464 });
    expect(stored()).toMatchObject({ rect: { x: 1008, y: 404, width: 400, height: 464 } });
  });

  it('leaves the arrows to a button inside the handle', () => {
    renderWindow();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Minimize' }), { key: 'ArrowLeft' });
    expect(placed()).toEqual({ x: 1024, y: 404, width: 400, height: 480 });
    expect(stored()).toBeNull();
  });

  it('keeps its distance to the nearer edges when the viewport changes', () => {
    renderWindow();
    setViewport(1000, 700);
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(placed()).toEqual({ x: 584, y: 204, width: 400, height: 480 });
  });

  it('shrinks a stored window into a small viewport and gives its size back when it grows', () => {
    store({ mode: 'floating', rect: { x: 1000, y: 400, width: 400, height: 440 } });
    renderWindow();
    setViewport(1000, 700);
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(placed()).toEqual({ x: 560, y: 200, width: 400, height: 440 });
    setViewport(360, 400);
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(placed()).toEqual({ x: 8, y: 8, width: 344, height: 384 });
    setViewport(1440, 900);
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(placed()).toEqual({ x: 1000, y: 400, width: 400, height: 440 });
    // Nothing was written: the stored rectangle stays the one the person placed.
    expect(stored()).toEqual({
      mode: 'floating',
      rect: { x: 1000, y: 400, width: 400, height: 440 },
    });
  });

  it.each(['pointerCancel', 'lostPointerCapture'] as const)(
    'stores the rectangle where it stands when %s ends a drag',
    (end) => {
      renderWindow();
      press(handle());
      moveTo(400, 450);
      fireEvent[end](section(), { ...pointer, clientX: 400, clientY: 450 });
      expect(placed()).toEqual({ x: 924, y: 354, width: 400, height: 480 });
      expect(stored()).toEqual({
        mode: 'floating',
        rect: { x: 924, y: 354, width: 400, height: 480 },
      });
      // The drag is over: a later move does nothing.
      moveTo(100, 100);
      expect(placed()).toEqual({ x: 924, y: 354, width: 400, height: 480 });
    }
  );

  it('gives no frame outside the floating window', () => {
    render(<TitleBar />);
    expect(frame).toBeUndefined();
  });
});
