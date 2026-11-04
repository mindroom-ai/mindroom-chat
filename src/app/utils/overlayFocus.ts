/**
 * Keyboard focus for the layers React portals into `<body>` or `#portalContainer`: menus,
 * popovers and dialogs.
 *
 * - Many menus open with `initialFocus: false`, so a mouse click does not ring their first item.
 *   Opened with Enter or Space instead, a layer whose opener keeps focus gets focus on its first
 *   control, as a menu button should.
 * - A layer that closes after a key press (Escape, or Enter on one of its items) would leave focus
 *   on `<body>`; focus goes back to the control it came from. After a pointer press nothing moves,
 *   so a click elsewhere keeps its own focus.
 */

const PORTAL_CONTAINER_ID = 'portalContainer';
const APP_ROOT_ID = 'root';
/** How long after Enter or Space a new layer still counts as opened by that key. */
const KEY_OPEN_WINDOW_MS = 400;

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

type Doc = Document & { defaultView: (Window & typeof globalThis) | null };

const isLayerParent = (doc: Document, parent: Element | null): boolean =>
  !!parent && (parent === doc.body || parent.id === PORTAL_CONTAINER_ID);

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

/** Starts the behavior on `doc`; returns a function that stops it. */
export const installOverlayFocus = (doc: Document = document): (() => void) => {
  const win = (doc as Doc).defaultView;
  if (!win || !doc.body) return () => undefined;

  const openers = new WeakMap<Element, HTMLElement>();
  /** The layer that holds a layer's opener, for a menu opened from another menu. */
  const parents = new WeakMap<Element, Element>();
  let lastInput: 'keyboard' | 'pointer' | undefined;
  let lastFocused: HTMLElement | undefined;
  let keyOpen: { opener: HTMLElement; at: number } | undefined;

  /** Whether `layer` is `ancestor`, or was opened from it directly or through other layers. */
  const openedFrom = (layer: Element, ancestor: Element): boolean => {
    for (let current: Element | undefined = layer; current; current = parents.get(current)) {
      if (current === ancestor) return true;
    }
    return false;
  };

  const remember = (layer: Element, opener: HTMLElement | undefined) => {
    if (!opener || openers.has(layer)) return;
    const openerLayer = layerOf(doc, opener);
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

  const onKeyDown = (event: KeyboardEvent) => {
    lastInput = 'keyboard';
    const plain = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    const target = event.target as Element | null;
    keyOpen =
      plain && (event.key === 'Enter' || event.key === ' ') && target?.closest?.(OPENER_SELECTOR)
        ? { opener: target as HTMLElement, at: win.performance.now() }
        : undefined;
  };

  const onPointerDown = () => {
    lastInput = 'pointer';
    keyOpen = undefined;
  };

  const focusLayerOpenedByKey = (layer: Element) => {
    const open = keyOpen;
    if (!open || win.performance.now() - open.at > KEY_OPEN_WINDOW_MS) return;
    if (isPassiveLayer(layer)) return;
    // A focus trap that moves focus itself does so in a timeout of its own, which runs first.
    win.setTimeout(() => {
      if (!layer.isConnected || doc.activeElement !== open.opener) return;
      const first = firstTabbable(layer);
      if (!first) return;
      remember(layer, open.opener);
      first.focus({ preventScroll: true });
    }, 0);
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

  const returnFocusFrom = (layer: Element) => {
    if (!openers.has(layer)) return;
    // Focus traps give focus back in a timeout of their own; run after them.
    win.setTimeout(() => {
      if (lastInput !== 'keyboard') return;
      const active = doc.activeElement;
      if (active && active !== doc.body && active.isConnected) return;
      reachableOpener(layer)?.focus({ preventScroll: true });
    }, 0);
  };

  const onMutations = (records: MutationRecord[]) => {
    records.forEach((record) => {
      record.addedNodes.forEach((node) => {
        if (node instanceof win.Element && layerOf(doc, node) === node) focusLayerOpenedByKey(node);
      });
      record.removedNodes.forEach((node) => {
        if (node instanceof win.Element) returnFocusFrom(node);
      });
    });
  };

  const observer = new win.MutationObserver(onMutations);
  observer.observe(doc.body, { childList: true });
  const portalContainer = doc.getElementById(PORTAL_CONTAINER_ID);
  if (portalContainer) observer.observe(portalContainer, { childList: true });

  doc.addEventListener('focusin', onFocusIn, true);
  doc.addEventListener('keydown', onKeyDown, true);
  doc.addEventListener('pointerdown', onPointerDown, true);
  doc.addEventListener('mousedown', onPointerDown, true);

  return () => {
    observer.disconnect();
    doc.removeEventListener('focusin', onFocusIn, true);
    doc.removeEventListener('keydown', onKeyDown, true);
    doc.removeEventListener('pointerdown', onPointerDown, true);
    doc.removeEventListener('mousedown', onPointerDown, true);
  };
};
