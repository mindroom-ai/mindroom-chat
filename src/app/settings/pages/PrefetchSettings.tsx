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
const SCOPE_LABEL_KEYS = {
  'current-room-only': 'options.prefetchScope.currentRoomOnly',
  'all-rooms': 'options.prefetchScope.allRooms',
} as const satisfies Record<PrefetchScope, string>;

const SCOPE_CHOICES = Object.keys(SCOPE_LABEL_KEYS) as PrefetchScope[];

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
          {SCOPE_CHOICES.map((value) => (
            <MenuItem
              key={value}
              variant="Surface"
              size="300"
              radii="300"
              role="menuitemradio"
              aria-checked={value === current}
              onClick={() => onPick(value)}
            >
              <Text size="T300">{t(SCOPE_LABEL_KEYS[value])}</Text>
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
        <Text size="T300">{t(SCOPE_LABEL_KEYS[scope])}</Text>
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
 * Settings → Storage & offline: how far background prefetch reaches. Rooms whose history is
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
