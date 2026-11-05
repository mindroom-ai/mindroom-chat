import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Icon, IconButton, Icons, Line, Switch, Text, config } from 'folds';
import { Modal500 } from '../../components/Modal500';
import { settingsAtom } from '../../state/settings';
import { useSetting } from '../../state/hooks/settings';
import { useSettingValue } from '../../state/hooks/useSettingValue';
import { HELP_DIALOG_ATTRIBUTE } from './shortcutDom';
import {
  SHORTCUT_IDS,
  SHORTCUTS,
  keyCapsOf,
  shortcutKeyCaps,
  usesCommandKey,
  type ShortcutGroup,
  type ShortcutId,
} from './shortcuts';
import * as css from './Shortcuts.css';

const GROUPS: readonly ShortcutGroup[] = ['general', 'rooms', 'composer'];

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
  const [hintsOn, setHintsOn] = useSetting(settingsAtom, 'shortcutHints');
  // With Enter for new lines, ⌘ or Ctrl and Enter sends.
  const enterForNewline = useSettingValue(settingsAtom, 'enterForNewline');
  const capsOf = (id: ShortcutId): string[] => {
    if (enterForNewline && id === 'send') return keyCapsOf('mod+enter', apple);
    if (enterForNewline && id === 'newLine') return keyCapsOf('enter', apple);
    return shortcutKeyCaps(id, apple);
  };

  return (
    <Modal500 requestClose={onClose}>
      <Box direction="Column" {...{ [HELP_DIALOG_ATTRIBUTE]: '' }}>
        <Box
          alignItems="Center"
          gap="200"
          style={{ padding: config.space.S400, paddingBlockEnd: config.space.S200 }}
        >
          <Box grow="Yes">
            <Text as="h2" size="H4">
              {t('shortcuts.help.title')}
            </Text>
          </Box>
          <IconButton
            size="300"
            radii="300"
            variant="Surface"
            aria-label={t('shortcuts.help.close')}
            onClick={onClose}
          >
            <Icon src={Icons.Cross} size="100" />
          </IconButton>
        </Box>
        <div className={css.HelpScroll}>
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
                {SHORTCUT_IDS.filter((id) => SHORTCUTS[id].group === group).map((id) => (
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
          </Box>
        </div>
      </Box>
    </Modal500>
  );
}
