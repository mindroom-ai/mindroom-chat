import { useRef, type ReactNode } from 'react';
import FocusTrap from 'focus-trap-react';
import { Box, Icon, Icons, Text, config } from 'folds';
import { Menu, MenuItem } from './glass/GlassPrimitives';
import { stopPropagation } from '../lib/keyboard';

/**
 * One option of a {@link ChoiceMenu}; `critical` options read as a warning, and `detail` shows
 * after the name, such as the time a preset picks.
 */
export type Choice = { name: string; critical?: boolean; detail?: string };

type ChoiceMenuProps = {
  /** Names the menu for assistive technology. */
  label: string;
  choices: Choice[];
  /** Position of the current option in `choices`; -1 checks none. */
  current: number;
  onChoose(index: number): void;
  /** Escape or a click outside the menu. */
  onDismiss(): void;
  /**
   * Focus the first option as the menu opens, for a menu that replaces the control that opened
   * it, whose focus would otherwise fall to the page.
   */
  focusFirst?: boolean;
  /** Shown under the options, such as why the last choice failed. */
  footer?: ReactNode;
};

/**
 * A small menu of mutually exclusive options with a check at the chosen one, for a pop-out.
 * Arrow keys walk the options; Escape and clicks outside dismiss it.
 */
export function ChoiceMenu({
  label,
  choices,
  current,
  onChoose,
  onDismiss,
  focusFirst = false,
  footer,
}: ChoiceMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  return (
    <FocusTrap
      focusTrapOptions={{
        onDeactivate: onDismiss,
        escapeDeactivates: stopPropagation,
        clickOutsideDeactivates: true,
        initialFocus: focusFirst
          ? () => menuRef.current?.querySelector<HTMLElement>('[role="menuitemradio"]') ?? false
          : false,
      }}
    >
      <Menu ref={menuRef} role="menu" aria-label={label}>
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
                {choice.detail && (
                  <Text as="span" size="T200" priority="300" data-choice-detail="">
                    {choice.detail}
                  </Text>
                )}
              </MenuItem>
            );
          })}
          {footer}
        </Box>
      </Menu>
    </FocusTrap>
  );
}
