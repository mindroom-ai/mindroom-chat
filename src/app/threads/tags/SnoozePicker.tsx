import { useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Text, config, type RectCords } from 'folds';
import { PopOut } from '../../ui/directional';
import { ChoiceMenu } from '../../ui/ChoiceMenu';
import { BottomSheet } from '../../ui/BottomSheet';
import { ActionDialog } from '../../ui/ActionDialog';
import { MenuItem } from '../../ui/glass/GlassPrimitives';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';
import { useAppLanguageCode } from '../../i18n/useAppLanguageCode';
import {
  parseDateTimeLocalValue,
  snoozePresets,
  toDateTimeLocalValue,
  type SnoozePresetId,
} from './snoozePresets';

type SnoozePickerProps = {
  /** Where the desktop menu opens: the thread menu's own anchor. */
  anchor: RectCords;
  /**
   * A time in the future was picked: resolves whether the snooze was written, after which the
   * caller closes the picker. Until then the picker stays; a failed write shows in it.
   */
  onPick: (until: Date) => Promise<boolean>;
  /** Dismissed without a pick. */
  onClose: () => void;
};

const PRESET_LABEL_KEYS = {
  inOneHour: 'threadSnooze.inOneHour',
  inThreeHours: 'threadSnooze.inThreeHours',
  tomorrow: 'threadSnooze.tomorrow',
  nextMonday: 'threadSnooze.nextMonday',
} as const satisfies Record<SnoozePresetId, string>;

const fieldStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  font: 'inherit',
  padding: '0.5rem',
  borderRadius: '0.5rem',
  border: '1px solid currentColor',
  background: 'transparent',
  color: 'inherit',
};

/** The presets as of when the picker opened, each with its label and the time it shows. */
const usePresetChoices = () => {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  return useMemo(() => {
    const format = new Intl.DateTimeFormat(language, {
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    });
    return snoozePresets(new Date()).map(({ id, until }) => ({
      id,
      name: t(PRESET_LABEL_KEYS[id]),
      detail: format.format(until),
    }));
  }, [language, t]);
};

/** A `datetime-local` field and its confirm button, which refuses a time that has passed. */
function CustomTime({
  onPick,
  onCancel,
}: {
  onPick: (until: Date) => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const until = parseDateTimeLocalValue(value);
  const now = Date.now();
  const past = until !== undefined && until.getTime() <= now;

  const submit = (evt: FormEvent<HTMLFormElement>) => {
    evt.preventDefault();
    if (until && until.getTime() > Date.now()) onPick(until);
  };

  return (
    <form onSubmit={submit}>
      <Box direction="Column" gap="300">
        <input
          type="datetime-local"
          aria-label={t('threadSnooze.pickDateTime')}
          style={fieldStyle}
          min={toDateTimeLocalValue(new Date(now))}
          value={value}
          onChange={(evt) => setValue(evt.target.value)}
        />
        <Box justifyContent="End" gap="200">
          {onCancel && (
            <Button type="button" size="300" variant="Secondary" onClick={onCancel}>
              <Text size="B300">{t('threadActions.cancel')}</Text>
            </Button>
          )}
          <Button type="submit" size="300" variant="Primary" disabled={!until || past}>
            <Text size="B300">{past ? t('threadSnooze.pastTime') : t('thread.snooze')}</Text>
          </Button>
        </Box>
      </Box>
    </form>
  );
}

/**
 * Picks when a snooze ends: four presets, or a date and time of one's own. A menu beside the
 * thread menu on desktop, whose last option opens a dialog for the custom time; on phones a
 * sheet with the presets and the custom time together.
 */
export function SnoozePicker({ anchor, onPick, onClose }: SnoozePickerProps) {
  const { t } = useTranslation();
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  const presets = usePresetChoices();
  const [custom, setCustom] = useState(false);
  const [failed, setFailed] = useState(false);
  // The menu's focus trap reports a dismissal when it unmounts, also after a pick or on its way
  // to the custom time dialog; only a real dismissal closes the picker, and only once. A pick
  // that failed to save opens it again for another try.
  const settledRef = useRef(false);
  const leftMenuRef = useRef(false);
  const pick = (until: Date) => {
    if (settledRef.current) return;
    settledRef.current = true;
    setFailed(false);
    void onPick(until).then((written) => {
      if (written) return;
      settledRef.current = false;
      setFailed(true);
    });
  };
  const failure = failed ? (
    <Text role="alert" size="T200" style={{ padding: `0 ${config.space.S200}` }}>
      {t('threadActions.failed')}
    </Text>
  ) : undefined;
  const dismiss = () => {
    if (settledRef.current) return;
    settledRef.current = true;
    onClose();
  };
  // From the time of the pick, so "In 1 hour" counts from then even if the picker stayed open.
  const pickPreset = (id: SnoozePresetId) => {
    const until = snoozePresets(new Date()).find((preset) => preset.id === id)?.until;
    if (until) pick(until);
  };

  if (phone) {
    return (
      <BottomSheet
        title={t('threadSnooze.title')}
        closeLabel={t('threadActions.cancel')}
        requestClose={dismiss}
      >
        <Box direction="Column" gap="100" style={{ padding: config.space.S200 }}>
          {presets.map((preset) => (
            <MenuItem
              key={preset.id}
              size="400"
              radii="300"
              onClick={() => pickPreset(preset.id)}
              after={
                <Text as="span" size="T200" priority="300">
                  {preset.detail}
                </Text>
              }
            >
              <Text size="T300" style={{ flexGrow: 1, textAlign: 'start' }}>
                {preset.name}
              </Text>
            </MenuItem>
          ))}
          <Box
            direction="Column"
            gap="200"
            style={{ padding: `${config.space.S300} ${config.space.S200}` }}
          >
            <Text size="L400">{t('threadSnooze.pickDateTime')}</Text>
            <CustomTime onPick={pick} />
          </Box>
          {failure}
        </Box>
      </BottomSheet>
    );
  }

  if (custom) {
    return (
      <ActionDialog label={t('threadSnooze.title')} onClose={dismiss} busy={false}>
        <Box direction="Column" gap="300">
          <CustomTime onPick={pick} onCancel={dismiss} />
          {failure}
        </Box>
      </ActionDialog>
    );
  }

  const choose = (index: number) => {
    const preset = presets[index];
    if (preset) {
      pickPreset(preset.id);
      return;
    }
    leftMenuRef.current = true;
    setCustom(true);
  };
  const dismissMenu = () => {
    if (!leftMenuRef.current) dismiss();
  };

  return (
    <PopOut
      anchor={anchor}
      offset={4}
      align="End"
      position="Bottom"
      content={
        <ChoiceMenu
          label={t('threadSnooze.title')}
          choices={[
            ...presets.map(({ name, detail }) => ({ name, detail })),
            { name: t('threadSnooze.pickDateTime') },
          ]}
          current={-1}
          onChoose={choose}
          onDismiss={dismissMenu}
          focusFirst
          footer={failure}
        />
      }
    />
  );
}
