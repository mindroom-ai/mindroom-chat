import React from 'react';
import { Icon, IconButton, Icons, Text, Tooltip, TooltipProvider } from 'folds';

type ComputerHeaderButtonProps = {
  /** What pressing the button does now, e.g. "Show computer"; also its accessible name. */
  label: string;
  /** Whether the room has a computer to show; the button is absent otherwise. */
  available: boolean;
  open: boolean;
  onToggle: () => void;
};

/** The room header's toggle for the agent's computer panel. */
export function ComputerHeaderButton({
  label,
  available,
  open,
  onToggle,
}: ComputerHeaderButtonProps) {
  if (!available) return null;
  const hint = (
    <Tooltip>
      <Text size="T300">{label}</Text>
    </Tooltip>
  );
  return (
    <TooltipProvider tooltip={hint} position="Bottom" offset={4}>
      {(anchorRef) => (
        <IconButton
          ref={anchorRef}
          variant={open ? 'Primary' : 'Surface'}
          fill={open ? 'Soft' : 'None'}
          aria-label={label}
          aria-pressed={open}
          onClick={() => onToggle()}
        >
          <Icon size="400" src={Icons.Monitor} filled={open} />
        </IconButton>
      )}
    </TooltipProvider>
  );
}
