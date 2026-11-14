import { type ReactNode, type RefCallback } from 'react';
import { Box, Text, Tooltip, type Align, type Position } from 'folds';
import { TooltipProvider } from './directional';
import { ShortcutLabel } from '../shortcuts/ShortcutKeys';
import type { ShortcutId } from '../shortcuts/shortcuts';

export type IconTooltipProps = {
  label: string;
  /** A second, quieter line, e.g. what pressing the button does. */
  hint?: string;
  /** The keyboard shortcut for the button's action, shown after the label. */
  shortcut?: ShortcutId;
  position?: Position;
  align?: Align;
  children: (triggerRef: RefCallback<HTMLElement | SVGElement>) => ReactNode;
};

// A name and an optional quieter hint in a tooltip. An icon-only button names
// itself in one, as the room header's buttons do; give the button the same label
// as its aria-label.
export function IconTooltip({
  label,
  hint,
  shortcut,
  position = 'Bottom',
  align,
  children,
}: IconTooltipProps) {
  return (
    <TooltipProvider
      position={position}
      align={align}
      offset={4}
      tooltip={
        <Tooltip>
          <Box direction="Column">
            <ShortcutLabel label={label} id={shortcut} />
            {hint && (
              <Text size="T200" priority="300">
                {hint}
              </Text>
            )}
          </Box>
        </Tooltip>
      }
    >
      {children}
    </TooltipProvider>
  );
}
