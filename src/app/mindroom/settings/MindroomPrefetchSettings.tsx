import React, {
  ChangeEventHandler,
  KeyboardEventHandler,
  MouseEventHandler,
  useEffect,
  useState,
} from 'react';
import {
  Box,
  Button,
  Icon,
  Icons,
  Input,
  Menu,
  MenuItem,
  PopOut,
  RectCords,
  Text,
  config,
  toRem,
} from 'folds';
import FocusTrap from 'focus-trap-react';
import { isKeyHotkey } from 'is-hotkey';
import { useTranslation } from 'react-i18next';
import { SequenceCard } from '../../components/sequence-card';
import { SettingTile } from '../../components/setting-tile';
import { useSetting } from '../../state/hooks/settings';
import { stopPropagation } from '../../utils/keyboard';
import {
  CURRENT_ROOM_DEEP_HISTORY_TARGET,
  type PrefetchScope,
  ROOM_TAIL_PREFETCH_DEPTH,
  sanitizePrefetchDepth,
} from '../engine/prefetchPolicy';
import { mindroomSettingsAtom } from './mindroomSettings';

// CINNY-207 P6.1 / D4: user-facing prefetch settings.
//
// Two tiles under the "Messages" group in General settings:
//   1. "Prefetch scope" — which rooms the background scheduler keeps
//      ready (my-server / all-rooms / current-room-only).
//   2. "Current room history depth" — the target event count for the
//      band-4 deep-history sweep (clamped to
//      [ROOM_TAIL_PREFETCH_DEPTH, CURRENT_ROOM_DEEP_HISTORY_TARGET]).
//
// The scope selector mirrors `SelectMessageLayout` in
// features/settings/general/General.tsx (~762-820): folds PopOut +
// FocusTrap + Menu. The depth input follows the same shape the
// pre-D4 preload-limit input used: Escape resets, Enter/blur commits
// via `sanitizePrefetchDepth`, Success variant while dirty.

type MindroomPrefetchSettingsProps = {
  className?: string;
};

const PREFETCH_SCOPE_ITEMS = [
  { scope: 'my-server', labelKey: 'options.prefetchScope.myHomeserver' },
  { scope: 'all-rooms', labelKey: 'options.prefetchScope.allRooms' },
  { scope: 'current-room-only', labelKey: 'options.prefetchScope.currentRoomOnly' },
] as const satisfies ReadonlyArray<{ scope: PrefetchScope; labelKey: string }>;

export function MindroomPrefetchSettings({ className }: MindroomPrefetchSettingsProps) {
  const { t } = useTranslation();

  return (
    <>
      <SequenceCard className={className} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title={t('settings.general.messages.prefetchScope')}
          description={t('settings.general.messages.prefetchScopeDescription')}
          after={<SelectPrefetchScope />}
        />
      </SequenceCard>
      <SequenceCard className={className} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title={t('settings.general.messages.historyDepth')}
          description={t('settings.general.messages.historyDepthDescription', {
            min: ROOM_TAIL_PREFETCH_DEPTH,
            max: CURRENT_ROOM_DEEP_HISTORY_TARGET,
          })}
          after={<PrefetchDepthInput />}
        />
      </SequenceCard>
    </>
  );
}

export function SelectPrefetchScope() {
  const { t } = useTranslation();
  const [menuCords, setMenuCords] = useState<RectCords>();
  const [prefetchScope, setPrefetchScope] = useSetting(mindroomSettingsAtom, 'prefetchScope');

  const handleMenu: MouseEventHandler<HTMLButtonElement> = (evt) => {
    setMenuCords(evt.currentTarget.getBoundingClientRect());
  };

  const handleSelect = (scope: PrefetchScope) => {
    setPrefetchScope(scope);
    setMenuCords(undefined);
  };

  const currentItem = PREFETCH_SCOPE_ITEMS.find((item) => item.scope === prefetchScope);
  const currentLabel = currentItem ? t(currentItem.labelKey) : prefetchScope;

  return (
    <>
      <Button
        size="300"
        variant="Secondary"
        outlined
        fill="Soft"
        radii="300"
        after={<Icon size="300" src={Icons.ChevronBottom} />}
        onClick={handleMenu}
      >
        <Text size="T300">{currentLabel}</Text>
      </Button>
      <PopOut
        anchor={menuCords}
        offset={5}
        position="Bottom"
        align="End"
        content={
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              onDeactivate: () => setMenuCords(undefined),
              clickOutsideDeactivates: true,
              isKeyForward: (evt: KeyboardEvent) =>
                evt.key === 'ArrowDown' || evt.key === 'ArrowRight',
              isKeyBackward: (evt: KeyboardEvent) =>
                evt.key === 'ArrowUp' || evt.key === 'ArrowLeft',
              escapeDeactivates: stopPropagation,
            }}
          >
            <Menu>
              <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
                {PREFETCH_SCOPE_ITEMS.map((item) => (
                  <MenuItem
                    key={item.scope}
                    size="300"
                    variant={prefetchScope === item.scope ? 'Primary' : 'Surface'}
                    radii="300"
                    onClick={() => handleSelect(item.scope)}
                  >
                    <Text size="T300">{t(item.labelKey)}</Text>
                  </MenuItem>
                ))}
              </Box>
            </Menu>
          </FocusTrap>
        }
      />
    </>
  );
}

export function PrefetchDepthInput() {
  const [prefetchDepth, setPrefetchDepth] = useSetting(mindroomSettingsAtom, 'prefetchDepth');
  const [currentValue, setCurrentValue] = useState(`${prefetchDepth}`);

  useEffect(() => {
    setCurrentValue(prefetchDepth.toString());
  }, [prefetchDepth]);

  const commitValue = (raw: string) => {
    const parsed = parseInt(raw, 10);
    if (Number.isNaN(parsed)) return;
    const safe = sanitizePrefetchDepth(parsed);
    setPrefetchDepth(safe);
    setCurrentValue(safe.toString());
  };

  const handleChange: ChangeEventHandler<HTMLInputElement> = (evt) => {
    setCurrentValue(evt.target.value);
  };

  const handleKeyDown: KeyboardEventHandler<HTMLInputElement> = (evt) => {
    if (isKeyHotkey('escape', evt)) {
      evt.stopPropagation();
      setCurrentValue(prefetchDepth.toString());
    }
    if (
      isKeyHotkey('enter', evt) &&
      'value' in evt.target &&
      typeof evt.target.value === 'string'
    ) {
      commitValue(evt.target.value);
    }
  };

  const handleBlur = () => {
    commitValue(currentValue);
  };

  return (
    <Input
      style={{ width: toRem(100) }}
      variant={prefetchDepth === parseInt(currentValue, 10) ? 'Secondary' : 'Success'}
      size="300"
      radii="300"
      type="number"
      min={ROOM_TAIL_PREFETCH_DEPTH.toString()}
      max={CURRENT_ROOM_DEEP_HISTORY_TARGET.toString()}
      value={currentValue}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      outlined
    />
  );
}
