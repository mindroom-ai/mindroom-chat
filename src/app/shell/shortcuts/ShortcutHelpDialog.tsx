import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { isBundledApp } from '../../lib/nativeShell';
import { Box, Line, Switch, Text, config } from 'folds';
import { DialogCloseButton, SheetScrollArea } from '../../ui/DialogChrome';
import { Modal500 } from '../../ui/Modal500';
import { settingsAtom } from '../../preferences/settings';
import { useSetting } from '../../preferences/useSetting';
import { useSettingValue } from '../../preferences/useSettingValue';
import { HELP_DIALOG_ATTRIBUTE } from '../../shortcuts/shortcutDom';
import {
  SHORTCUT_IDS,
  SHORTCUTS,
  formatShortcut,
  keyCapsOf,
  shortcutKeyCaps,
  usesCommandKey,
  type ShortcutGroup,
  type ShortcutId,
} from '../../shortcuts/shortcuts';
import * as css from './Shortcuts.css';

const GROUPS: readonly ShortcutGroup[] = ['general', 'rooms', 'composer', 'settings'];

function KeyCaps({ caps }: { caps: readonly string[] }) {
  return (
    <span className={css.KeyCaps}>
      {caps.map((cap) => (
        <kbd key={cap} className={css.KeyCap}>
          {cap}
        </kbd>
      ))}
    </span>
  );
}

/** Every shortcut by group, and the switch for the hints that holding ⌘ or Ctrl shows. */
export function ShortcutHelpDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const switchId = useId();
  const apple = usesCommandKey();
  const native = isBundledApp();
  const [hintsOn, setHintsOn] = useSetting(settingsAtom, 'shortcutHints');
  const voiceSwitchId = useId();
  const [voiceKeyOn, setVoiceKeyOn] = useSetting(settingsAtom, 'voiceHoldShortcut');
  // With Enter for new lines, ⌘ or Ctrl and Enter sends.
  const enterForNewline = useSettingValue(settingsAtom, 'enterForNewline');
  const capsOf = (id: ShortcutId): string[] => {
    if (enterForNewline && id === 'send') return keyCapsOf('mod+enter', apple);
    if (enterForNewline && id === 'newLine') return keyCapsOf('enter', apple);
    return shortcutKeyCaps(id, apple);
  };

  return (
    <Modal500 requestClose={onClose}>
      <Box
        direction="Column"
        grow="Yes"
        style={{ minHeight: 0 }}
        {...{ [HELP_DIALOG_ATTRIBUTE]: '' }}
      >
        <Box
          shrink="No"
          alignItems="Center"
          gap="200"
          style={{ padding: config.space.S400, paddingBlockEnd: config.space.S200 }}
        >
          <Box grow="Yes">
            <Text as="h2" size="H4">
              {t('shortcuts.help.title')}
            </Text>
          </Box>
          <DialogCloseButton label={t('shortcuts.help.close')} onClick={onClose} />
        </Box>
        <SheetScrollArea className={css.HelpScrollFrame}>
          <Box
            direction="Column"
            gap="400"
            style={{ paddingInline: config.space.S400, paddingBlockEnd: config.space.S400 }}
          >
            {GROUPS.map((group) => (
              <Box as="section" key={group} direction="Column" gap="100">
                <Text as="h3" size="L400" priority="300">
                  {t(`shortcuts.groups.${group}`)}
                </Text>
                {SHORTCUT_IDS.filter(
                  (id) => SHORTCUTS[id].group === group && (native || !SHORTCUTS[id].browserKey)
                ).map((id) => (
                  <div key={id} className={css.HelpRow} data-shortcut-row={id}>
                    <Text size="T300">{t(SHORTCUTS[id].labelKey)}</Text>
                    <KeyCaps caps={capsOf(id)} />
                  </div>
                ))}
              </Box>
            ))}
            <Line variant="Surface" size="300" />
            <Box alignItems="Center" justifyContent="SpaceBetween" gap="300">
              <Text as="label" htmlFor={switchId} size="T300">
                {t('shortcuts.help.hintsSwitch', { key: apple ? '⌘' : 'Ctrl' })}
              </Text>
              <Switch id={switchId} variant="Primary" value={hintsOn} onChange={setHintsOn} />
            </Box>
            <Box alignItems="Center" justifyContent="SpaceBetween" gap="300">
              <Text as="label" htmlFor={voiceSwitchId} size="T300">
                {t('shortcuts.voiceKey.label', { voiceKey: formatShortcut('voiceRecord', apple) })}
              </Text>
              <Switch
                id={voiceSwitchId}
                variant="Primary"
                value={voiceKeyOn}
                onChange={setVoiceKeyOn}
              />
            </Box>
          </Box>
        </SheetScrollArea>
      </Box>
    </Modal500>
  );
}
