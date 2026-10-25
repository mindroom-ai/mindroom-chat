import React, { useEffect, useRef } from 'react';
import RFB from '@novnc/novnc';
import * as css from './ComputerPanel.css';
import { attachComputerClipboard, type PasteResult } from './computerClipboard';
import { attachComputerTouchpad, releaseNoVncCapture } from './computerTouchpad';

export type RfbClient = {
  addEventListener(name: string, listener: EventListener): void;
  removeEventListener(name: string, listener: EventListener): void;
  disconnect(): void;
  focus(options?: FocusOptions): void;
  clipboardPasteFrom(text: string): void;
  sendKey(keysym: number, code: string | null, down?: boolean): void;
  scaleViewport: boolean;
  viewOnly: boolean;
};

export type RfbFactory = (
  target: HTMLElement,
  url: string,
  options: { wsProtocols: string[] }
) => RfbClient;

export type ComputerScreenProps = {
  url: string;
  protocols: [string, string];
  mode: 'view' | 'control';
  onConnected: () => void;
  onDisconnected: (message?: string) => void;
  onPaste?: (result: PasteResult) => void;
  createRfb?: RfbFactory;
};

const defaultRfbFactory: RfbFactory = (target, url, options) => new RFB(target, url, options);

export function ComputerScreen({
  url,
  protocols,
  mode,
  onConnected,
  onDisconnected,
  onPaste,
  createRfb = defaultRfbFactory,
}: ComputerScreenProps) {
  const targetRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RfbClient>();
  const connectedCallbackRef = useRef(onConnected);
  const disconnectedCallbackRef = useRef(onDisconnected);
  const pasteCallbackRef = useRef(onPaste);
  const modeRef = useRef(mode);

  connectedCallbackRef.current = onConnected;
  disconnectedCallbackRef.current = onDisconnected;
  pasteCallbackRef.current = onPaste;
  modeRef.current = mode;
  const binaryProtocol = protocols[0];
  const ticketProtocol = protocols[1];

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return undefined;

    const rfb = createRfb(target, url, { wsProtocols: [binaryProtocol, ticketProtocol] });
    // noVNC appends its canvas here at once, and takes it out again when it disconnects,
    // which a dropped stream does before the screen unmounts.
    const canvas = target.querySelector('canvas');
    rfb.scaleViewport = true;
    rfbRef.current = rfb;

    const handleConnect = () => connectedCallbackRef.current();
    const handleDisconnect = (event: Event) => {
      const detail = (event as CustomEvent<{ clean?: boolean }>).detail;
      disconnectedCallbackRef.current(
        detail?.clean === false ? 'The computer connection was interrupted.' : undefined
      );
    };
    const handleSecurityFailure = () =>
      disconnectedCallbackRef.current('The computer connection was denied.');
    const keepInputInsideComputer = (event: Event) => event.stopPropagation();
    // onPointerDown puts focus on the canvas, where noVNC's keyboard listens. A press in the
    // letterbox margin would then move it back to the screen element, so in control it is
    // cancelled. Focus from Tab stays on the screen element, as noVNC takes Tab on its canvas.
    const keepPressFocusOnCanvas = (event: MouseEvent) => {
      if (modeRef.current === 'control') event.preventDefault();
    };

    rfb.addEventListener('connect', handleConnect);
    rfb.addEventListener('disconnect', handleDisconnect);
    rfb.addEventListener('securityfailure', handleSecurityFailure);
    target.addEventListener('keydown', keepInputInsideComputer);
    target.addEventListener('paste', keepInputInsideComputer);
    target.addEventListener('mousedown', keepPressFocusOnCanvas);
    // Read through refs, so a change of mode never reconnects the stream.
    const isControlling = () => modeRef.current === 'control';
    const detachClipboard = attachComputerClipboard(target, rfb, {
      isControlling,
      onPaste: (result) => pasteCallbackRef.current?.(result),
    });
    const detachTouchpad = attachComputerTouchpad(target, { isControlling });

    return () => {
      // Before the disconnect, so a mapped Ctrl or Shift is released on the open socket. A held
      // touchpad drag is too when this screen gets a new url; the panel mounts a new screen
      // for each stream instead, and on unmount the screen has left the page already, so the
      // stream closing lets go of the button.
      detachClipboard();
      detachTouchpad();
      rfb.removeEventListener('connect', handleConnect);
      rfb.removeEventListener('disconnect', handleDisconnect);
      rfb.removeEventListener('securityfailure', handleSecurityFailure);
      target.removeEventListener('keydown', keepInputInsideComputer);
      target.removeEventListener('paste', keepInputInsideComputer);
      target.removeEventListener('mousedown', keepPressFocusOnCanvas);
      rfbRef.current = undefined;
      rfb.disconnect();
      // A drag held at the close, or when the stream dropped, still has noVNC's page-covering
      // capture element up.
      releaseNoVncCapture(canvas);
    };
  }, [binaryProtocol, createRfb, ticketProtocol, url]);

  useEffect(() => {
    const rfb = rfbRef.current;
    if (!rfb) return;
    rfb.viewOnly = mode !== 'control';
    if (mode === 'control') {
      rfb.focus({ preventScroll: true });
    }
  }, [mode]);

  return (
    <div
      ref={targetRef}
      // In control, touches drive the touchpad: no page scroll or zoom on the screen.
      className={mode === 'control' ? `${css.Screen} ${css.ScreenInControl}` : css.Screen}
      data-mindroom-computer-input
      onPointerDown={() => rfbRef.current?.focus({ preventScroll: true })}
      role="application"
      aria-label="Agent computer"
      // The RFB surface must receive raw keyboard input while the user controls it.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
    />
  );
}

export default ComputerScreen;
