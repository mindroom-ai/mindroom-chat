import { Switch } from 'folds';
import { SettingTile } from '../SettingTile';
import { useSetting } from '../../preferences/useSetting';
import { type Settings, settingsAtom } from '../../preferences/settings';

type SwitchSetting = {
  [K in keyof Settings]-?: Settings[K] extends boolean ? K : never;
}[keyof Settings];

type SettingSwitchTileProps = {
  /** The tile's setting in the settings registry. */
  focusId: string;
  setting: SwitchSetting;
  title: string;
  description?: string;
  /** The switch shows the opposite of the stored value ("Disable ..." tiles). */
  inverted?: boolean;
};

/** A tile whose switch turns one of this device's on/off settings on or off. */
export function SettingSwitchTile({
  focusId,
  setting,
  title,
  description,
  inverted = false,
}: SettingSwitchTileProps) {
  const [stored, setStored] = useSetting(settingsAtom, setting);

  return (
    <SettingTile
      focusId={focusId}
      title={title}
      description={description}
      after={
        <Switch
          variant="Primary"
          aria-label={title}
          value={stored !== inverted}
          onChange={(on: boolean) => setStored(on !== inverted)}
        />
      }
    />
  );
}
