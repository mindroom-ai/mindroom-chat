import { useTranslation } from 'react-i18next';
import type { PrefetchScope } from '../../event-store/engine/prefetchPolicy';
import { prefetchSettingsAtom } from '../../event-store/engine/prefetchSettings';
import { CACHE_BYTE_BUDGET_PRESETS } from '../../event-store/engine/prefetchSettingsStorage';
import { useSetting } from '../../preferences/useSetting';
import { SettingTile } from '../../ui/SettingTile';
import { SequenceCard } from '../../ui/SequenceCard';
import { ChoiceButton } from '../../ui/settings/ChoiceButton';

/** Menu order runs from the narrowest reach to the widest. */
const SCOPE_LABEL_KEYS = {
  'current-room-only': 'options.prefetchScope.currentRoomOnly',
  'all-rooms': 'options.prefetchScope.allRooms',
} as const satisfies Record<PrefetchScope, string>;

const SCOPE_CHOICES = Object.keys(SCOPE_LABEL_KEYS) as PrefetchScope[];

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

/** The menu for which rooms keep their history loaded in the background. */
export function SelectPrefetchScope() {
  const { t } = useTranslation();
  const [scope, setScope] = useSetting(prefetchSettingsAtom, 'prefetchScope');
  const choices = SCOPE_CHOICES.map((value) => ({ value, label: t(SCOPE_LABEL_KEYS[value]) }));

  return (
    <ChoiceButton
      label={t('settings.general.messages.prefetchScope')}
      value={scope}
      choices={choices}
      onChoose={setScope}
    />
  );
}

/** The menu for the per-account cache size target for cached rooms and media. */
export function SelectCacheBudget() {
  const { t } = useTranslation();
  const [budget, setBudget] = useSetting(prefetchSettingsAtom, 'cacheBudgetBytes');
  const choices = CACHE_BYTE_BUDGET_PRESETS.map((value) => ({
    value,
    label:
      value >= GIB
        ? t('featureUi.settings.storage.gigabytes', { size: value / GIB })
        : t('featureUi.settings.storage.megabytes', { size: value / MIB }),
  }));

  return (
    <ChoiceButton
      label={t('featureUi.settings.storage.cacheBudget')}
      value={budget}
      choices={choices}
      onChoose={setBudget}
    />
  );
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
