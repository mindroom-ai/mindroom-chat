import React, { useState } from 'react';
import FocusTrap from 'focus-trap-react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Icon, Icons, Text, config, type RectCords } from 'folds';
import { PopOut } from '../../ui/directional';
import type { PrefetchScope } from '../../event-store/engine/prefetchPolicy';
import { prefetchSettingsAtom } from '../../event-store/engine/prefetchSettings';
import { CACHE_BYTE_BUDGET_PRESETS } from '../../event-store/engine/prefetchSettingsStorage';
import { useSetting } from '../../preferences/useSetting';
import { stopPropagation } from '../../lib/keyboard';
import { SettingTile } from '../../ui/SettingTile';
import { SequenceCard } from '../../ui/SequenceCard';
import { Menu, MenuItem } from '../../ui/glass/GlassPrimitives';

/** Menu order runs from the narrowest reach to the widest. */
const SCOPE_LABEL_KEYS = {
  'current-room-only': 'options.prefetchScope.currentRoomOnly',
  'all-rooms': 'options.prefetchScope.allRooms',
} as const satisfies Record<PrefetchScope, string>;

const SCOPE_CHOICES = Object.keys(SCOPE_LABEL_KEYS) as PrefetchScope[];

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

type ChoiceOption<T extends string | number> = {
  value: T;
  label: string;
};

type ChoiceMenuProps<T extends string | number> = {
  current: T;
  options: readonly ChoiceOption<T>[];
  onPick: (value: T) => void;
  onDismiss: () => void;
};

function ChoiceMenu<T extends string | number>({
  current,
  options,
  onPick,
  onDismiss,
}: ChoiceMenuProps<T>) {
  const trapOptions = {
    initialFocus: false as const,
    clickOutsideDeactivates: true,
    escapeDeactivates: stopPropagation,
    onDeactivate: onDismiss,
  };

  return (
    <FocusTrap focusTrapOptions={trapOptions}>
      <Menu>
        <Box style={{ padding: config.space.S100 }} direction="Column" gap="100">
          {options.map(({ value, label }) => (
            <MenuItem
              key={String(value)}
              variant="Surface"
              size="300"
              radii="300"
              role="menuitemradio"
              aria-checked={value === current}
              onClick={() => onPick(value)}
            >
              <Text size="T300">{label}</Text>
            </MenuItem>
          ))}
        </Box>
      </Menu>
    </FocusTrap>
  );
}

type SelectChoiceProps<T extends string | number> = {
  current: T;
  options: readonly ChoiceOption<T>[];
  onChange: (value: T) => void;
};

function SelectChoice<T extends string | number>({
  current,
  options,
  onChange,
}: SelectChoiceProps<T>) {
  const [anchor, setAnchor] = useState<RectCords | undefined>(undefined);
  const dismiss = () => setAnchor(undefined);
  const currentLabel = options.find((option) => option.value === current)?.label ?? '';

  return (
    <>
      <Button
        onClick={(event: React.MouseEvent<HTMLButtonElement>) =>
          setAnchor(event.currentTarget.getBoundingClientRect())
        }
        after={<Icon size="300" src={Icons.ChevronBottom} />}
        variant="Secondary"
        fill="Soft"
        outlined
        size="300"
        radii="300"
      >
        <Text size="T300">{currentLabel}</Text>
      </Button>
      <PopOut
        position="Bottom"
        align="End"
        offset={5}
        anchor={anchor}
        content={
          <ChoiceMenu
            current={current}
            options={options}
            onDismiss={dismiss}
            onPick={(next) => {
              onChange(next);
              dismiss();
            }}
          />
        }
      />
    </>
  );
}

/** The menu for which rooms keep their history loaded in the background. */
export function SelectPrefetchScope() {
  const { t } = useTranslation();
  const [scope, setScope] = useSetting(prefetchSettingsAtom, 'prefetchScope');
  const options = SCOPE_CHOICES.map((value) => ({ value, label: t(SCOPE_LABEL_KEYS[value]) }));

  return <SelectChoice current={scope} options={options} onChange={setScope} />;
}

/** The menu for how much local storage this device reserves for cached rooms and media. */
export function SelectCacheBudget() {
  const { t } = useTranslation();
  const [budget, setBudget] = useSetting(prefetchSettingsAtom, 'cacheBudgetBytes');
  const options = CACHE_BYTE_BUDGET_PRESETS.map((value) => ({
    value,
    label:
      value >= GIB
        ? t('featureUi.settings.storage.gigabytes', { size: value / GIB })
        : t('featureUi.settings.storage.megabytes', { size: value / MIB }),
  }));

  return <SelectChoice current={budget} options={options} onChange={setBudget} />;
}

/**
 * Settings → Storage & offline: background prefetch reach and local cache size limit.
 */
export function PrefetchSettings({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <SequenceCard className={className} variant="SurfaceVariant" direction="Column" gap="400">
      <SettingTile
        focusId="prefetchScope"
        title={t('settings.general.messages.prefetchScope')}
        description={t('settings.general.messages.prefetchScopeDescription')}
        after={<SelectPrefetchScope />}
      />
      <SettingTile
        focusId="cacheBudget"
        title={t('featureUi.settings.storage.cacheBudget')}
        description={t('featureUi.settings.storage.cacheBudgetDescription')}
        after={<SelectCacheBudget />}
      />
    </SequenceCard>
  );
}
