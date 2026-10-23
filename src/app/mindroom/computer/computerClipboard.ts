// noVNC 1.7 has no browser clipboard sync. This bridge pastes local text only from a
// user's paste, and writes the local clipboard only for a copy gesture.

// Text over this is refused, so a paste stays under the stream proxy's 1 MiB message limit.
export const MAX_PASTE_BYTES = 512 * 1024;
export const COPY_REPLY_TIMEOUT_MS = 2_000;

export type PasteResult = 'sent' | 'too-large';

export type ClipboardRfb = {
  addEventListener(name: 'clipboard', listener: EventListener): void;
  removeEventListener(name: 'clipboard', listener: EventListener): void;
  clipboardPasteFrom(text: string): void;
  sendKey(keysym: number, code: string | null, down?: boolean): void;
};

export type ComputerClipboardOptions = {
  isControlling: () => boolean;
  apple?: boolean; // default isApplePlatform()
  readOnShortcut?: boolean; // default WebKit, which fires no paste on the screen
  clipboard?: Pick<Clipboard, 'readText' | 'write' | 'writeText'>; // default navigator.clipboard
  onPaste?: (result: PasteResult) => void;
};

// X11 keysyms XK_Control_L, XK_Shift_L, XK_V and XK_v.
// The package exports only RFB, not its key table.
const CONTROL_L_KEYSYM = 0xffe3;
const SHIFT_L_KEYSYM = 0xffe1;
const SHIFT_V_KEYSYM = 0x56;
const V_KEYSYM = 0x76;

/** noVNC's own test (`core/util/browser.js` isMac/isIOS), so Cmd handling matches its mapping. */
export function isApplePlatform(platform: string = navigator.platform): boolean {
  return /mac|ipad|iphone|ipod/i.test(platform);
}

// noVNC's isWebKit: Safari and every iOS browser.
const isWebKit = (userAgent: string = navigator.userAgent): boolean =>
  /AppleWebKit\//.test(userAgent) && !/Chrome\//.test(userAgent);

type PendingCopy = {
  resolve: (text: string) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export function attachComputerClipboard(
  target: HTMLElement,
  rfb: ClipboardRfb,
  options: ComputerClipboardOptions
): () => void {
  const { isControlling, onPaste } = options;
  const apple = options.apple ?? isApplePlatform();
  const readOnShortcut = options.readOnShortcut ?? isWebKit();
  // Missing outside a secure context.
  const clipboard = options.clipboard ?? (navigator.clipboard as Clipboard | undefined);
  const doc = target.ownerDocument;
  const view = doc.defaultView ?? window;

  let detached = false;
  let ctrlMapped = false;
  let shiftMapped = false;
  // Off Apple, the Ctrl keys noVNC holds. Its keyboard listens only on its canvas,
  // not on the focusable wrapper around it.
  let leftCtrlHeld = false;
  let rightCtrlHeld = false;
  let shiftDown = false;
  let pendingCopy: PendingCopy | undefined;

  const hasPrimaryModifier = (event: KeyboardEvent) =>
    apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;

  const releaseMappedShift = () => {
    if (!shiftMapped) return;
    shiftMapped = false;
    rfb.sendKey(SHIFT_L_KEYSYM, 'ShiftLeft', false);
  };

  const forgetHeldCtrl = () => {
    leftCtrlHeld = false;
    rightCtrlHeld = false;
  };

  const releaseMappedKeys = () => {
    releaseMappedShift();
    if (!ctrlMapped) return;
    ctrlMapped = false;
    rfb.sendKey(CONTROL_L_KEYSYM, 'ControlLeft', false);
  };

  const sendPaste = (text: string) => {
    if (new TextEncoder().encode(text).length > MAX_PASTE_BYTES) {
      onPaste?.('too-large');
      return;
    }
    if (text) rfb.clipboardPasteFrom(text);
    const keysym = shiftDown ? SHIFT_V_KEYSYM : V_KEYSYM;
    // With no Ctrl held on the remote (a Ctrl pressed outside the screen, or the
    // browser's Edit menu) the whole chord is sent.
    const chord = apple ? !ctrlMapped : !leftCtrlHeld && !rightCtrlHeld;
    // noVNC on Windows holds a left-Ctrl press back up to 100 ms to detect AltGr, and
    // would send it after the v. It is pressed again here, and noVNC's keyup releases it.
    const pressLeftCtrl = !apple && leftCtrlHeld;
    if (chord || pressLeftCtrl) rfb.sendKey(CONTROL_L_KEYSYM, 'ControlLeft', true);
    rfb.sendKey(keysym, 'KeyV', true);
    rfb.sendKey(keysym, 'KeyV', false);
    if (chord) rfb.sendKey(CONTROL_L_KEYSYM, 'ControlLeft', false);
    onPaste?.('sent');
  };

  const takePendingCopy = () => {
    const copy = pendingCopy;
    pendingCopy = undefined;
    if (copy) clearTimeout(copy.timer);
    return copy;
  };

  const startCopy = (local: NonNullable<typeof clipboard>) => {
    takePendingCopy()?.reject(new Error('A newer copy replaced this one.'));
    const text = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => takePendingCopy()?.reject(new Error('The computer sent no clipboard text.')),
        COPY_REPLY_TIMEOUT_MS
      );
      pendingCopy = { resolve, reject, timer };
    });
    // The write starts inside the gesture; the text follows when the computer answers.
    if (typeof ClipboardItem === 'undefined') {
      text.then((value) => local.writeText(value)).catch(() => undefined);
      return;
    }
    const blob = text.then((value) => new Blob([value], { type: 'text/plain' }));
    blob.catch(() => undefined);
    local.write([new ClipboardItem({ 'text/plain': blob })]).catch(() => undefined);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    shiftDown = event.shiftKey;
    if (!isControlling()) return;
    const reachesNoVnc = event.target instanceof HTMLCanvasElement && target.contains(event.target);
    if (!apple && reachesNoVnc && event.code === 'ControlLeft') leftCtrlHeld = true;
    if (!apple && reachesNoVnc && event.code === 'ControlRight') rightCtrlHeld = true;
    if (event.isComposing) return;

    if (apple && event.key === 'Meta') {
      // Cmd acts as Ctrl on the remote; noVNC would send it as Alt.
      event.preventDefault();
      event.stopPropagation();
      if (!ctrlMapped) {
        ctrlMapped = true;
        rfb.sendKey(CONTROL_L_KEYSYM, 'ControlLeft', true);
      }
      return;
    }

    if (ctrlMapped && event.key === 'Shift') {
      // noVNC's Mac path presses and releases every key typed with Cmd, which would drop Shift.
      event.preventDefault();
      event.stopPropagation();
      if (!shiftMapped) {
        shiftMapped = true;
        rfb.sendKey(SHIFT_L_KEYSYM, 'ShiftLeft', true);
      }
      return;
    }

    if (!hasPrimaryModifier(event) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 'v') {
      if (!readOnShortcut) {
        // Hidden from noVNC, whose preventDefault would stop the browser's paste.
        event.stopPropagation();
      } else if (clipboard) {
        // WebKit fires no paste on the screen, so the shortcut reads the clipboard.
        event.preventDefault();
        event.stopPropagation();
        clipboard.readText().then(
          (text) => {
            if (!detached && isControlling()) sendPaste(text);
          },
          () => undefined
        );
      }
      return;
    }
    if ((key === 'c' || key === 'x') && clipboard) startCopy(clipboard);
  };

  const handleKeyUp = (event: KeyboardEvent) => {
    shiftDown = event.shiftKey;
    if (event.code === 'ControlLeft') leftCtrlHeld = false;
    if (event.code === 'ControlRight') rightCtrlHeld = false;
    if (event.key === 'Shift' && shiftMapped) {
      event.preventDefault();
      event.stopPropagation();
      releaseMappedShift();
    } else if (event.key === 'Meta' && ctrlMapped) {
      event.preventDefault();
      event.stopPropagation();
      releaseMappedKeys();
    }
  };

  // Focus can leave with a modifier held, for example on a Cmd+click, and its keyup lands elsewhere.
  const handleFocusOut = (event: FocusEvent) => {
    const next = event.relatedTarget;
    if (next instanceof Node && target.contains(next)) return;
    forgetHeldCtrl();
    releaseMappedKeys();
  };

  // Firefox aims paste at the body and Chromium at any selection elsewhere on the page,
  // so take it at the document while the screen has focus.
  const handlePaste = (event: ClipboardEvent) => {
    if (!isControlling() || !target.contains(doc.activeElement)) return;
    event.preventDefault();
    event.stopPropagation();
    sendPaste(event.clipboardData?.getData('text/plain') ?? '');
  };

  // noVNC releases its keys on window blur.
  const handleBlur = () => {
    forgetHeldCtrl();
    shiftDown = false;
    releaseMappedKeys();
  };

  // A server push without a pending copy gesture never reaches the local clipboard.
  const handleRemoteClipboard = (event: Event) => {
    const text = (event as CustomEvent<{ text?: unknown }>).detail?.text;
    if (typeof text === 'string') takePendingCopy()?.resolve(text);
  };

  target.addEventListener('keydown', handleKeyDown, true);
  target.addEventListener('keyup', handleKeyUp, true);
  target.addEventListener('focusout', handleFocusOut);
  doc.addEventListener('paste', handlePaste, true);
  view.addEventListener('blur', handleBlur);
  rfb.addEventListener('clipboard', handleRemoteClipboard);

  return () => {
    detached = true;
    target.removeEventListener('keydown', handleKeyDown, true);
    target.removeEventListener('keyup', handleKeyUp, true);
    target.removeEventListener('focusout', handleFocusOut);
    doc.removeEventListener('paste', handlePaste, true);
    view.removeEventListener('blur', handleBlur);
    rfb.removeEventListener('clipboard', handleRemoteClipboard);
    takePendingCopy()?.reject(new Error('The computer screen closed.'));
    releaseMappedKeys();
  };
}
