// @vitest-environment jsdom

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComputerScreen, type ComputerScreenProps, type RfbClient } from './ComputerScreen';
// noVNC's mouse capture, which its canvas takes on every mousedown. The package exports only RFB.
/* eslint-disable import/no-relative-packages */
import {
  releaseCapture,
  setCapture,
} from '../../../../node_modules/@novnc/novnc/core/util/events.js';
/* eslint-enable import/no-relative-packages */

vi.mock('./ComputerPanel.css.ts', () => ({
  Screen: 'Screen',
  ScreenInControl: 'ScreenInControl',
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CONTROL_L_KEYSYM = 0xffe3;

const listeners = new Map<string, EventListener>();
const rfb: RfbClient = {
  addEventListener: vi.fn((name: string, listener: EventListener) => listeners.set(name, listener)),
  removeEventListener: vi.fn((name: string) => listeners.delete(name)),
  disconnect: vi.fn(),
  focus: vi.fn(),
  clipboardPasteFrom: vi.fn(),
  sendKey: vi.fn(),
  scaleViewport: false,
  viewOnly: true,
};

// Like noVNC, which draws into a focusable canvas inside the target.
const createRfbWithCanvas = () =>
  vi.fn((target: HTMLElement) => {
    const canvas = document.createElement('canvas');
    canvas.tabIndex = -1;
    target.append(canvas);
    return rfb;
  });

const paste = (text: string, on: Element) => {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (type: string) => (type === 'text/plain' ? text : '') },
  });
  on.dispatchEvent(event);
  return event;
};

const mouseDown = (on: Element) => {
  const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
  on.dispatchEvent(event);
  return event;
};

// One finger at (x, 100) on the canvas, as a browser builds a touch event.
const touch = (
  type: 'touchstart' | 'touchmove' | 'touchend',
  on: Element,
  x: number | undefined,
  time: number
) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const touches = x === undefined ? [] : [{ identifier: 1, clientX: x, clientY: 100, target: on }];
  Object.defineProperties(event, {
    touches: { value: touches },
    targetTouches: { value: touches },
    changedTouches: { value: [{ identifier: 1, clientX: x ?? 0, clientY: 100, target: on }] },
    timeStamp: { value: time },
  });
  on.dispatchEvent(event);
  return event;
};

const capturedElement = () =>
  (document as Document & { captureElement?: Element | null }).captureElement;
const captureOverlay = () => document.getElementById('noVNC_mouse_capture_elem');

// Like noVNC on its canvas: a press takes the mouse capture, no mouse event bubbles on, a
// PointerEvent is sent only while connected, and disconnect takes the canvas out.
const createNoVncLikeRfb = () => {
  const sent: string[] = [];
  const reached: string[] = [];
  let canvas: HTMLCanvasElement | undefined;
  let connected = true;
  const createRfb = vi.fn((target: HTMLElement): RfbClient => {
    const element = document.createElement('canvas');
    element.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 250, right: 400, bottom: 250 } as DOMRect);
    for (const type of ['mousedown', 'mousemove', 'mouseup']) {
      element.addEventListener(type, (event) => {
        event.stopPropagation();
        const entry = `${event.type} ${(event as MouseEvent).buttons}`;
        reached.push(entry);
        if (event.type === 'mousedown') setCapture(element);
        if (connected) sent.push(entry);
      });
    }
    target.append(element);
    canvas = element;
    return {
      ...rfb,
      disconnect: () => {
        rfb.disconnect();
        connected = false;
        element.remove();
      },
    };
  });
  const getCanvas = () => {
    if (!canvas) throw new Error('No canvas yet.');
    return canvas;
  };
  // The socket closed or failed: noVNC's own `_disconnect` takes the canvas out.
  const dropStream = () => {
    connected = false;
    getCanvas().remove();
  };
  return { createRfb, getCanvas, dropStream, sent, reached };
};

// A tap, then a touch that moves: the touchpad holds the left button down.
const startTouchDrag = (canvas: Element, from: number) => {
  touch('touchstart', canvas, 100, from);
  touch('touchend', canvas, undefined, from + 50);
  touch('touchstart', canvas, 100, from + 150);
  return touch('touchmove', canvas, 140, from + 170);
};

describe('ComputerScreen', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    listeners.clear();
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const renderScreen = (props: Partial<ComputerScreenProps>) =>
    act(() => {
      root.render(
        <ComputerScreen
          mode="view"
          onConnected={() => undefined}
          onDisconnected={() => undefined}
          protocols={['binary', 'mindroom-ticket.ticket-1']}
          url="wss://computer.example.org/api/computers/sessions/session-1/stream"
          {...props}
        />
      );
    });

  const screenElements = () => {
    const surface = container.querySelector<HTMLElement>('[data-mindroom-computer-input]');
    const canvas = surface?.querySelector('canvas');
    if (!surface || !canvas) throw new Error('The computer screen did not render its canvas.');
    return { surface, canvas };
  };

  it('owns one scaled noVNC connection and disposes it with its callbacks', () => {
    const createRfb = vi.fn(() => rfb);
    const onConnected = vi.fn();
    const onDisconnected = vi.fn();

    act(() => {
      root.render(
        <ComputerScreen
          createRfb={createRfb}
          mode="view"
          onConnected={onConnected}
          onDisconnected={onDisconnected}
          protocols={['binary', 'mindroom-ticket.ticket-1']}
          url="wss://computer.example.org/api/computers/sessions/session-1/stream"
        />
      );
    });

    expect(createRfb).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      'wss://computer.example.org/api/computers/sessions/session-1/stream',
      { wsProtocols: ['binary', 'mindroom-ticket.ticket-1'] }
    );
    expect(rfb.scaleViewport).toBe(true);
    expect(rfb.viewOnly).toBe(true);

    act(() => listeners.get('connect')?.(new Event('connect')));
    expect(onConnected).toHaveBeenCalledOnce();

    act(() => {
      root.render(
        <ComputerScreen
          createRfb={createRfb}
          mode="control"
          onConnected={onConnected}
          onDisconnected={onDisconnected}
          protocols={['binary', 'mindroom-ticket.ticket-1']}
          url="wss://computer.example.org/api/computers/sessions/session-1/stream"
        />
      );
    });
    expect(createRfb).toHaveBeenCalledOnce();
    expect(rfb.viewOnly).toBe(false);

    act(() => root.unmount());
    expect(rfb.disconnect).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
  });

  it('keeps keyboard and paste events inside the computer surface', () => {
    const windowKeyDown = vi.fn();
    const windowPaste = vi.fn();
    const rfbKeyDown = vi.fn();
    const rfbPaste = vi.fn();
    window.addEventListener('keydown', windowKeyDown);
    window.addEventListener('paste', windowPaste);

    act(() => {
      root.render(
        <ComputerScreen
          createRfb={(target) => {
            const canvas = document.createElement('canvas');
            canvas.tabIndex = -1;
            canvas.addEventListener('keydown', rfbKeyDown);
            canvas.addEventListener('paste', rfbPaste);
            target.append(canvas);
            return rfb;
          }}
          // Watching, so the clipboard bridge leaves the paste to the surface's own stop.
          mode="view"
          onConnected={() => undefined}
          onDisconnected={() => undefined}
          protocols={['binary', 'mindroom-ticket.ticket-1']}
          url="wss://computer.example.org/api/computers/sessions/session-1/stream"
        />
      );
    });

    const surface = container.querySelector<HTMLElement>('[data-mindroom-computer-input]');
    const canvas = surface?.querySelector('canvas');
    expect(surface).not.toBeNull();
    expect(canvas).not.toBeNull();
    canvas?.focus();
    canvas?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'KeyA' }));
    canvas?.dispatchEvent(new Event('paste', { bubbles: true }));

    expect(rfbKeyDown).toHaveBeenCalledOnce();
    expect(rfbPaste).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(canvas);
    expect(windowKeyDown).not.toHaveBeenCalled();
    expect(windowPaste).not.toHaveBeenCalled();

    window.removeEventListener('keydown', windowKeyDown);
    window.removeEventListener('paste', windowPaste);
  });

  it('bridges paste only while in control, on the same connection', () => {
    const createRfb = createRfbWithCanvas();
    const onPaste = vi.fn();
    renderScreen({ createRfb, mode: 'view', onPaste });
    const { canvas } = screenElements();
    canvas.focus();

    expect(paste('hi', canvas).defaultPrevented).toBe(false);
    expect(rfb.clipboardPasteFrom).not.toHaveBeenCalled();
    expect(rfb.sendKey).not.toHaveBeenCalled();

    const nextOnPaste = vi.fn();
    renderScreen({ createRfb, mode: 'control', onPaste: nextOnPaste });
    expect(paste('hi', canvas).defaultPrevented).toBe(true);

    expect(rfb.clipboardPasteFrom).toHaveBeenCalledWith('hi');
    expect(nextOnPaste).toHaveBeenCalledWith('sent');
    expect(onPaste).not.toHaveBeenCalled();
    expect(createRfb).toHaveBeenCalledOnce();
  });

  it('detaches the bridge before disconnecting', () => {
    const platform = vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    try {
      renderScreen({ createRfb: createRfbWithCanvas(), mode: 'control' });
      const { surface, canvas } = screenElements();
      canvas.focus();
      canvas.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          code: 'MetaLeft',
          key: 'Meta',
          metaKey: true,
        })
      );
      expect(rfb.sendKey).toHaveBeenCalledWith(CONTROL_L_KEYSYM, 'ControlLeft', true);

      act(() => root.unmount());

      // The mapped Ctrl is released while the socket is still open.
      expect(rfb.sendKey).toHaveBeenLastCalledWith(CONTROL_L_KEYSYM, 'ControlLeft', false);
      expect(rfb.disconnect).toHaveBeenCalledOnce();
      expect(vi.mocked(rfb.sendKey).mock.invocationCallOrder.at(-1)).toBeLessThan(
        vi.mocked(rfb.disconnect).mock.invocationCallOrder[0]
      );

      // Even with the old screen back in the page and focused, nothing is bridged.
      document.body.append(surface);
      canvas.focus();
      paste('hi', canvas);
      surface.remove();
      expect(rfb.clipboardPasteFrom).not.toHaveBeenCalled();
      expect(listeners.size).toBe(0);
    } finally {
      platform.mockRestore();
    }
  });

  it('attaches the touchpad once per stream', () => {
    const mouse = vi.fn((event: MouseEvent) => ({ type: event.type, buttons: event.buttons }));
    const canvases: HTMLCanvasElement[] = [];
    // Like noVNC: a sized canvas inside the target, which disconnect takes out again.
    const createRfb = vi.fn((target: HTMLElement): RfbClient => {
      const canvas = document.createElement('canvas');
      canvas.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 400, height: 250, right: 400, bottom: 250 } as DOMRect);
      for (const type of ['mousedown', 'mousemove', 'mouseup']) {
        canvas.addEventListener(type, (event) => mouse(event as MouseEvent));
      }
      target.append(canvas);
      canvases.push(canvas);
      return {
        ...rfb,
        disconnect: () => {
          rfb.disconnect();
          canvas.remove();
        },
      };
    });
    const firstUrl = 'wss://computer.example.org/api/computers/sessions/session-1/stream';
    renderScreen({ createRfb, mode: 'view', url: firstUrl });
    const [canvas] = canvases;

    // Watching: noVNC gets the touch, and the touchpad sends nothing.
    expect(touch('touchstart', canvas, 100, 0).defaultPrevented).toBe(false);
    touch('touchend', canvas, undefined, 50);
    expect(mouse).not.toHaveBeenCalled();

    // In control on the same connection, after the mode went there and back.
    renderScreen({ createRfb, mode: 'control', url: firstUrl });
    renderScreen({ createRfb, mode: 'view', url: firstUrl });
    renderScreen({ createRfb, mode: 'control', url: firstUrl });
    expect(startTouchDrag(canvas, 1000).defaultPrevented).toBe(true);
    expect(createRfb).toHaveBeenCalledOnce();
    // One layer: a tap, then a press and a move, each gesture starting with a release.
    const tapThenDrag = [
      { type: 'mouseup', buttons: 0 },
      { type: 'mousemove', buttons: 0 },
      { type: 'mousedown', buttons: 1 },
      { type: 'mouseup', buttons: 0 },
      { type: 'mouseup', buttons: 0 },
      { type: 'mousedown', buttons: 1 },
      { type: 'mousemove', buttons: 0 },
    ];
    expect(mouse.mock.results.map((result) => result.value)).toEqual(tapThenDrag);

    // A new stream on the same screen sends nothing on the way: its closing lets go.
    renderScreen({
      createRfb,
      mode: 'control',
      url: 'wss://computer.example.org/api/computers/sessions/session-2/stream',
    });
    expect(mouse).toHaveBeenCalledTimes(tapThenDrag.length);
    expect(rfb.disconnect).toHaveBeenCalledOnce();

    // The new stream has its own touchpad, and the old one is gone.
    expect(createRfb).toHaveBeenCalledTimes(2);
    expect(canvases[1].isConnected).toBe(true);
    startTouchDrag(canvases[1], 5000);
    expect(mouse).toHaveBeenCalledTimes(2 * tapThenDrag.length);

    act(() => root.unmount());
    expect(mouse).toHaveBeenCalledTimes(2 * tapThenDrag.length);
    expect(rfb.disconnect).toHaveBeenCalledTimes(2);
  });

  it("releases noVNC's pointer capture when the screen closes mid-drag", () => {
    const { createRfb, getCanvas, sent } = createNoVncLikeRfb();
    try {
      renderScreen({ createRfb, mode: 'control' });
      startTouchDrag(getCanvas(), 0);
      expect(capturedElement()).toBe(getCanvas());
      expect(captureOverlay()?.style.display).toBe('');
      const sentWhileOpen = [...sent];
      expect(sentWhileOpen.slice(-2)).toEqual(['mousedown 1', 'mousemove 0']);

      act(() => root.unmount());

      // The page-covering element is gone, so the next tap or click lands where it is aimed.
      expect(rfb.disconnect).toHaveBeenCalledOnce();
      expect(capturedElement()).toBeNull();
      expect(captureOverlay()?.style.display).toBe('none');
      // Nothing more reached the computer: the release came after the disconnect.
      expect(sent).toEqual(sentWhileOpen);
    } finally {
      releaseCapture();
      captureOverlay()?.remove();
    }
  });

  it("releases noVNC's pointer capture when the stream drops mid-drag", () => {
    const { createRfb, getCanvas, dropStream, sent } = createNoVncLikeRfb();
    try {
      renderScreen({ createRfb, mode: 'control' });
      startTouchDrag(getCanvas(), 0);
      expect(capturedElement()).toBe(getCanvas());
      const sentWhileOpen = [...sent];

      // noVNC disconnects itself first; the panel then drops the stream and the screen.
      dropStream();
      act(() => root.unmount());

      expect(capturedElement()).toBeNull();
      expect(captureOverlay()?.style.display).toBe('none');
      expect(sent).toEqual(sentWhileOpen);
    } finally {
      releaseCapture();
      captureOverlay()?.remove();
    }
  });

  it('dispatches nothing when the screen closes without a drag', () => {
    const windowMouseUp = vi.fn();
    window.addEventListener('mouseup', windowMouseUp);
    try {
      for (const tapFirst of [false, true]) {
        const { createRfb, getCanvas, reached } = createNoVncLikeRfb();
        container.remove();
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
        renderScreen({ createRfb, mode: 'control' });
        if (tapFirst) {
          // A tap's own release lets go of the capture.
          touch('touchstart', getCanvas(), 100, 0);
          touch('touchend', getCanvas(), undefined, 50);
          expect(capturedElement()).toBeNull();
        }
        const reachedBefore = reached.length;
        windowMouseUp.mockClear();

        act(() => root.unmount());

        expect(windowMouseUp).not.toHaveBeenCalled();
        expect(reached).toHaveLength(reachedBefore);
      }
    } finally {
      window.removeEventListener('mouseup', windowMouseUp);
      releaseCapture();
      captureOverlay()?.remove();
    }
  });

  it('sets touch-action none on the screen only while in control', () => {
    const createRfb = createRfbWithCanvas();
    renderScreen({ createRfb, mode: 'view' });
    const { surface } = screenElements();
    // jsdom has no touch-action, so this checks the class that sets it.
    expect(surface.className).toBe('Screen');

    renderScreen({ createRfb, mode: 'control' });
    expect(surface.classList).toContain('Screen');
    expect(surface.classList).toContain('ScreenInControl');

    renderScreen({ createRfb, mode: 'view' });
    expect(surface.className).toBe('Screen');
    expect(createRfb).toHaveBeenCalledOnce();
  });

  it('leaves focus from the keyboard on the screen element while in control', () => {
    renderScreen({ createRfb: createRfbWithCanvas(), mode: 'control' });
    const { surface, canvas } = screenElements();
    vi.mocked(rfb.focus).mockClear();

    // Tab lands here, and must be free to move on: noVNC takes Tab on its canvas.
    surface.focus();
    expect(document.activeElement).toBe(surface);
    canvas.focus();
    expect(rfb.focus).not.toHaveBeenCalled();
  });

  it('keeps focus on the canvas through a press in the letterbox while in control', () => {
    renderScreen({ createRfb: createRfbWithCanvas(), mode: 'control' });
    const { surface } = screenElements();
    vi.mocked(rfb.focus).mockClear();

    surface.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(rfb.focus).toHaveBeenCalledOnce();
    expect(rfb.focus).toHaveBeenCalledWith({ preventScroll: true });
    // Its default would move focus from the canvas back to this element.
    expect(mouseDown(surface).defaultPrevented).toBe(true);
  });

  it('leaves focus on the screen element while watching', () => {
    renderScreen({ createRfb: createRfbWithCanvas(), mode: 'view' });
    const { surface } = screenElements();

    // Shift+Tab from the canvas lands here, and must be free to leave the screen.
    surface.focus();
    expect(document.activeElement).toBe(surface);
    expect(rfb.focus).not.toHaveBeenCalled();
    expect(mouseDown(surface).defaultPrevented).toBe(false);
  });
});
