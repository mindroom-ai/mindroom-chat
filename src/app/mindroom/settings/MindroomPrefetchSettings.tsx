import React, { MouseEventHandler, useState } from 'react';
import { useTranslation } from 'react-i18next';
import FocusTrap from 'focus-trap-react';
import { Box, Button, Icon, Icons, Menu, MenuItem, PopOut, RectCords, Text, config } from 'folds';
import { SequenceCard } from '../../components/sequence-card';
import { SettingTile } from '../../components/setting-tile';
import { useSetting } from '../../state/hooks/settings';
import { stopPropagation } from '../../utils/keyboard';
import type { PrefetchScope } from '../engine/prefetchPolicy';
import { mindroomSettingsAtom } from './mindroomSettings';

const SCOPES: readonly PrefetchScope[] = ['current-room-only', 'my-server', 'all-rooms'];

const SCOPE_LABEL_KEYS = {
  'current-room-only': 'settings.general.prefetch.scopeCurrentRoom',
  'my-server': 'settings.general.prefetch.scopeMyServer',
  'all-rooms': 'settings.general.prefetch.scopeAllRooms',
} as const satisfies Record<PrefetchScope, string>;

/** The menu for which rooms keep their history loaded in the background. */
export function SelectPrefetchScope() {
  const { t } = useTranslation();
  const [scope, setScope] = useSetting(mindroomSettingsAtom, 'prefetchScope');
  const [menuCords, setMenuCords] = useState<RectCords>();

  const handleOpen: MouseEventHandler<HTMLButtonElement> = (event) => {
    setMenuCords(event.currentTarget.getBoundingClientRect());
  };

  const choose = (next: PrefetchScope) => {




































                  <MenuItem
                    key={option}
                    size="300"
                    variant="Surface"
                    aria-pressed={option === scope}
                    radii="300"
                    onClick={() => choose(option)}
                  >
                    <Text size="T300">{t(SCOPE_LABEL_KEYS[option])}</Text>
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

/**
 * Settings → General → Messages: how far background prefetch reaches. Rooms whose history is
 * prefetched open from cache, at the cost of syncing their history in the background.
 */
export function MindroomPrefetchSettings({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <SequenceCard className={className} variant="SurfaceVariant" direction="Column" gap="400">
      <SettingTile
        title={t('settings.general.prefetch.scope')}
        description={t('settings.general.prefetch.scopeDescription')}
        after={<SelectPrefetchScope />}
      />
    </SequenceCard>
  );
}
