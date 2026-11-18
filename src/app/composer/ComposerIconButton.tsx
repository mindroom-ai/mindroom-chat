import type { ButtonHTMLAttributes, MouseEvent } from 'react';
import { Icon, type IconSrc } from 'folds';
import { IconButton } from '../ui/glass/GlassPrimitives';
import { IconTooltip } from '../ui/IconTooltip';
import * as css from './RoomInput.css';

type ComposerIconButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onClick' | 'onMouseDown' | 'aria-label' | 'aria-pressed' | 'className'
> & {
  label: string;
  icon: IconSrc;
  /** Pressed state of a toggle, which also fills its icon. */
  pressed?: boolean;
  variant?: 'Primary' | 'SurfaceVariant';
  /** The icon points along the reading direction, so right-to-left languages mirror it. */
  directional?: boolean;
  /** The send button answers its send's promise, which the composer tests await. */
  onPress: (event: MouseEvent<HTMLButtonElement>) => void | Promise<unknown>;
  /** No other control beside it, so its touch hit area takes the full 44 px width. */
  alone?: boolean;
  /** A press leaves the focus in the text box, so a phone keeps its keyboard up. */
  keepsTextFocus?: boolean;
  /** Hides its name's tooltip, under a menu it opened. */
  tooltipHidden?: boolean;
};

// Pressing a button moves the focus to it (or, where buttons take no focus, out of the text box),
// which closes a phone's keyboard.
const keepTextFocus = (event: MouseEvent) => event.preventDefault();

/**
 * An icon-only composer button, named by its tooltip and its aria-label alike; other button
 * attributes (a long press's handlers) pass through.
 */
export function ComposerIconButton({
  label,
  icon,
  pressed,
  variant = 'SurfaceVariant',
  directional,
  onPress,
  alone,
  keepsTextFocus,
  tooltipHidden,
  ...buttonProps
}: ComposerIconButtonProps) {
  return (
    <IconTooltip position="Top" label={label} hidden={tooltipHidden}>
      {(triggerRef) => (
        <IconButton
          {...buttonProps}
          ref={triggerRef}
          // The click handler keeps the send's promise as its result: callers that await a send
          // (the composer tests) read it there; a click ignores it, and the send handles
          // its own failure.
          // eslint-disable-next-line @typescript-eslint/no-misused-promises
          onClick={onPress}
          onMouseDown={keepsTextFocus ? keepTextFocus : undefined}
          aria-label={label}
          aria-pressed={pressed}
          variant={variant}
          radii="300"
          size="300"
          className={alone ? css.ComposerLoneButton : css.ComposerIconButton}
        >
          <Icon src={icon} filled={pressed} data-directional={directional || undefined} />
        </IconButton>
      )}
    </IconTooltip>
  );
}
