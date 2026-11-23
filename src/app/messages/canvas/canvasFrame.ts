import { type RefObject, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { isDesktopApp } from '../../lib/nativeShell';

export const CANVAS_FRAME_SRC = '/canvas-frame.html';
export const CANVAS_FRAME_READY = 'canvas-frame-ready';

/** Chooses `srcDoc` on web/phone or `/canvas-frame.html` handshake in the desktop shell. */
export const useCanvasFrame = (
  doc: string,
  frame: RefObject<HTMLIFrameElement | null>,
  onLoad: () => void
): ({ srcDoc: string } | { src: string }) & { onLoad: () => void; generation: number } => {
  const desktop = isDesktopApp();
  const [state, setState] = useState({ doc, generation: 0 });
  const generation = desktop ? (state.doc === doc ? state.generation : state.generation + 1) : 0;
  if (desktop && state.doc !== doc) setState({ doc, generation });

  const onLoadRef = useRef(onLoad);
  const writtenRef = useRef(new WeakSet<MessageEventSource>());
  const loadedRef = useRef(new WeakSet<HTMLIFrameElement>());

  useLayoutEffect(() => {
    onLoadRef.current = onLoad;
  });

  useLayoutEffect(() => {
    if (!desktop) return undefined;
    const onMessage = (event: MessageEvent) => {
      const win = frame.current?.contentWindow;
      if (
        !win ||
        event.source !== win ||
        event.origin !== 'null' ||
        event.data !== CANVAS_FRAME_READY ||
        writtenRef.current.has(win)
      )
        return;
      writtenRef.current.add(win);
      win.postMessage(doc, '*');
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [desktop, doc, frame]);

  const counted = useCallback(() => {
    const el = frame.current;
    if (!el) return;
    if (!loadedRef.current.has(el)) {
      loadedRef.current.add(el);
      return;
    }
    onLoadRef.current();
  }, [frame]);

  return desktop
    ? { src: CANVAS_FRAME_SRC, onLoad: counted, generation }
    : { srcDoc: doc, onLoad, generation: 0 };
};
