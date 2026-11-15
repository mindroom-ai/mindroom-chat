import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Editor } from '../editor/Editor.css';
import { hasOpenOverlay } from '../lib/openOverlay';
import * as css from './TourHandoff.css';
import { hasCoarsePointer, prefersReducedMotion } from './tourMotion';
import { SPOTLIGHT_GAP } from './TourSpotlight';

/** The text box of a room's own composer, which starts threads; an open thread's replies. */
const COMPOSER =
  '[data-room-footer="true"][data-footer-of="room"] [data-editable-name="RoomInput"]';

/**
 * The open room's composer, if it can be typed in: a thread that fills the page puts the room's
 * conversation, composer and all, under it and makes it inert, and a dialog or menu that was open
 * under the tour (the command palette opens the tour over one) covers it.
 */
const roomComposer = (): HTMLElement | undefined => {
  if (hasOpenOverlay()) return undefined;
  const composer = document.querySelector<HTMLElement>(COMPOSER);
  return composer && !composer.closest('[inert]') ? composer : undefined;
};

/** How long the handoff lasts at most, in ms: its two pulses and a little more. */
export const HANDOFF_LENGTH_MS = 2 * css.PULSE_MS + 200;

type Box = { x: number; y: number; width: number; height: number };

/** The composer's card around its text box, which the ring goes around; else the text box. */
const cardOf = (composer: HTMLElement): HTMLElement => {
  const classes = Editor.split(' ');
  let node: HTMLElement | null = composer;
  while (node && !classes.every((name) => node?.classList.contains(name))) {
    node = node.parentElement;
  }
  return node ?? composer;
};

/**
 * Takes the person from the tour to the room: the tour's ring pulses twice around the open
 * room's composer and, on a screen without touch, the composer takes the focus, so typing starts
 * a thread. With reduced motion there is no pulse; without a room's composer to type in (no room
 * on the page, a thread filling it, or a dialog over it) nothing happens.
 * Calls `onEnd` when it is over. Renders the ring.
 */
export function TourHandoff({ onEnd }: { onEnd: () => void }): JSX.Element | null {
  const [box, setBox] = useState<Box>();
  const end = useRef(onEnd);
  end.current = onEnd;

  useEffect(() => {
    const composer = roomComposer();
    if (!composer) {
      end.current();
      return undefined;
    }
    const pulses = !prefersReducedMotion();
    // The tour's dialog hands the focus back to what opened it a moment after it closes; the
    // composer takes it after that. A touch screen would raise its keyboard, so it is left alone.
    const focusTimer = setTimeout(() => {
      if (!hasCoarsePointer()) composer.focus();
      if (!pulses) end.current();
    }, 0);
    if (!pulses) return () => clearTimeout(focusTimer);

    const { left, top, width, height } = cardOf(composer).getBoundingClientRect();
    setBox({ x: left, y: top, width, height });
    // The pulse says when it ends; a page that plays no animation ends here.
    const endTimer = setTimeout(() => end.current(), HANDOFF_LENGTH_MS);
    return () => {
      clearTimeout(focusTimer);
      clearTimeout(endTimer);
    };
  }, []);

  if (!box) return null;
  return createPortal(
    <div className={css.Layer}>
      <div
        className={css.Ring}
        data-tour-handoff=""
        style={{
          transform: `translate(${box.x - SPOTLIGHT_GAP}px, ${box.y - SPOTLIGHT_GAP}px)`,
          width: box.width + 2 * SPOTLIGHT_GAP,
          height: box.height + 2 * SPOTLIGHT_GAP,
        }}
        onAnimationEnd={onEnd}
      />
    </div>,
    document.body
  );
}
