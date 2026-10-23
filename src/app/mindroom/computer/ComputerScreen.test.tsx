// @vitest-environment jsdom

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComputerScreen, type ComputerScreenProps, type RfbClient } from './ComputerScreen';

vi.mock('./ComputerPanel.css.ts', () => ({
  Screen: 'Screen',
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
