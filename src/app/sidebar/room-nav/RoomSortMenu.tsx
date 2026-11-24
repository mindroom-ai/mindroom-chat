import { type KeyboardEvent, type MouseEvent, useCallback, useRef, useState } from 'react';
import { Icon, IconButton, Icons, Line, Switch, Text, config, toRem, type RectCords } from 'folds';
import FocusTrap from 'focus-trap-react';
import { useTranslation } from 'react-i18next';
import { PopOut } from '../../ui/directional';
import { Menu, MenuItem } from '../../ui/glass/GlassPrimitives';
import { MenuGroup } from '../../ui/MenuEntry';
import * as scrollableMenuCss from '../../ui/ScrollableMenu.css';
import { LoneTouchTarget } from '../../ui/styles/TouchTarget.css';
import { stopPropagation } from '../../lib/keyboard';
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
  buttonClassName = LoneTouchTarget,
}: RoomSortMenuProps) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<RectCords>();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const refocusOnCloseRef = useRef(false);

  const close = useCallback(() => {
    setAnchor(undefined);
    if (refocusOnCloseRef.current) {
      refocusOnCloseRef.current = false;
      buttonRef.current?.focus();
    }
  }, []);

  const open = (event: MouseEvent<HTMLButtonElement>) => {
    refocusOnCloseRef.current = false;
    setAnchor(event.currentTarget.getBoundingClientRect());
  };

  const active = mode !== 'name' || showTimes;
  const label = t('featureUi.roomOrder.sortRooms');

  const menu = (
    <FocusTrap
      focusTrapOptions={{
        onDeactivate: close,
        escapeDeactivates: (event) => {
          if (!stopPropagation(event)) return false;
          refocusOnCloseRef.current = true;
          return true;
        },
        clickOutsideDeactivates: true,
        initialFocus: false,
        returnFocusOnDeactivate: false,
      }}
    >
      <Menu
        role="menu"
        aria-label={label}
        className={scrollableMenuCss.ScrollableMenu}
        style={{ width: '100vw', maxWidth: toRem(220) }}
      >
        <div className={scrollableMenuCss.ScrollableMenuRows}>
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
        </div>
      </Menu>
    </FocusTrap>
  );

  return (
    <>
      <IconButton
        ref={buttonRef}
        variant={active ? 'Primary' : 'Background'}
        fill={active ? 'Soft' : undefined}
        className={buttonClassName}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        data-sort-active={active ? 'true' : undefined}
        onClick={open}
      >
        <Icon size="200" src={Icons.Sort} />
      </IconButton>
      <PopOut anchor={anchor} position="Bottom" align="End" offset={6} content={menu} />
    </>
  );
}
