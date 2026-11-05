import { Icon, Icons, Text, type IconSrc } from 'folds';
import { useTranslation } from 'react-i18next';
import {
  SETTING_SCOPE_LABEL_KEYS,
  getSettingDefinition,
  type SettingScope,
} from '../../preferences/settingsRegistry';
import { ScopeLabel } from './scopeLabel.css';

const SCOPE_ICONS: Record<SettingScope, IconSrc> = {
  device: Icons.Monitor,
  account: Icons.User,
  'room-personal': Icons.Hash,
  'room-shared': Icons.HashGlobe,
};

/**
 * Where the setting `id` applies, as the registry records its storage: this device, the
 * account on every device, the room for the person alone, or the room for everyone in it.
 */
export function SettingScopeLabel({ id }: { id: string }) {
  const { t } = useTranslation();
  const scope = getSettingDefinition(id)?.scope;
  if (!scope) return null;

  return (
    <Text as="span" size="T200" priority="300" className={ScopeLabel} data-setting-scope={scope}>
      <Icon size="50" src={SCOPE_ICONS[scope]} aria-hidden />
      {t(SETTING_SCOPE_LABEL_KEYS[scope])}
    </Text>
  );
}
