// @vitest-environment jsdom
import React, { useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopBridge } from '../../lib/desktopBridge';
import { CANVAS_FRAME_READY, useCanvasFrame } from './canvasFrame';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const setDesktop = (enabled: boolean): void => {
  if (!enabled) {
    Reflect.deleteProperty(window, 'mindroomDesktop');
    return;
  }
  const bridge: DesktopBridge = { onShellEvent: () => () => undefined };
  Object.defineProperty(window, 'mindroomDesktop', { configurable: true, value: bridge });
};

const stubFrameWindow = (frame: HTMLIFrameElement) => {
  const postMessage = vi.fn();
  const win = { postMessage } as unknown as Window;
  Object.defineProperty(frame, 'contentWindow', { configurable: true, value: win });
  return { win, postMessage };
};

const sendReady = (source: Window | null, origin = 'null', data: unknown = CANVAS_FRAME_READY) => {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { source, origin, data }));
  });
};

describe('useCanvasFrame', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    setDesktop(false);
  });

  const renderHarness = (props: { doc: string; onLoad: () => void; extraKey?: number }) => {
    let latestResult: ReturnType<typeof useCanvasFrame> | undefined;
    function Harness({
      doc,
      onLoad,
      extraKey = 0,
    }: {
      doc: string;
      onLoad: () => void;
      extraKey?: number;
    }) {
      const ref = useRef<HTMLIFrameElement>(null);
      const result = useCanvasFrame(doc, ref, onLoad);
      latestResult = result;
      const { generation, ...frameProps } = result;
      return <iframe key={`${extraKey}:${generation}`} ref={ref} title="Canvas" {...frameProps} />;
    }
    const render = (next = props) => {
      act(() => root.render(<Harness {...next} />));
    };
    render(props);
    return {
      render,
      result: () => latestResult!,
      frame: () => container.querySelector('iframe')!,
    };
  };

  it('returns srcDoc, the original onLoad, and generation 0 outside the desktop app', () => {
    const onLoad = vi.fn();
    const harness = renderHarness({ doc: '<p>v1</p>', onLoad });

    expect(harness.result()).toEqual({ srcDoc: '<p>v1</p>', onLoad, generation: 0 });
    const first = harness.frame();
    expect(first.getAttribute('srcdoc')).toBe('<p>v1</p>');
    expect(first.getAttribute('src')).toBeNull();

    const { win, postMessage } = stubFrameWindow(first);
    sendReady(win);
    expect(postMessage).not.toHaveBeenCalled();

    act(() => {
      first.dispatchEvent(new Event('load'));
    });
    expect(onLoad).toHaveBeenCalledTimes(1);

    harness.render({ doc: '<p>v2</p>', onLoad });
    expect(harness.result()).toEqual({ srcDoc: '<p>v2</p>', onLoad, generation: 0 });
    expect(harness.frame()).toBe(first);
  });

  it('uses /canvas-frame.html in the desktop app, posts once after opaque ready, and counts loads per frame', () => {
    setDesktop(true);
    const onLoad = vi.fn();
    const harness = renderHarness({ doc: '<p>hello</p>', onLoad });

    expect(harness.result().generation).toBe(0);
    expect('src' in harness.result() ? harness.result().src : undefined).toBe('/canvas-frame.html');
    const first = harness.frame();
    expect(first.getAttribute('src')).toBe('/canvas-frame.html');
    expect(first.getAttribute('srcdoc')).toBeNull();

    const { win, postMessage } = stubFrameWindow(first);
    const otherWin = { postMessage: vi.fn() } as unknown as Window;

    // Wrong source, wrong origin, wrong payload are ignored.
    sendReady(otherWin, 'null');
    sendReady(win, 'capacitor://localhost');
    sendReady(win, 'https://example.org');
    sendReady(win, 'null', 'not-ready');
    expect(postMessage).not.toHaveBeenCalled();
    expect(otherWin.postMessage).not.toHaveBeenCalled();

    // Valid ready from own frame with opaque origin posts doc once.
    sendReady(win, 'null');
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith('<p>hello</p>', '*');

    // A second ready from the same window gets nothing.
    sendReady(win, 'null');
    expect(postMessage).toHaveBeenCalledTimes(1);

    // Two loads reach the host as one; a third reaches the host as a second.
    act(() => {
      first.dispatchEvent(new Event('load'));
    });
    expect(onLoad).toHaveBeenCalledTimes(0);
    act(() => {
      first.dispatchEvent(new Event('load'));
    });
    expect(onLoad).toHaveBeenCalledTimes(1);
    act(() => {
      first.dispatchEvent(new Event('load'));
    });
    expect(onLoad).toHaveBeenCalledTimes(2);
  });

  it('raises generation on a changed doc, posts to the new frame, and never to the old', () => {
    setDesktop(true);
    const onLoad = vi.fn();
    const harness = renderHarness({ doc: '<p>doc-1</p>', onLoad });
    const first = harness.frame();
    const firstWin = stubFrameWindow(first);

    harness.render({ doc: '<p>doc-2</p>', onLoad });
    expect(harness.result().generation).toBe(1);
    const second = harness.frame();
    expect(second).not.toBe(first);
    const secondWin = stubFrameWindow(second);

    // Late ready from the old frame never receives anything.
    sendReady(firstWin.win, 'null');
    expect(firstWin.postMessage).not.toHaveBeenCalled();

    // Ready from the new frame receives the new document.
    sendReady(secondWin.win, 'null');
    expect(secondWin.postMessage).toHaveBeenCalledTimes(1);
    expect(secondWin.postMessage).toHaveBeenCalledWith('<p>doc-2</p>', '*');

    // First load on the new frame is swallowed, second forwarded.
    act(() => {
      second.dispatchEvent(new Event('load'));
    });
    expect(onLoad).toHaveBeenCalledTimes(0);
    act(() => {
      second.dispatchEvent(new Event('load'));
    });
    expect(onLoad).toHaveBeenCalledTimes(1);
  });

  it('re-handshakes and swallows the first load again when remounted with the same doc', () => {
    setDesktop(true);
    const onLoad = vi.fn();
    const harness = renderHarness({ doc: '<p>same</p>', onLoad, extraKey: 0 });
    const first = harness.frame();
    const firstWin = stubFrameWindow(first);

    sendReady(firstWin.win, 'null');
    expect(firstWin.postMessage).toHaveBeenCalledTimes(1);
    act(() => {
      first.dispatchEvent(new Event('load'));
      first.dispatchEvent(new Event('load'));
    });
    expect(onLoad).toHaveBeenCalledTimes(1);

    // Remount iframe with the exact same doc (e.g., escape reload).
    harness.render({ doc: '<p>same</p>', onLoad, extraKey: 1 });
    expect(harness.result().generation).toBe(0);
    const second = harness.frame();
    expect(second).not.toBe(first);
    const secondWin = stubFrameWindow(second);

    sendReady(secondWin.win, 'null');
    expect(secondWin.postMessage).toHaveBeenCalledTimes(1);
    expect(secondWin.postMessage).toHaveBeenCalledWith('<p>same</p>', '*');

    act(() => {
      second.dispatchEvent(new Event('load'));
    });
    expect(onLoad).toHaveBeenCalledTimes(1);
    act(() => {
      second.dispatchEvent(new Event('load'));
    });
    expect(onLoad).toHaveBeenCalledTimes(2);
  });
});
