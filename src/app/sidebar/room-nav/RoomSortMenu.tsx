import type { KeyboardEvent } from 'react';
import { Icon, Icons, Line, Switch, Text, config } from 'folds';
import { useTranslation } from 'react-i18next';
import { MenuItem } from '../../ui/glass/GlassPrimitives';
import { MenuGroup } from '../../ui/MenuEntry';
import { NavOptionsMenu } from '../../ui/nav/NavOptionsMenu';
import type { RoomSortMode } from './roomOrder';

const headingStyle = { paddingBlock: config.space.S100, paddingInline: config.space.S200 } as const;
const labelStyle = { flexGrow: 1, textAlign: 'start' } as const;

const SORT_MODES = [
  { id: 'recent', labelKey: 'featureUi.roomOrder.recentActivity' },
  { id: 'name', labelKey: 'featureUi.roomOrder.aToZ' },
  { id: 'manual', labelKey: 'featureUi.roomOrder.customOrder' },
] as const;

const SHORT_MODE_KEYS = {
  recent: 'featureUi.roomOrder.shortRecent',
  name: 'featureUi.roomOrder.shortName',
  manual: 'featureUi.roomOrder.shortManual',
} as const;

function SortRadioItem({
  label,
  checked,
  detail,
  onSelect,
}: {
  label: string;
  checked: boolean;
  detail?: string;
  onSelect: () => void;
}) {
  return (
    <MenuItem
      role="menuitemradio"
      aria-checked={checked}
      size="300"
      radii="300"
      variant="Surface"
      fill={checked ? 'Soft' : 'None'}
      after={checked ? <Icon size="50" src={Icons.Check} /> : undefined}
      onClick={onSelect}
    >
      <Text as="span" size="T300" truncate style={labelStyle}>
        {label}
      </Text>
      {detail && (
        <Text as="span" size="T200" priority="300" style={{ flexShrink: 0 }}>
          {detail}
        </Text>
      )}
    </MenuItem>
  );
}

export type RoomSortInheritOption = {
  mode: RoomSortMode;
  overridden: boolean;
  onReset: () => void;
};

export type RoomSortMenuContentProps = {
  mode: RoomSortMode;
  showTimes: boolean;
  hasSavedOrder: boolean;
  onModeChange: (mode: RoomSortMode) => void;
  onShowTimesChange: (show: boolean) => void;
  inherit?: RoomSortInheritOption;
  inlineDisplay?: boolean;
};

/** Shared sort radio rows and activity-times toggle for the header popover and sub-space menus. */
export function RoomSortMenuContent({
  mode,
  showTimes,
  hasSavedOrder,
  onModeChange,
  onShowTimesChange,
  inherit,
  inlineDisplay = false,
}: RoomSortMenuContentProps) {
  const { t } = useTranslation();
  const toggleShowTimes = () => onShowTimesChange(!showTimes);
  const handleToggleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleShowTimes();
    }
  };

  const showTimesRow = (
    <MenuItem
      as="div"
      role="menuitemcheckbox"
      aria-checked={showTimes}
      tabIndex={0}
      size="300"
      radii="300"
      variant="Surface"
      fill="None"
      after={
        <Switch
          value={showTimes}
          variant="Primary"
          tabIndex={-1}
          aria-hidden="true"
          style={{ pointerEvents: 'none' }}
        />
      }
      onClick={toggleShowTimes}
      onKeyDown={handleToggleKeyDown}
    >
      <Text as="span" size="T300" truncate style={labelStyle}>
        {t('featureUi.roomOrder.showActivityTimes')}
      </Text>
    </MenuItem>
  );

  return (
    <>
      <MenuGroup>
        <Text as="span" size="O400" priority="300" style={headingStyle}>
          {t('featureUi.roomOrder.sortHeading')}
        </Text>
        {inherit && (
          <SortRadioItem
            label={t('featureUi.roomOrder.matchSpace', { mode: t(SHORT_MODE_KEYS[inherit.mode]) })}
            checked={!inherit.overridden}
            onSelect={inherit.onReset}
          />
        )}
        {SORT_MODES.map((item) => (
          <SortRadioItem
            key={item.id}
            label={t(item.labelKey)}
            checked={inherit ? inherit.overridden && mode === item.id : mode === item.id}
            detail={
              item.id === 'manual' && hasSavedOrder && mode !== 'manual'
                ? t('featureUi.roomOrder.saved')
                : undefined
            }
            onSelect={() => onModeChange(item.id)}
          />
        ))}
        {inlineDisplay && showTimesRow}
      </MenuGroup>
      {!inlineDisplay && (
        <>
          <Line size="300" />
          <MenuGroup>
            <Text as="span" size="O400" priority="300" style={headingStyle}>
              {t('featureUi.roomOrder.displayHeading')}
            </Text>
            {showTimesRow}
          </MenuGroup>
        </>
      )}
    </>
  );
}

export type RoomSortMenuProps = {
  mode: RoomSortMode;
  showTimes: boolean;
  hasSavedOrder: boolean;
  onModeChange: (mode: RoomSortMode) => void;
  onShowTimesChange: (show: boolean) => void;
  buttonClassName?: string;
};

/** Header sort button and popover for Home and Space room lists. */
export function RoomSortMenu({
  mode,
  showTimes,
  hasSavedOrder,
  onModeChange,
  onShowTimesChange,
  buttonClassName,
}: RoomSortMenuProps) {
  const { t } = useTranslation();
  return (
    <NavOptionsMenu
      icon={Icons.Sort}
      label={t('featureUi.roomOrder.sortRooms')}
      width={220}
      active={mode !== 'name' || showTimes}
      menuRole="menu"
      buttonClassName={buttonClassName}
    >
      {(close) => (
        <RoomSortMenuContent
          mode={mode}
          showTimes={showTimes}
          hasSavedOrder={hasSavedOrder}
          onModeChange={(nextMode) => {
            onModeChange(nextMode);
            close();
          }}
          onShowTimesChange={onShowTimesChange}
        />
      )}
    </NavOptionsMenu>
  );
}
