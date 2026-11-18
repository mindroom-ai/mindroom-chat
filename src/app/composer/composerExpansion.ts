import { type PointerEvent, useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from 'slate';
import { isEmptyEditor } from '../editor/utils';

/** How long after a press inside the composer ends it still counts, so its click lands first. */
export const PRESS_SETTLE_MS = 300;

export type ComposerExpansionInputs = {
  /** A phone's composer starts as one row; elsewhere it always shows two. */
  phone: boolean;
  /** Focus is in the composer, or one of its controls has a menu open (`useComposerFocus`). */
  focused: boolean;
  /**
   * A press that started inside the composer while it was expanded has not settled yet: the
   * composer listens for presses only then (`useComposerFocus`'s `onPointerDown`).
   */
  pressing: boolean;
  /** The composer shows nothing typed (`isComposerEmpty`). */
  empty: boolean;
  /** Something the composer shows asks for its room: files, a reply, a recording, a board, suggestions. */
  busy: boolean;
};

/**
 * Whether the composer shows its two rows: text above, controls below. On a phone it expands
 * while the user writes (focus, text, an open menu, or anything the composer holds) and
 * collapses back to one row only once focus has left it with nothing in it. A press inside the
 * expanded composer keeps it expanded until the press settles: iOS takes focus from the text on
 * the press of a button, before the button's click, and collapsing then would move the button
 * from under the finger before that click lands. A press on the collapsed composer must not
 * expand it, for the same reason the other way round, so the composer passes presses on only
 * while expanded.
 */
export const isComposerExpanded = ({
  phone,
  focused,
  pressing,
  empty,
  busy,
}: ComposerExpansionInputs): boolean => !phone || focused || pressing || !empty || busy;

/**
 * Whether the composer shows nothing typed: for its layout, any visible text counts, also a
 * command such as `/me` with nothing to send after it (which Send treats as empty).
 */
export const isComposerEmpty = (editor: Editor): boolean => isEmptyEditor(editor);

/** A control of the composer whose menu is open; the menus themselves render elsewhere. */
const OPEN_MENU = '[aria-expanded="true"]';

/**
 * Whether focus is in the composer's element, or a control in it has its menu open (menus
 * render in a portal, and open some without focus), and whether a press that started in it has
 * yet to settle. Read from the document whenever focus moves in or out, and whenever the
 * composer's elements change: a focused control that is removed (a recording's discard button)
 * takes focus with it without a blur the composer would hear. Watches only while `watch` holds.
 */
export const useComposerFocus = (
  watch: boolean
): {
  focused: boolean;
  pressing: boolean;
  setRoot: (element: HTMLElement | null) => void;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
} => {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const [focused, setFocused] = useState(false);
  const [pressing, setPressing] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout>>();
  const pressEnd = useRef<() => void>();

  useEffect(() => {
    if (!root || !watch) {
      setFocused(false);
      return undefined;
    }
    const read = () =>
      setFocused(root.contains(document.activeElement) || root.querySelector(OPEN_MENU) !== null);
    // Focus moving between two of its parts leaves the document's focus on the body for a
    // moment; read once it has landed.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const readSoon = () => {
      clearTimeout(timer);
      timer = setTimeout(read, 0);
    };
    read();
    root.addEventListener('focusin', read);
    root.addEventListener('focusout', readSoon);
    const observer = new MutationObserver(readSoon);
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-expanded'],
    });
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      root.removeEventListener('focusin', read);
      root.removeEventListener('focusout', readSoon);
    };
  }, [root, watch]);

  useEffect(
    () => () => {
      clearTimeout(pressTimer.current);
      pressEnd.current?.();
    },
    []
  );

  // The press that started first holds it; another finger's release does not end it.
  const onPointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    if (pressEnd.current) return;
    clearTimeout(pressTimer.current);
    setPressing(true);
    const { pointerId } = event;
    const end = (ended: globalThis.PointerEvent) => {
      if (ended.pointerId !== pointerId) return;
      pressEnd.current?.();
      pressTimer.current = setTimeout(() => setPressing(false), PRESS_SETTLE_MS);
    };
    window.addEventListener('pointerup', end, true);
    window.addEventListener('pointercancel', end, true);
    pressEnd.current = () => {
      window.removeEventListener('pointerup', end, true);
      window.removeEventListener('pointercancel', end, true);
      pressEnd.current = undefined;
    };
  }, []);

  return { focused, pressing, setRoot, onPointerDown };
};
