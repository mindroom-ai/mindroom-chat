import { type Ref, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import RFB from '@novnc/novnc';
import * as css from './ComputerPanel.css';
import { attachComputerClipboard, isApplePlatform, type PasteResult } from './computerClipboard';
import { attachComputerSoftKeyboard } from './computerSoftKeyboard';
import { attachComputerTouchpad, releaseNoVncCapture } from './computerTouchpad';

export type RfbClient = {
  addEventListener(name: string, listener: EventListener): void;
  removeEventListener(name: string, listener: EventListener): void;
  disconnect(): void;
  focus(options?: FocusOptions): void;
  clipboardPasteFrom(text: string): void;
  sendKey(keysym: number, code: string | null, down?: boolean): void;
  scaleViewport: boolean;
  background: string;
  viewOnly: boolean;
  focusOnClick: boolean;
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
  holdingFrame?: boolean;
  onConnected: (width: number, height: number) => void;
  onDisconnected: (message?: string) => void;
  onPaste?: (result: PasteResult) => void;
  /** Whether the software keyboard is open: its textarea has focus. */
  onKeyboardChange?: (open: boolean) => void;
  createRfb?: RfbFactory;
  ref?: Ref<ComputerScreenHandle>;
};

export type ComputerScreenHandle = {
  captureFrame(): HTMLCanvasElement | undefined;
  /**
   * Opens the software keyboard while in control. Call it from the tap's own handler: iOS shows
   * the keyboard only for a focus that runs inside the user's gesture.
   */
  openKeyboard(): void;
  closeKeyboard(): void;
};

const defaultRfbFactory: RfbFactory = (target, url, options) => new RFB(target, url, options);

export function ComputerScreen({
  url,
  protocols,
  mode,
  holdingFrame = false,
  onConnected,
  onDisconnected,
  onPaste,
  onKeyboardChange,
  createRfb = defaultRfbFactory,
  ref,
}: ComputerScreenProps) {
  const targetRef = useRef<HTMLDivElement>(null);
  const keyboardInputRef = useRef<HTMLTextAreaElement>(null);
  const rfbRef = useRef<RfbClient>(undefined);
  const holdingFrameRef = useRef(false);
  const defaultBackgroundRef = useRef('');
  const connectedCallbackRef = useRef(onConnected);
  const disconnectedCallbackRef = useRef(onDisconnected);
  const pasteCallbackRef = useRef(onPaste);
  const keyboardCallbackRef = useRef(onKeyboardChange);
  const modeRef = useRef(mode);
  const showTouchpadPointerRef = useRef<() => void>(undefined);

  connectedCallbackRef.current = onConnected;
  disconnectedCallbackRef.current = onDisconnected;
  pasteCallbackRef.current = onPaste;
  keyboardCallbackRef.current = onKeyboardChange;
  modeRef.current = mode;
  const binaryProtocol = protocols[0];
  const ticketProtocol = protocols[1];

  // Focus on the software keyboard's textarea, which keeps the keyboard up.
  const keyboardIsOpen = () => {
    const input = keyboardInputRef.current;
    return !!input && input.ownerDocument.activeElement === input;
  };

  useImperativeHandle(
    ref,
    () => ({
      captureFrame: () => {
        try {
          const canvas = targetRef.current?.querySelector('canvas');
          if (!canvas?.width || !canvas.height) return undefined;
          const frame = canvas.ownerDocument.createElement('canvas');
          frame.width = canvas.width;
          frame.height = canvas.height;
          const context = frame.getContext('2d');
          if (!context) return undefined;
          context.drawImage(canvas, 0, 0);
          return frame;
        } catch {
          // A failed snapshot must not stop the release.
          return undefined;
        }
      },
      openKeyboard: () => {
        if (modeRef.current !== 'control') return;
        keyboardInputRef.current?.focus({ preventScroll: true });
      },
      closeKeyboard: () => {
        if (!keyboardIsOpen()) return;
        // Back to the canvas, where noVNC's keyboard listens, as after a tap on the screen.
        rfbRef.current?.focus({ preventScroll: true });
        if (keyboardIsOpen()) keyboardInputRef.current?.blur();
      },
    }),
    []
  );

  useEffect(() => {
    const target = targetRef.current;
    const keyboardInput = keyboardInputRef.current;
    if (!target || !keyboardInput) return undefined;

    const rfb = createRfb(target, url, { wsProtocols: [binaryProtocol, ticketProtocol] });
    // noVNC appends its canvas here at once, and takes it out again when it disconnects,
    // which a dropped stream does before the screen unmounts.
    const canvas = target.querySelector('canvas');
    rfb.scaleViewport = true;
    defaultBackgroundRef.current = rfb.background;
    if (holdingFrameRef.current) rfb.background = 'transparent';
    rfbRef.current = rfb;

    // Read through refs, so a change of mode never reconnects the stream.
    const isControlling = () => modeRef.current === 'control';
    const touchpad = attachComputerTouchpad(target, { isControlling });
    showTouchpadPointerRef.current = touchpad.showPointer;

    const handleConnect = () => {
      // noVNC sizes the framebuffer before connect, even if it hasn't painted yet.
      connectedCallbackRef.current(canvas?.width ?? 0, canvas?.height ?? 0);
      touchpad.showPointer();
    };
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
    // cancelled; with the software keyboard open, focus stays in its textarea that way too.
    // Focus from Tab stays on the screen element, as noVNC takes Tab on its canvas.
    const keepPressFocusOnCanvas = (event: MouseEvent) => {
      if (modeRef.current === 'control') event.preventDefault();
    };

    rfb.addEventListener('connect', handleConnect);
    rfb.addEventListener('disconnect', handleDisconnect);
    rfb.addEventListener('securityfailure', handleSecurityFailure);
    target.addEventListener('keydown', keepInputInsideComputer);
    target.addEventListener('paste', keepInputInsideComputer);
    target.addEventListener('mousedown', keepPressFocusOnCanvas);
    const detachClipboard = attachComputerClipboard(target, rfb, {
      isControlling,
      onPaste: (result) => pasteCallbackRef.current?.(result),
    });

    const detachSoftKeyboard = attachComputerSoftKeyboard(keyboardInput, rfb, { isControlling });
    const reportKeyboard = (open: boolean) => {
      // While the keyboard is open, noVNC must not take focus to its canvas on the touchpad's
      // press, which would close the keyboard, as noVNC's own app does for its keyboard.
      rfb.focusOnClick = !open;
      keyboardCallbackRef.current?.(open);
    };
    // From focus, so the keyboard's own Done or dismiss gesture closes it here too.
    const handleKeyboardFocus = () => reportKeyboard(true);
    const handleKeyboardBlur = () => reportKeyboard(false);
    // A key held on the canvas when typing moves here is released here, and noVNC lets go of
    // its keys otherwise only on window blur. So every keyup goes on to the canvas: noVNC sends
    // a release only for a key it holds, which makes a software keyboard's keyup do nothing.
    // noVNC reads its `code`, and the clipboard bridge its `key` and `shiftKey` too. Not Caps
    // Lock on Apple, where noVNC holds it never and toggles it on every keyup.
    const apple = isApplePlatform();
    const releaseOnCanvas = (event: KeyboardEvent) => {
      if (!canvas || (apple && event.code === 'CapsLock')) return;
      const { code, key, shiftKey } = event;
      canvas.dispatchEvent(new KeyboardEvent('keyup', { code, key, shiftKey }));
    };
    keyboardInput.addEventListener('focus', handleKeyboardFocus);
    keyboardInput.addEventListener('blur', handleKeyboardBlur);
    keyboardInput.addEventListener('keyup', releaseOnCanvas);

    return () => {
      keyboardInput.removeEventListener('focus', handleKeyboardFocus);
      keyboardInput.removeEventListener('blur', handleKeyboardBlur);
      keyboardInput.removeEventListener('keyup', releaseOnCanvas);
      // A new stream starts with the keyboard closed. On unmount the textarea has left the page
      // already, which took its focus and closed the keyboard.
      if (keyboardInput.ownerDocument.activeElement === keyboardInput) keyboardInput.blur();
      reportKeyboard(false);
      detachSoftKeyboard();
      // Before the disconnect, so a mapped Ctrl or Shift is released on the open socket.
      detachClipboard();
      touchpad.detach();
      showTouchpadPointerRef.current = undefined;
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

  useLayoutEffect(() => {
    // Change the background in the same paint as the panel's held layer.
    holdingFrameRef.current = holdingFrame;
    const rfb = rfbRef.current;
    if (rfb) rfb.background = holdingFrame ? 'transparent' : defaultBackgroundRef.current;
  }, [holdingFrame]);

  useEffect(() => {
    // Watching, nothing is typed: the keyboard closes.
    if (mode !== 'control' && keyboardIsOpen()) keyboardInputRef.current?.blur();
    const rfb = rfbRef.current;
    if (!rfb) return;
    rfb.viewOnly = mode !== 'control';
    if (mode === 'control') {
      rfb.focus({ preventScroll: true });
      // Once noVNC is no longer view-only, so the computer's pointer goes there too.
      showTouchpadPointerRef.current?.();
    }
  }, [mode]);

  return (
    <div
      ref={targetRef}
      // In control, touches drive the touchpad: no page scroll or zoom on the screen.
      className={mode === 'control' ? `${css.Screen} ${css.ScreenInControl}` : css.Screen}
      data-mindroom-computer-input
      onPointerDown={() => {
        // A tap while the software keyboard is open keeps it up.
        if (!keyboardIsOpen()) rfbRef.current?.focus({ preventScroll: true });
      }}
      role="application"
      aria-label="Agent computer"
      // The RFB surface must receive raw keyboard input while the user controls it.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
    >
      {/* Inside the screen, so its paste and keys stay with the computer like the canvas's. */}
      <textarea
        ref={keyboardInputRef}
        className={css.KeyboardInput}
        aria-label="Type on the computer"
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        // Watching, nothing is typed, and a screen reader's focus brings up no keyboard.
        readOnly={mode !== 'control'}
        spellCheck={false}
        // Tab and Shift+Tab pass it by: a hardware keyboard types on the canvas.
        tabIndex={-1}
      />
    </div>
  );
}

export default ComputerScreen;
