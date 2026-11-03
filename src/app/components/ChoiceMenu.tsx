import React from 'react';
import FocusTrap from 'focus-trap-react';
import isHotkey from 'is-hotkey';
import { Box, Icon, Icons, Text, config } from 'folds';
import { Menu, MenuItem } from './glass/GlassPrimitives';
import { stopPropagation } from '../utils/keyboard';

/** One option of a {@link ChoiceMenu}; `critical` options read as a warning. */
export type Choice = { name: string; critical?: boolean };

type ChoiceMenuProps = {
  /** Names the menu for assistive technology. */
  label: string;
  choices: Choice[];
  /** Position of the current option in `choices`. */
  current: number;
  onChoose(index: number): void;
  /** Escape or a click outside the menu. */
  onDismiss(): void;
};

const arrowKey = (name: 'arrowdown' | 'arrowup') => (evt: KeyboardEvent) => isHotkey(name, evt);

/**
 * A small menu of mutually exclusive options with a check at the chosen one, for a pop-out.
 * Arrow keys walk the options; Escape and clicks outside dismiss it.
 */
export function ChoiceMenu({ label, choices, current, onChoose, onDismiss }: ChoiceMenuProps) {
  return (
    <FocusTrap
      focusTrapOptions={{
        onDeactivate: onDismiss,
        isKeyBackward: arrowKey('arrowup'),
        isKeyForward: arrowKey('arrowdown'),
        escapeDeactivates: stopPropagation,
        clickOutsideDeactivates: true,
        initialFocus: false,
      }}
    >
      <Menu role="menu" aria-label={label}>
        <Box style={{ padding: config.space.S100 }} gap="100" direction="Column">
          {choices.map((choice, index) => {
            const chosen = index === current;
            return (
              <MenuItem
                key={choice.name}
                role="menuitemradio"
                aria-checked={chosen}
                size="300"
                radii="300"
                variant={choice.critical ? 'Critical' : 'Surface'}
                fill={chosen ? 'Soft' : 'None'}
                after={chosen ? <Icon size="50" src={Icons.Check} /> : undefined}
                onClick={() => onChoose(index)}
              >
                <Text size="T300" style={{ flexGrow: 1, textAlign: 'start' }}>
                  {choice.name}
                </Text>
              </MenuItem>
            );
          })}
        </Box>
      </Menu>
    </FocusTrap>
  );
}
