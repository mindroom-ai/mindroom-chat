import { type RefObject, useCallback, useEffect, useRef } from 'react';
import { isDesktopApp } from '../../lib/nativeShell';

export const CANVAS_FRAME_SRC = '/canvas-frame.html';
export const CANVAS_FRAME_READY = 'canvas-frame-ready';

/** Chooses `srcDoc` on web/phone or `/canvas-frame.html` handshake in the desktop shell. */
export const useCanvasFrame = (
  doc: string,
  frame: RefObject<HTMLIFrameElement>,
  onLoad: () => void
): ({ srcDoc: string } | { src: string }) & { onLoad: () => void; generation: number } => {
  const desktop = isDesktopApp();
  const docRef = useRef(doc);
  const generationRef = useRef(0);
  if (desktop && docRef.current !== doc) generationRef.current += 1;
  docRef.current = doc;

  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;
  const writtenRef = useRef(new WeakSet<MessageEventSource>());
  const loadedRef = useRef(new WeakSet<HTMLIFrameElement>());

  useEffect(() => {
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
      win.postMessage(docRef.current, '*');
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [desktop, frame]);

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
    ? { src: CANVAS_FRAME_SRC, onLoad: counted, generation: generationRef.current }
    : { srcDoc: doc, onLoad, generation: 0 };
};
