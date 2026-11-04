import React, { useState } from 'react';
import FocusTrap from 'focus-trap-react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Icon, Icons, Text, config, type RectCords } from 'folds';
import { PopOut } from '../../components/directional';
import type { PrefetchScope } from '../engine/prefetchPolicy';
import { mindroomSettingsAtom } from './mindroomSettings';
import { useSetting } from '../../state/hooks/settings';
import { stopPropagation } from '../../utils/keyboard';
import { SettingTile } from '../../components/setting-tile';
import { SequenceCard } from '../../components/sequence-card';
import { Menu, MenuItem } from '../../components/glass/GlassPrimitives';

/** Menu order runs from the narrowest reach to the widest. */
const SCOPE_CHOICES = [
  { value: 'current-room-only', labelKey: 'options.prefetchScope.currentRoomOnly' },
  { value: 'my-server', labelKey: 'options.prefetchScope.myHomeserver' },
  { value: 'all-rooms', labelKey: 'options.prefetchScope.allRooms' },
] as const satisfies ReadonlyArray<{ value: PrefetchScope; labelKey: string }>;

type ScopeLabelKey = (typeof SCOPE_CHOICES)[number]['labelKey'];

const scopeLabelKey = (scope: PrefetchScope): ScopeLabelKey =>
  SCOPE_CHOICES.find((choice) => choice.value === scope)?.labelKey ?? SCOPE_CHOICES[0].labelKey;

/** Moves focus between the menu items with the vertical arrow keys. */
const pressed =
  (key: 'ArrowDown' | 'ArrowUp') =>
  (event: KeyboardEvent): boolean =>
    event.key === key;

type ScopeMenuProps = {
  current: PrefetchScope;
  onPick: (scope: PrefetchScope) => void;
  onDismiss: () => void;
};

function ScopeMenu({ current, onPick, onDismiss }: ScopeMenuProps) {
  const { t } = useTranslation();
  const trapOptions = {
    initialFocus: false as const,
    clickOutsideDeactivates: true,
    escapeDeactivates: stopPropagation,
    onDeactivate: onDismiss,
    isKeyForward: pressed('ArrowDown'),
    isKeyBackward: pressed('ArrowUp'),
  };

  return (
    <FocusTrap focusTrapOptions={trapOptions}>
      <Menu>
        <Box style={{ padding: config.space.S100 }} direction="Column" gap="100">
          {SCOPE_CHOICES.map(({ value, labelKey }) => (
            <MenuItem
              key={value}
              variant="Surface"
              size="300"
              radii="300"
              aria-pressed={value === current}
              onClick={() => onPick(value)}
            >
              <Text size="T300">{t(labelKey)}</Text>
            </MenuItem>
          ))}
        </Box>
      </Menu>
    </FocusTrap>
  );
}

/** The menu for which rooms keep their history loaded in the background. */
export function SelectPrefetchScope() {
  const { t } = useTranslation();
  const [scope, setScope] = useSetting(mindroomSettingsAtom, 'prefetchScope');
  const [anchor, setAnchor] = useState<RectCords | undefined>(undefined);
  const dismiss = () => setAnchor(undefined);

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
        <Text size="T300">{t(scopeLabelKey(scope))}</Text>
      </Button>
      <PopOut
        position="Bottom"
        align="End"
        offset={5}
        anchor={anchor}
        content={
          <ScopeMenu
            current={scope}
            onDismiss={dismiss}
            onPick={(next) => {
              setScope(next);
              dismiss();
            }}
          />
        }
      />
    </>
  );
}

/**
 * Settings → General → Messages: how far background prefetch reaches. Rooms whose history is
 * prefetched open from cache, at the cost of syncing their history in the background.
 */
export function MindroomPrefetchSettings({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <SequenceCard className={className} variant="SurfaceVariant" direction="Column" gap="400">
      <SettingTile
        title={t('settings.general.messages.prefetchScope')}
        description={t('settings.general.messages.prefetchScopeDescription')}
        after={<SelectPrefetchScope />}
      />
    </SequenceCard>
  );
}
