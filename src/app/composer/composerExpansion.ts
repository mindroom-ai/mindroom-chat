import { type FocusEvent, useCallback, useEffect, useRef, useState } from 'react';

/** How long after a press inside the composer ends it still counts, so its click lands first. */
export const PRESS_SETTLE_MS = 300;

export type ComposerExpansionInputs = {
  /** A phone's composer starts as one row; elsewhere it always shows two. */
  phone: boolean;
  /** Focus is in the composer, or in a menu or board it opened. */
  focused: boolean;
  /**
   * A press that started inside the composer while it was expanded has not settled yet: the
   * composer listens for presses only then (`useComposerFocus`'s `onPointerDown`).
   */
  pressing: boolean;
  /** The composer holds no text. */
  empty: boolean;
  /** Something the composer shows asks for its room: files, a reply, a recording, a board, suggestions. */
  busy: boolean;
};

/**
 * Whether the composer shows its two rows: text above, controls below. On a phone it expands
 * while the user writes (focus, text, or anything the composer holds) and collapses back to one
 * row only once focus has left it with nothing in it. A press inside the expanded composer keeps
 * it expanded until the press settles: iOS takes focus from the text on the press of a button,
 * and collapsing then would move the button from under the finger before its click lands. A
 * press on the collapsed composer must not expand it, for the same reason the other way round,
 * so the composer passes presses on only while expanded.
 */
export const isComposerExpanded = ({
  phone,
  focused,
  pressing,
  empty,
  busy,
}: ComposerExpansionInputs): boolean => !phone || focused || pressing || !empty || busy;

type FocusHandlers = {
  onFocus: (event: FocusEvent<HTMLElement>) => void;
  onBlur: (event: FocusEvent<HTMLElement>) => void;
  onPointerDown: () => void;
};

/**
 * Tracks focus within the composer's React tree (menus and boards it portals out count, since
 * React's focus events follow the component tree) and presses that started inside it. Focus
 * moving between two of its parts sends a blur then a focus; the blur waits a task, so that
 * move never reads as focus leaving.
 */
export const useComposerFocus = (): {
  focused: boolean;
  pressing: boolean;
  handlers: FocusHandlers;
} => {
  const [focused, setFocused] = useState(false);
  const [pressing, setPressing] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout>>();
  const pressTimer = useRef<ReturnType<typeof setTimeout>>();
  const pressEnd = useRef<() => void>();

  useEffect(
    () => () => {
      clearTimeout(blurTimer.current);
      clearTimeout(pressTimer.current);
      pressEnd.current?.();
    },
    []
  );

  const onFocus = useCallback(() => {
    clearTimeout(blurTimer.current);
    setFocused(true);
  }, []);
  const onBlur = useCallback(() => {
    clearTimeout(blurTimer.current);
    blurTimer.current = setTimeout(() => setFocused(false), 0);
  }, []);
  const onPointerDown = useCallback(() => {
    clearTimeout(pressTimer.current);
    pressEnd.current?.();
    setPressing(true);
    const end = () => {
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

  return { focused, pressing, handlers: { onFocus, onBlur, onPointerDown } };
};
