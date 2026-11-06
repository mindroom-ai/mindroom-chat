import { useEffect, useRef, useState, type ReactNode, type PointerEvent } from 'react';
import { Text, Tooltip, type RectCords } from 'folds';
import { PopOut } from './directional';
import { portalContainer } from '../lib/portalOverlay';

type TipButtonProps = {
  /** The text the tip shows. */
  tip: string;
  className?: string;
  'aria-label'?: string;
  children: ReactNode;
};

/**
 * A small button whose tip shows while a mouse rests on it, while it has focus, and after a tap,
 * which touch screens need since they have no hover; a tap elsewhere or Escape hides it, and it
 * follows the button as the page scrolls. For a short label whose whole text does not fit, such as
 * an agent's model name.
 */
export function TipButton({ tip, children, ...props }: TipButtonProps) {
  const button = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<RectCords>();
  const show = () => setAnchor(button.current?.getBoundingClientRect());
  const hide = () => setAnchor(undefined);

  const open = !!anchor;
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };
    // A tap on iOS focuses no button, so no blur comes when the next tap lands elsewhere.
    const onPointerDown = (event: Event) => {
      if (!button.current?.contains(event.target as Node)) hide();
    };
    const follow = () => setAnchor(button.current?.getBoundingClientRect());
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('scroll', follow, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('scroll', follow, true);
    };
  }, [open]);

  return (
    <>
      <button
        {...props}
        ref={button}
        type="button"
        onPointerEnter={(event: PointerEvent) => {
          if (event.pointerType === 'mouse') show();
        }}
        onPointerLeave={(event: PointerEvent) => {
          if (event.pointerType === 'mouse' && document.activeElement !== button.current) hide();
        }}
        onFocus={show}
        onBlur={hide}
        onClick={show}
      >
        {children}
      </button>
      {/* folds' PopOut layer covers the screen; as a tip it lets the pointer through. It lives in
          the portal container, where a tip a tap opened stays on touch screens (index.css). */}
      <PopOut
        role="tooltip"
        container={portalContainer}
        style={{ pointerEvents: 'none' }}
        anchor={anchor}
        position="Top"
        align="Start"
        offset={4}
        content={
          <Tooltip>
            <Text size="T200">{tip}</Text>
          </Tooltip>
        }
      />
    </>
  );
}
