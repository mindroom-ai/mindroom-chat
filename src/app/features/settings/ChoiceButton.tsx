import React, { MouseEvent, useState } from 'react';
import FocusTrap from 'focus-trap-react';
import { Box, Button, Icon, Icons, PopOut, Text, config, type RectCords } from 'folds';
import { Menu, MenuItem } from '../../components/glass/GlassPrimitives';
import { stopPropagation } from '../../utils/keyboard';

export type Choice<V> = {
  value: V;
  label: string;
  /** Set on the menu row, for example `lang` on a language name. */
  lang?: string;
};

type ChoiceButtonProps<V> = {
  /** Names the button for assistive technology; the visible text is the current choice. */
  label: string;
  value: V;
  choices: ReadonlyArray<Choice<V>>;
  onChoose: (value: V) => void;
  disabled?: boolean;
};

const isArrowKey = (key: string) => (event: KeyboardEvent) => event.key === key;

/** Arrow keys move through the rows; Escape, Tab out or a click elsewhere dismiss the menu. */
const menuTrap = (dismiss: () => void) => ({
  onDeactivate: dismiss,
  escapeDeactivates: stopPropagation,
  clickOutsideDeactivates: true,
  initialFocus: false as const,
  isKeyBackward: isArrowKey('ArrowUp'),
  isKeyForward: isArrowKey('ArrowDown'),
});

/**
 * A soft button that shows the current choice and opens a menu of the others; the settings
 * pages use it wherever the reference shows a picker (language, theme, layout).
 */
export function ChoiceButton<V extends string | number>({
  label,
  value,
  choices,
  onChoose,
  disabled,
}: ChoiceButtonProps<V>) {
  const [anchor, setAnchor] = useState<RectCords>();
  const close = () => setAnchor(undefined);
  const current = choices.find((choice) => choice.value === value);

  const toggle = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setAnchor((open) => (open ? undefined : rect));
  };

  const rows = choices.map((choice) => (
    <MenuItem
      key={String(choice.value)}
      size="300"
      radii="300"
      variant="Surface"
      aria-pressed={choice.value === value}
      onClick={() => {
        onChoose(choice.value);
        close();
      }}
    >
      <Text size="T300" lang={choice.lang}>
        {choice.label}
      </Text>
    </MenuItem>
  ));

  const menu = (
    <FocusTrap focusTrapOptions={menuTrap(close)}>
      <Menu style={{ maxHeight: '50vh', overflowY: 'auto' }}>
        <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
          {rows}
        </Box>
      </Menu>
    </FocusTrap>
  );

  return (
    <>
      <Button
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={anchor !== undefined}
        disabled={disabled}
        onClick={toggle}
        variant="Secondary"
        fill="Soft"
        outlined
        size="300"
        radii="300"
        after={<Icon size="100" src={Icons.ChevronBottom} />}
      >
        <Text size="T300" lang={current?.lang} truncate>
          {current?.label ?? String(value)}
        </Text>
      </Button>
      <PopOut anchor={anchor} position="Bottom" align="End" offset={5} content={menu} />
    </>
  );
}
