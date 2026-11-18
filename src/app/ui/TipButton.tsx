import { type ReactNode, type PointerEvent } from 'react';
import { Text, Tooltip } from 'folds';
import { PopOut } from './directional';
import { useAnchoredCard } from './useAnchoredCard';

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
 * follows the button as the page moves. For a short label whose whole text does not fit, such as
 * an agent's model name.
 */
export function TipButton({ tip, children, ...props }: TipButtonProps) {
  const { open, triggerRef, show, close, hover } = useAnchoredCard();

  return (
    <>
      <button
        {...props}
        ref={triggerRef}
        type="button"
        onPointerEnter={hover.onPointerEnter}
        onPointerLeave={(event: PointerEvent) => {
          if (event.pointerType === 'mouse' && document.activeElement !== triggerRef.current)
            close();
        }}
        onFocus={() => show('focus')}
        onBlur={close}
        onClick={() => show('pinned')}
      >
        {children}
      </button>
      {/* folds' PopOut layer covers the screen; as a tip it lets the pointer through. The tip
          inside, not the layer, is the tooltip: on touch screens index.css hides tooltip layers
          in the body, the hover tips a tap would leave behind, and this one a tap opens. */}
      <PopOut
        style={{ pointerEvents: 'none' }}
        anchor={open?.anchor}
        position="Top"
        align="Start"
        offset={4}
        content={
          <Tooltip role="tooltip">
            <Text size="T200">{tip}</Text>
          </Tooltip>
        }
      />
    </>
  );
}
