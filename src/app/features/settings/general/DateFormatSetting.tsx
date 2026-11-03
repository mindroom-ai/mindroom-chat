import React, { FormEvent, MouseEvent, useState } from 'react';
import dayjs from 'dayjs';
import FocusTrap from 'focus-trap-react';
import {
  Box,
  Button,
  Icon,
  IconButton,
  Icons,
  Input,
  PopOut,
  Text,
  config,
  toRem,
  type RectCords,
} from 'folds';
import { useTranslation } from 'react-i18next';
import { Header, Menu } from '../../../components/glass/GlassPrimitives';
import { SettingTile } from '../../../components/setting-tile';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';
import { stopPropagation } from '../../../utils/keyboard';
import { ChoiceButton } from '../ChoiceButton';

/** Ready-made formats; anything else the user typed counts as custom. */
const PRESET_FORMATS = [
  'D MMM YYYY',
  'DD/MM/YYYY',
  'MM/DD/YYYY',
  'YYYY-MM-DD',
  'dddd, D MMMM YYYY',
];
const CUSTOM = 'custom';

const HINT_PREFIX = 'settings.general.dateTime.formatHints' as const;

/** dayjs tokens per group, with the key of their explanation. */
const TOKEN_GROUPS = [
  [
    `${HINT_PREFIX}.year`,
    [
      ['YY', `${HINT_PREFIX}.twoDigitYear`],
      ['YYYY', `${HINT_PREFIX}.fourDigitYear`],
    ],
  ],
  [
    `${HINT_PREFIX}.month`,
    [
      ['M', `${HINT_PREFIX}.theMonth`],
      ['MM', `${HINT_PREFIX}.twoDigitMonth`],
      ['MMM', `${HINT_PREFIX}.shortMonthName`],
      ['MMMM', `${HINT_PREFIX}.fullMonthName`],
    ],
  ],
  [
    `${HINT_PREFIX}.dayOfMonth`,
    [
      ['D', `${HINT_PREFIX}.theDayOfMonth`],
      ['DD', `${HINT_PREFIX}.twoDigitDayOfMonth`],
    ],
  ],
  [
    `${HINT_PREFIX}.dayOfWeek`,
    [
      ['d', `${HINT_PREFIX}.theDayOfWeek`],
      ['dd', `${HINT_PREFIX}.twoLetterDayName`],
      ['ddd', `${HINT_PREFIX}.shortDayName`],
      ['dddd', `${HINT_PREFIX}.fullDayName`],
    ],
  ],
] as const;

/** The list of dayjs tokens, under a "Formatting" title bar. */
function FormatHints() {
  const { t } = useTranslation();
  const groups = TOKEN_GROUPS.map(([group, tokens]) => (
    <Box key={group} direction="Column" gap="100">
      <Text size="L400">{t(group)}</Text>
      {tokens.map(([token, key]) => (
        <Box key={token} gap="200" alignItems="Baseline">
          <Text as="code" size="T300" style={{ minWidth: toRem(48) }}>
            {token}
          </Text>
          <Text size="T200" priority="300">
            {t(key)}
          </Text>
        </Box>
      ))}
    </Box>
  ));

  return (
    // The list scrolls, so it takes focus (keyboard scrolling, and the focus trap needs a stop).
    <Menu tabIndex={0} style={{ width: toRem(280), maxHeight: '60vh', overflowY: 'auto' }}>
      <Header size="400" variant="Surface" style={{ padding: `0 ${config.space.S300}` }}>
        <Text size="H5">{t(`${HINT_PREFIX}.title`)}</Text>
      </Header>
      <Box direction="Column" gap="300" style={{ padding: config.space.S300 }}>
        {groups}
      </Box>
    </Menu>
  );
}

/** A text field for a dayjs format, a button that explains the tokens, and Save. */
function CustomFormatForm({ initial, onSave }: { initial: string; onSave: (f: string) => void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(initial);
  const [hintsAnchor, setHintsAnchor] = useState<RectCords>();
  const trimmed = draft.trim();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (trimmed) onSave(trimmed);
  };

  const toggleHints = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setHintsAnchor((open) => (open ? undefined : rect));
  };

  const hints = (
    <FocusTrap
      focusTrapOptions={{
        initialFocus: false,
        clickOutsideDeactivates: true,
        escapeDeactivates: stopPropagation,
        onDeactivate: () => setHintsAnchor(undefined),
      }}
    >
      <div>
        <FormatHints />
      </div>
    </FocusTrap>
  );

  return (
    <Box as="form" direction="Column" gap="100" onSubmit={submit}>
      <Box gap="200" alignItems="Center">
        <Box grow="Yes">
          <Input
            name="customDateFormatInput"
            aria-label={t('settings.general.dateTime.dateFormat')}
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            variant="Background"
            size="300"
            radii="300"
            autoComplete="off"
            spellCheck={false}
            after={
              <IconButton
                type="button"
                size="300"
                radii="300"
                variant="Background"
                aria-pressed={hintsAnchor !== undefined}
                aria-label={t(`${HINT_PREFIX}.title`)}
                onClick={toggleHints}
              >
                <Icon size="100" src={Icons.Info} />
              </IconButton>
            }
          />
        </Box>
        <Button
          type="submit"
          size="300"
          radii="300"
          variant="Primary"
          fill="Soft"
          disabled={!trimmed || trimmed === initial}
        >
          <Text size="B300">{t('settings.general.dateTime.save')}</Text>
        </Button>
      </Box>
      {trimmed && (
        <Text size="T200" priority="300">
          {dayjs().format(trimmed)}
        </Text>
      )}
      <PopOut anchor={hintsAnchor} position="Bottom" align="End" offset={5} content={hints} />
    </Box>
  );
}

/** The date format of the timeline: a preset, or a custom dayjs format. */
export function DateFormatSetting() {
  const { t } = useTranslation();
  const [format, setFormat] = useSetting(settingsAtom, 'dateFormatString');
  const isPreset = PRESET_FORMATS.includes(format);
  const [customOpen, setCustomOpen] = useState(!isPreset);
  const label = t('settings.general.dateTime.dateFormat');
  const today = dayjs();

  const choices = [
    ...PRESET_FORMATS.map((preset) => ({ value: preset, label: today.format(preset) })),
    { value: CUSTOM, label: t('options.dateFormat.custom') },
  ];

  const choose = (value: string) => {
    if (value === CUSTOM) {
      setCustomOpen(true);
      return;
    }
    setCustomOpen(false);
    setFormat(value);
  };

  return (
    <SettingTile
      title={label}
      after={
        <ChoiceButton
          label={label}
          value={customOpen ? CUSTOM : format}
          choices={choices}
          onChoose={choose}
        />
      }
    >
      {customOpen && <CustomFormatForm initial={isPreset ? '' : format} onSave={setFormat} />}
    </SettingTile>
  );
}
