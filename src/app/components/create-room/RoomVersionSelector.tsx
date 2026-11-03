import React, { MouseEventHandler, useState } from 'react';
import { useTranslation } from 'react-i18next';
import FocusTrap from 'focus-trap-react';
import { Box, Button, Chip, config, Icon, Icons, PopOut, type RectCords, Text, toRem } from 'folds';
import { Menu } from '../glass/GlassPrimitives';
import { SettingTile } from '../setting-tile';
import { SequenceCard } from '../sequence-card';

type RoomVersionSelectorProps = {
  versions: string[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

type VersionMenuProps = {
  versions: string[];
  selected: string;
  onPick: (version: string) => void;
  onDismiss: () => void;
};

/** The pop-out list of versions; the selected one is the pressed, solid button. */
function VersionMenu({ versions, selected, onPick, onDismiss }: VersionMenuProps) {
  const { t } = useTranslation();
  const trapOptions = {
    initialFocus: false as const,
    clickOutsideDeactivates: true,
    escapeDeactivates: true,
    onDeactivate: onDismiss,
  };
  const menuStyle = { maxWidth: toRem(300), padding: config.space.S200 };

  const renderVersion = (version: string) => {
    const isSelected = version === selected;
    return (
      <Button
        key={version}
        aria-pressed={isSelected}
        onClick={() => onPick(version)}
        fill={isSelected ? 'Solid' : 'Soft'}
        variant={isSelected ? 'Primary' : 'Secondary'}
        radii="300"
        size="300"
        type="button"
      >
        <Text size="B300" as="span">
          {version}
        </Text>
      </Button>
    );
  };

  return (
    <FocusTrap focusTrapOptions={trapOptions}>
      <Menu>
        <Box style={menuStyle} gap="200" direction="Column">
          <Text size="L400">{t('sharedUi.roomVersionSelector.versions')}</Text>
          <Box gap="100" wrap="Wrap">
            {versions.map(renderVersion)}
          </Box>
        </Box>
      </Menu>
    </FocusTrap>
  );
}

/** Picks the room version for a new room from the versions the homeserver offers. */
export function RoomVersionSelector({
  versions,
  value,
  onChange,
  disabled,
}: RoomVersionSelectorProps) {
  const { t } = useTranslation();
  const [menuAnchor, setMenuAnchor] = useState<RectCords>();
  const open = menuAnchor !== undefined;
  const closeMenu = () => setMenuAnchor(undefined);

  const openMenu: MouseEventHandler<HTMLButtonElement> = ({ currentTarget }) => {
    setMenuAnchor(currentTarget.getBoundingClientRect());
  };

  const menu = (
    <VersionMenu
      versions={versions}
      selected={value}
      onDismiss={closeMenu}
      onPick={(version) => {
        onChange(version);
        closeMenu();
      }}
    />
  );

  const trigger = (
    <PopOut anchor={menuAnchor} content={menu} position="Bottom" align="End" offset={5}>
      <Chip
        type="button"



        after={<Icon src={open ? Icons.ChevronTop : Icons.ChevronBottom} size="50" />}
        variant="Secondary"
        radii="300"
        size="400"
      >
        <Text size="B300" as="span">
          {value}
        </Text>
      </Chip>
    </PopOut>
  );

  return (
    <SequenceCard
      direction="Column"
      gap="500"
      variant="SurfaceVariant"
      style={{ padding: config.space.S300 }}
    >
      <SettingTile title={t('sharedUi.roomVersionSelector.version')} after={trigger} />
    </SequenceCard>
  );
}
