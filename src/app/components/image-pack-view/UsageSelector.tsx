import React, { MouseEventHandler, useState } from 'react';
import { useTranslation } from 'react-i18next';
import FocusTrap from 'focus-trap-react';
import { Box, Chip, Icon, Icons, type RectCords, Text, config } from 'folds';
import { PopOut } from '../directional';
import { Menu, MenuItem } from '../glass/GlassPrimitives';
import { stopPropagation } from '../../utils/keyboard';
import type { UsageOption } from './packDraft';

/** `inherit` is offered for one image: it then follows the pack's usage. */
type UsageChoice = UsageOption | 'inherit';

type UsageSelectorProps<T extends UsageChoice> = {
  value: T;
  /** The choices in menu order; the pack offers its three, an image also `inherit`. */
  options: readonly T[];
  disabled?: boolean;
  onChange: (value: T) => void;
};

export const PACK_USAGE_OPTIONS: readonly UsageOption[] = ['emoticon', 'sticker', 'both'];
export const IMAGE_USAGE_OPTIONS: readonly UsageChoice[] = ['inherit', ...PACK_USAGE_OPTIONS];

/** A chip with the current usage that opens a menu of the others. */
export function UsageSelector<T extends UsageChoice>({
  value,
  options,
  disabled,
  onChange,
}: UsageSelectorProps<T>) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<RectCords>();
  const labels: Record<UsageChoice, string> = {
    inherit: t('sharedUi.imageUsageOption.pack'),
    emoticon: t('sharedUi.imageUsage.emoji'),
    sticker: t('sharedUi.imageUsage.sticker'),
    both: t('sharedUi.imageUsage.both'),
  };

  const open: MouseEventHandler<HTMLButtonElement> = (evt) =>
    setAnchor(evt.currentTarget.getBoundingClientRect());
  const closeMenu = () => setAnchor(undefined);
  const select = (option: T) => {
    closeMenu();
    onChange(option);
  };
  const trapOptions = {
    clickOutsideDeactivates: true,
    escapeDeactivates: stopPropagation,
    onDeactivate: closeMenu,
    returnFocusOnDeactivate: false,
    initialFocus: false,
  } as const;

  return (
    <PopOut
      anchor={anchor}
      offset={4}
      align="End"
      position="Bottom"
      content={
        <FocusTrap focusTrapOptions={trapOptions}>
          <Menu>
            <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
              {options.map((option) => (
                <MenuItem
                  key={option}
                  size="300"
                  radii="300"
                  aria-pressed={option === value}
                  variant={option === value ? 'Primary' : 'Surface'}
                  fill={option === value ? 'Soft' : 'None'}
                  onClick={() => select(option)}
                >
                  <Text size="T300">{labels[option]}</Text>
                </MenuItem>
              ))}
            </Box>
          </Menu>
        </FocusTrap>
      }
    >
      <Chip
        type="button"
        variant="SurfaceVariant"
        radii="Pill"
        size="400"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={anchor !== undefined}
        after={<Icon size="100" src={Icons.ChevronBottom} />}
        onClick={open}
      >
        <Text as="span" size="B300">
          {labels[value]}
        </Text>
      </Chip>
    </PopOut>
  );
}
