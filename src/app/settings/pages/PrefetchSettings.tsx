import React, { useState } from 'react';
import FocusTrap from 'focus-trap-react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Icon, Icons, Text, config, type RectCords } from 'folds';
import { PopOut } from '../../ui/directional';
import type { PrefetchScope } from '../../event-store/engine/prefetchPolicy';
import { prefetchSettingsAtom } from '../../event-store/engine/prefetchSettings';
import { useSetting } from '../../preferences/useSetting';
import { stopPropagation } from '../../lib/keyboard';
import { SettingTile } from '../../ui/SettingTile';
import { SequenceCard } from '../../ui/SequenceCard';
import { Menu, MenuItem } from '../../ui/glass/GlassPrimitives';

/** Menu order runs from the narrowest reach to the widest. */
const SCOPE_CHOICES = [
  { value: 'current-room-only', labelKey: 'options.prefetchScope.currentRoomOnly' },
  { value: 'all-rooms', labelKey: 'options.prefetchScope.allRooms' },
] as const satisfies ReadonlyArray<{ value: PrefetchScope; labelKey: string }>;

type ScopeLabelKey = (typeof SCOPE_CHOICES)[number]['labelKey'];

const scopeLabelKey = (scope: PrefetchScope): ScopeLabelKey =>
  SCOPE_CHOICES.find((choice) => choice.value === scope)?.labelKey ?? SCOPE_CHOICES[0].labelKey;

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
              role="menuitemradio"
              aria-checked={value === current}
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
  const [scope, setScope] = useSetting(prefetchSettingsAtom, 'prefetchScope');
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
    </SequenceCard>
  );
}
