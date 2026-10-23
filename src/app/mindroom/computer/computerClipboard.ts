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

// X11 keysyms XK_Control_L, XK_V and XK_v. The package exports only RFB, not its key table.
const CONTROL_L_KEYSYM = 0xffe3;
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
  let ctrlDown = false;
  let shiftDown = false;
  let pendingCopy: PendingCopy | undefined;

  const hasPrimaryModifier = (event: KeyboardEvent) =>
    apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;

  const releaseMappedCtrl = () => {
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
    // After the shortcut the remote already holds Ctrl; a menu paste sends the whole chord.
    const chord = !(apple ? ctrlMapped : ctrlDown);
    if (chord) rfb.sendKey(CONTROL_L_KEYSYM, 'ControlLeft', true);
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
    ctrlDown = event.ctrlKey;
    shiftDown = event.shiftKey;
    if (!isControlling() || event.isComposing) return;

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
    ctrlDown = event.ctrlKey;
    shiftDown = event.shiftKey;
    if (event.key !== 'Meta' || !ctrlMapped) return;
    event.preventDefault();
    event.stopPropagation();
    releaseMappedCtrl();
  };

  // Firefox aims paste at the body and Chromium at any selection elsewhere on the page,
  // so take it at the document while the screen has focus.
  const handlePaste = (event: ClipboardEvent) => {
    if (!isControlling() || !target.contains(doc.activeElement)) return;
    event.preventDefault();
    event.stopPropagation();
    sendPaste(event.clipboardData?.getData('text/plain') ?? '');
  };

  const handleBlur = () => {
    ctrlDown = false;
    shiftDown = false;
    releaseMappedCtrl();
  };

  // A server push without a pending copy gesture never reaches the local clipboard.
  const handleRemoteClipboard = (event: Event) => {
    const text = (event as CustomEvent<{ text?: unknown }>).detail?.text;
    if (typeof text === 'string') takePendingCopy()?.resolve(text);
  };

  target.addEventListener('keydown', handleKeyDown, true);
  target.addEventListener('keyup', handleKeyUp, true);
  doc.addEventListener('paste', handlePaste, true);
  view.addEventListener('blur', handleBlur);
  rfb.addEventListener('clipboard', handleRemoteClipboard);

  return () => {
    detached = true;
    target.removeEventListener('keydown', handleKeyDown, true);
    target.removeEventListener('keyup', handleKeyUp, true);
    doc.removeEventListener('paste', handlePaste, true);
    view.removeEventListener('blur', handleBlur);
    rfb.removeEventListener('clipboard', handleRemoteClipboard);
    takePendingCopy()?.reject(new Error('The computer screen closed.'));
    releaseMappedCtrl();
  };
}
