/**
 * Keyboard focus for the layers React portals into `<body>` or `#portalContainer`: menus,
 * popovers and dialogs.
 *
 * - Many menus open with `initialFocus: false`, so a mouse click does not ring their first item.
 *   Opened with Enter or Space instead, a layer whose opener keeps focus gets focus on its first
 *   control, as a menu button should.
 * - A dialog or alert dialog takes focus as it opens, however it was opened, so a screen reader
 *   announces it and Tab starts inside it: an alert dialog on itself (its name and question are
 *   read, and Enter confirms nothing by accident), any other dialog on its first control. When that
 *   control is a text field, the dialog takes focus itself instead: no on-screen keyboard covers
 *   it, and a key such as Settings' `/` still finds no text field focused. A dialog that wants its
 *   field focused (Invite, Join a Room) focuses it itself.
 * - Tab never leaves an open dialog: when it would (Safari's Option+Tab, which some focus scopes let
 *   through, or plain Tab skipping the buttons with Safari's default setting), focus wraps around to
 *   the dialog's other end.
 * - A layer that closes after a key press (Escape, or Enter on one of its items) would leave focus
 *   on `<body>`; focus goes back to the control it came from. A dialog gives focus back however it
 *   closed. After a pointer press on a menu nothing moves, so a click elsewhere keeps its own focus.
 */

const PORTAL_CONTAINER_ID = 'portalContainer';
const APP_ROOT_ID = 'root';
/** How long after Enter or Space a new layer still counts as opened by that key. */
const KEY_OPEN_WINDOW_MS = 400;
/** How long after a press a new dialog still counts as opened by it, and its control as opener. */
const DIALOG_OPEN_WINDOW_MS = 1000;

const TABBABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/** Layers that only announce or describe; they never take focus. */
const PASSIVE_ROLES = new Set(['tooltip', 'status', 'alert', 'log', 'presentation', 'none']);

/** Controls whose Enter or Space can open a layer. */
const OPENER_SELECTOR = 'button, [role="button"], [role="menuitem"], [role="tab"], a[href]';

const DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"]';

/** Fields that bring up an on-screen keyboard when they take focus. */
const isTextEntry = (element: HTMLElement): boolean =>
  element.matches('textarea, [contenteditable="true"]') ||
  (element.matches('input') &&
    !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(
      (element as HTMLInputElement).type
    ));

type Doc = Document & { defaultView: (Window & typeof globalThis) | null };

/**
 * Marks an element in the app's own tree whose children are layers as those in `<body>` are (a
 * phone's members sheet, below the top bar); `observeLayerHost` sets it.
 */
export const LAYER_HOST_ATTRIBUTE = 'data-layer-host';

const isLayerParent = (doc: Document, parent: Element | null): boolean =>
  !!parent &&
  (parent === doc.body ||
    parent.id === PORTAL_CONTAINER_ID ||
    parent.hasAttribute(LAYER_HOST_ATTRIBUTE));

/** The installed managers' observers, which a layer host joins while it is there. */
const observers = new Set<MutationObserver>();

/** Makes `host` a layer host, watched for layers coming and going. */
export const observeLayerHost = (host: Element): void => {
  host.setAttribute(LAYER_HOST_ATTRIBUTE, '');
  observers.forEach((observer) => observer.observe(host, { childList: true }));
};

/** The portaled layer that holds `node`, or undefined for the app itself. */
export const layerOf = (doc: Document, node: Node | null | undefined): Element | undefined => {
  let element: Element | null =
    node instanceof doc.defaultView!.Element ? node : node?.parentElement ?? null;
  while (element && element.parentElement && !isLayerParent(doc, element.parentElement)) {
    element = element.parentElement;
  }
  if (!element || !isLayerParent(doc, element.parentElement)) return undefined;
  if (element.id === APP_ROOT_ID || element.id === PORTAL_CONTAINER_ID) return undefined;
  return element;
};

const isPassiveLayer = (layer: Element): boolean =>
  layer.getAttribute('aria-hidden') === 'true' ||
  PASSIVE_ROLES.has(layer.getAttribute('role') ?? '') ||
  layer.hasAttribute('aria-live') ||
  ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(layer.tagName) ||
  !(layer instanceof (layer.ownerDocument.defaultView?.HTMLElement ?? HTMLElement)) ||
  // A hover or focus tooltip, which pops out like a menu but holds no controls of its own.
  (!!layer.querySelector('[role="tooltip"]') &&
    !layer.querySelector('[role="dialog"], [role="menu"], [role="listbox"]'));

const isShown = (element: HTMLElement): boolean =>
  element.isConnected &&
  element.getClientRects().length > 0 &&
  !element.closest('[inert], [aria-hidden="true"]');

/** The first control of `layer` that Tab would reach. */
export const firstTabbable = (layer: Element): HTMLElement | undefined =>
  Array.from(layer.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)).find(isShown);

const canTakeFocus = (element: HTMLElement): boolean =>
  isShown(element) && !(element as HTMLButtonElement).disabled;

/** The controls in `element` that Tab reaches, in order. */
export const tabbablesOf = (element: Element): HTMLElement[] =>
  Array.from(element.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)).filter(canTakeFocus);

/** The dialog a layer is or holds. */
const dialogOf = (layer: Element): HTMLElement | undefined => {
  const dialog = layer.matches(DIALOG_SELECTOR) ? layer : layer.querySelector(DIALOG_SELECTOR);
  return dialog instanceof (layer.ownerDocument.defaultView?.HTMLElement ?? HTMLElement)
    ? dialog
    : undefined;
};

/** Where a dialog's focus starts; see the module comment. */
const dialogFocusTarget = (dialog: HTMLElement): HTMLElement => {
  if (dialog.getAttribute('role') === 'alertdialog') return dialog;
  const first = firstTabbable(dialog);
  if (!first || isTextEntry(first)) return dialog;
  return first;
};

/** A press that may open a layer: the control it was on and the layer that held that control. */
type Press = {
  opener: HTMLElement;
  openerLayer: Element | undefined;
  at: number;
};

/** Starts the behavior on `doc`; returns a function that stops it. */
export const installOverlayFocus = (doc: Document = document): (() => void) => {
  const win = (doc as Doc).defaultView;
  if (!win || !doc.body) return () => undefined;

  const openers = new WeakMap<Element, HTMLElement>();
  /** The layer that holds a layer's opener, for a menu opened from another menu. */
  const parents = new WeakMap<Element, Element>();
  let lastInput: 'keyboard' | 'pointer' | undefined;
  let lastFocused: HTMLElement | undefined;
  /** The control Enter or Space was pressed on, and the layer that held it. */
  let keyOpen: Press | undefined;
  /** The control the last pointer press was on, which Safari does not focus. */
  let pointerPress: Press | undefined;
  /** Layers that held a dialog when they opened; they give focus back however they close. */
  const dialogLayers = new WeakSet<Element>();

  /** Whether `layer` is `ancestor`, or was opened from it directly or through other layers. */
  const openedFrom = (layer: Element, ancestor: Element): boolean => {
    for (let current: Element | undefined = layer; current; current = parents.get(current)) {
      if (current === ancestor) return true;
    }
    return false;
  };

  /**
   * Records the control that opened `layer`. The layer that held it is given when the control may
   * be gone already, as a menu item is once its menu closes.
   */
  const remember = (
    layer: Element,
    opener: HTMLElement | undefined,
    openerLayer = layerOf(doc, opener)
  ) => {
    if (!opener || openers.has(layer)) return;
    // Focus can come back to a dialog from a popover it opened (a picker that closes): that
    // control is no opener of the dialog, and taking it for one would make the two layers each
    // other's parent, a loop for the walk back to an opener.
    if (openerLayer && openedFrom(openerLayer, layer)) return;
    openers.set(layer, opener);
    if (openerLayer) parents.set(layer, openerLayer);
  };

  const onFocusIn = (event: FocusEvent) => {
    const target = event.target as HTMLElement | null;
    const layer = layerOf(doc, target);
    if (layer) {
      const from = event.relatedTarget instanceof win.HTMLElement ? event.relatedTarget : undefined;
      remember(layer, from ?? (lastFocused?.isConnected ? lastFocused : undefined));
    }
    if (target instanceof win.HTMLElement) lastFocused = target;
  };

  const pressOn = (opener: Element | null | undefined): Press | undefined =>
    opener instanceof win.HTMLElement
      ? { opener, openerLayer: layerOf(doc, opener), at: win.performance.now() }
      : undefined;

  /** After Tab has moved focus out of the dialog it was in, puts it back at the other end. */
  const keepTabInDialog = (event: KeyboardEvent) => {
    const from = layerOf(doc, event.target as Node | null);
    if (!from || !dialogLayers.has(from)) return;
    win.setTimeout(() => {
      const active = doc.activeElement;
      const to = layerOf(doc, active);
      if (!from.isConnected || (to && openedFrom(to, from))) return;
      const dialog = dialogOf(from);
      const tabbables = dialog ? tabbablesOf(dialog) : [];
      // From the end Tab went past, the first control that takes the focus: a browser may refuse
      // one that looks tabbable (WebKit, a scroll region).
      const fromEdge = event.shiftKey ? tabbables.reverse() : tabbables;
      const landed = fromEdge.some((control) => {
        control.focus({ preventScroll: true });
        return doc.activeElement === control;
      });
      if (!landed) dialog?.focus({ preventScroll: true });
    }, 0);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Tab') keepTabInDialog(event);
    lastInput = 'keyboard';
    const plain = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    const target = event.target as Element | null;
    keyOpen =
      plain && (event.key === 'Enter' || event.key === ' ')
        ? pressOn(target?.closest?.(OPENER_SELECTOR))
        : undefined;
    pointerPress = undefined;
  };

  const onPointerDown = (event: Event) => {
    lastInput = 'pointer';
    keyOpen = undefined;
    const target = event.target as Element | null;
    pointerPress = pressOn(target?.closest?.(OPENER_SELECTOR));
  };

  /** The press that opened a layer appearing now, if one was that recent. */
  const recentPress = (): Press | undefined => {
    const press = keyOpen ?? pointerPress;
    return press && win.performance.now() - press.at <= DIALOG_OPEN_WINDOW_MS ? press : undefined;
  };

  /** The layer's opener, or the opener of the layer that held it when that one is gone too. */
  const reachableOpener = (layer: Element): HTMLElement | undefined => {
    let current: Element | undefined = layer;
    while (current) {
      const opener = openers.get(current);
      if (opener && canTakeFocus(opener)) return opener;
      current = parents.get(current);
    }
    return undefined;
  };

  const focusLayerOpenedByKey = (layer: Element) => {
    const open = keyOpen;
    if (!open || win.performance.now() - open.at > KEY_OPEN_WINDOW_MS) return;
    // A focus trap that moves focus itself does so in a timeout of its own, which runs first.
    win.setTimeout(() => {
      if (!layer.isConnected) return;
      // A menu item that opened this layer and closed its menu (Settings in the account menu)
      // took the menu with it: focus is then on <body>, or back on the menu's own opener.
      const { openerLayer } = open;
      const fromClosedMenu =
        !open.opener.isConnected &&
        !!openerLayer &&
        !openerLayer.isConnected &&
        (doc.activeElement === doc.body || doc.activeElement === openers.get(openerLayer));
      if (doc.activeElement !== open.opener && !fromClosedMenu) return;
      const first = firstTabbable(layer);
      if (!first) return;
      remember(layer, fromClosedMenu && openerLayer ? reachableOpener(openerLayer) : open.opener);
      first.focus({ preventScroll: true });
    }, 0);
  };

  /**
   * Moves focus into a dialog that opened from a press, or that is modal, unless its focus trap
   * already did. A dialog that turns up unasked, such as an incoming call, leaves focus where the
   * person is typing.
   */
  const focusDialog = (layer: Element, press: Press | undefined) => {
    const dialog = dialogOf(layer);
    if (!dialog || (!press && dialog.getAttribute('aria-modal') !== 'true')) return;
    // A focus trap that moves focus itself does so in a timeout of its own, which runs first.
    win.setTimeout(() => {
      if (!layer.isConnected || layer.contains(doc.activeElement)) return;
      const target = dialogFocusTarget(dialog);
      if (target === dialog && !dialog.hasAttribute('tabindex')) dialog.tabIndex = -1;
      target.focus({ preventScroll: true });
    }, 0);
  };

  const onLayerAdded = (layer: Element) => {
    if (isPassiveLayer(layer)) return;
    const press = recentPress();
    if (press) remember(layer, press.opener, press.openerLayer);
    if (dialogOf(layer)) {
      dialogLayers.add(layer);
      focusDialog(layer, press);
    } else {
      focusLayerOpenedByKey(layer);
    }
  };

  const returnFocusFrom = (layer: Element) => {
    if (!openers.has(layer)) return;
    // Focus traps give focus back in a timeout of their own; run after them.
    win.setTimeout(() => {
      if (lastInput !== 'keyboard' && !dialogLayers.has(layer)) return;
      const active = doc.activeElement;
      if (active && active !== doc.body && active.isConnected) return;
      reachableOpener(layer)?.focus({ preventScroll: true });
    }, 0);
  };

  const onMutations = (records: MutationRecord[]) => {
    records.forEach((record) => {
      record.addedNodes.forEach((node) => {
        if (node instanceof win.Element && layerOf(doc, node) === node) onLayerAdded(node);
      });
      record.removedNodes.forEach((node) => {
        if (node instanceof win.Element) returnFocusFrom(node);
      });
    });
  };

  const observer = new win.MutationObserver(onMutations);
  observers.add(observer);
  observer.observe(doc.body, { childList: true });
  const portalContainer = doc.getElementById(PORTAL_CONTAINER_ID);
  if (portalContainer) observer.observe(portalContainer, { childList: true });

  doc.addEventListener('focusin', onFocusIn, true);
  doc.addEventListener('keydown', onKeyDown, true);
  doc.addEventListener('pointerdown', onPointerDown, true);
  doc.addEventListener('mousedown', onPointerDown, true);

  return () => {
    observers.delete(observer);
    observer.disconnect();
    doc.removeEventListener('focusin', onFocusIn, true);
    doc.removeEventListener('keydown', onKeyDown, true);
    doc.removeEventListener('pointerdown', onPointerDown, true);
    doc.removeEventListener('mousedown', onPointerDown, true);
  };
};
