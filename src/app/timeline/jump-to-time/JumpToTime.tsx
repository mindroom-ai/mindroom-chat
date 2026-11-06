import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import FocusTrap from 'focus-trap-react';
import classNames from 'classnames';
import { EventType, type Room } from 'matrix-js-sdk';
import {
  Box,
  Button,
  Icon,
  Icons,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Spinner,
  Text,
  color,
  config,
  toRem,
} from 'folds';
import { Chip, Dialog, Header, IconButton } from '../../ui/glass/GlassPrimitives';
import { viewerTrapOptions } from '../../messages/content/viewerFrame';
import { useAlive } from '../../lib/hooks/useAlive';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useRoomNavigate } from '../../navigation/useRoomNavigate';
import { useRoomViewMode } from '../../navigation/useRoomViewMode';
import { useHour24Clock } from '../../preferences/useHour24Clock';
import { localDigits } from '../../lib/localDigits';
import { readableReason } from '../../lib/errorReason';
import { isConfirmedMatrixEventId } from '../../event-store/threads/threadRouteUtils';
import { findEventAtTime, findThreadEventAtTime } from './findEventAtTime';
import * as css from './JumpToTime.css';

type JumpToTimeProps = {
  room: Room;
  /** The open thread, which the jump stays in. */
  threadId?: string;
  requestClose: () => void;
};

/** A local date and time to the minute; `day` may exceed a shorter month and is clamped. */
type Moment = { year: number; month: number; day: number; hour: number; minute: number };

type Preset = 'today' | 'yesterday' | 'beginning';

type Lookup =
  | { kind: 'idle' }
  | { kind: 'looking' }
  | { kind: 'unsupported' }
  | { kind: 'notFound' }
  | { kind: 'failed'; reason: string };

const HEADING_ID = 'jump-to-time-heading';
const dialogWidth = `min(calc(100vw - 2 * ${config.space.S400}), ${toRem(400)})`;
const bodyPadding = `${config.space.S200} ${config.space.S400} ${config.space.S400}`;

const momentOf = (date: Date): Moment => ({
  year: date.getFullYear(),
  month: date.getMonth(),
  day: date.getDate(),
  hour: date.getHours(),
  minute: date.getMinutes(),
});

const lastDayOf = (year: number, month: number): number => new Date(year, month + 1, 0).getDate();

const timestampOf = ({ year, month, day, hour, minute }: Moment): number =>
  new Date(year, month, Math.min(day, lastDayOf(year, month)), hour, minute).getTime();

/** Midnight, `daysBack` days before today. */
const midnight = (daysBack: number): Moment => {
  const date = new Date();
  date.setDate(date.getDate() - daysBack);
  return { ...momentOf(date), hour: 0, minute: 0 };
};

const numbers = (first: number, last: number): number[] =>
  Array.from({ length: last - first + 1 }, (_, offset) => first + offset);

const twoDigits = (value: number): string => String(value).padStart(2, '0');

type PickerProps = {
  label: string;
  value: number;
  options: Array<[value: number, text: string]>;
  onPick: (value: number) => void;
  className?: string;
};

function Picker({ label, value, options, onPick, className }: PickerProps) {
  const { i18n } = useTranslation();
  return (
    <select
      className={classNames(css.Picker, className)}
      aria-label={label}
      value={value}
      onChange={(event) => onPick(Number(event.target.value))}
    >
      {options.map(([optionValue, text]) => (
        <option key={optionValue} value={optionValue}>
          {localDigits(text, i18n.language)}
        </option>
      ))}
    </select>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box direction="Column" gap="100" role="group" aria-label={title}>
      <Text as="span" size="L400">
        {title}
      </Text>
      <Box gap="200" alignItems="Center" wrap="Wrap">
        {children}
      </Box>
    </Box>
  );
}

/**
 * Jump to Time: pick a date and time (or Today, Yesterday, the room's beginning), and the room
 * opens in its Full view at the event the server finds for that time (Matrix spec,
 * `/timestamp_to_event`). A server without that endpoint gets a message instead. From an open
 * thread, the thread stays open and moves to its message at that time (`findThreadEventAtTime`):
 * a time before the thread began shows its first message, one after its newest reply that reply.
 */
export function JumpToTime({ room, threadId, requestClose }: JumpToTimeProps) {
  const { t, i18n } = useTranslation();
  const client = useMatrixClient();
  const viewModes = useRoomViewMode(room.roomId);
  const [hour24Clock] = useHour24Clock();
  const { navigateRoom, navigateRoomThread } = useRoomNavigate();
  const [moment, setMoment] = useState<Moment>(() => midnight(0));
  const mounted = useAlive();
  const [preset, setPreset] = useState<Preset | undefined>('today');
  const [lookup, setLookup] = useState<Lookup>({ kind: 'idle' });
  const looking = lookup.kind === 'looking';

  const createdAt = room.currentState.getStateEvents(EventType.RoomCreate, '')?.getTs();
  const thisYear = new Date().getFullYear();
  const firstYear = Math.min(createdAt ? new Date(createdAt).getFullYear() : thisYear, thisYear);

  const monthNames = useMemo(() => {
    const format = new Intl.DateTimeFormat(i18n.language, { month: 'long' });
    return numbers(0, 11).map((month): [number, string] => [
      month,
      format.format(new Date(2000, month, 1)),
    ]);
  }, [i18n.language]);

  const change = (part: Partial<Moment>) => {
    setPreset(undefined);
    setLookup({ kind: 'idle' });
    setMoment((current) => ({ ...current, ...part }));
  };

  const choosePreset = (chosen: Preset) => {
    setPreset(chosen);
    setLookup({ kind: 'idle' });
    if (chosen === 'beginning') {
      setMoment(createdAt ? momentOf(new Date(createdAt)) : { ...midnight(0), year: firstYear });
      return;
    }
    setMoment(midnight(chosen === 'today' ? 0 : 1));
  };

  const openTimeline = async () => {
    if (looking) return;
    setLookup({ kind: 'looking' });
    // The beginning is the room's first event, even when the creation time has seconds.
    const at = preset === 'beginning' ? createdAt ?? 0 : timestampOf(moment);
    try {
      if (threadId && isConfirmedMatrixEventId(threadId)) {
        const rootTs = (
          room.getThread(threadId)?.rootEvent ?? room.findEventById(threadId)
        )?.getTs();
        const eventId = await findThreadEventAtTime(client, room.roomId, threadId, at, rootTs);
        if (!mounted()) return;
        requestClose();
        // The same thread at another message: its back button keeps the place it returns to.
        const historyState: unknown = window.history.state;
        const userState =
          typeof historyState === 'object' && historyState !== null && 'usr' in historyState
            ? historyState.usr
            : undefined;
        navigateRoomThread(room.roomId, threadId, eventId, { replace: true, state: userState });
        return;
      }
      const found = await findEventAtTime(client, room.roomId, at);
      if (!mounted()) return;
      if (found.kind !== 'found') {
        setLookup({ kind: found.kind });
        return;
      }
      // The Full view shows the room's events in the order they were sent.
      if (viewModes.availableViewModes.includes('classic')) viewModes.setViewMode('classic');
      requestClose();
      navigateRoom(room.roomId, found.eventId);
    } catch (error) {
      if (mounted()) setLookup({ kind: 'failed', reason: readableReason(error) });
    }
  };

  const pm = moment.hour >= 12;
  const hourOptions = hour24Clock
    ? numbers(0, 23).map((hour): [number, string] => [hour, twoDigits(hour)])
    : [12, ...numbers(1, 11)].map((hour): [number, string] => [hour % 12, String(hour)]);
  const pickHour = (picked: number) =>
    change({ hour: hour24Clock ? picked : picked + (pm ? 12 : 0) });

  const presets: Array<[Preset, string]> = [
    ['today', t('featureUi.room.jumpToTime.today')],
    ['yesterday', t('featureUi.room.jumpToTime.yesterday')],
    ['beginning', t('featureUi.room.jumpToTime.beginning')],
  ];
  const problem = {
    idle: undefined,
    looking: undefined,
    unsupported: t('featureUi.room.jumpToTime.unsupported'),
    notFound: t('featureUi.room.jumpToTime.notFound'),
    failed:
      lookup.kind === 'failed'
        ? t('featureUi.room.jumpToTime.failed', { reason: lookup.reason })
        : undefined,
  }[lookup.kind];

  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <FocusTrap focusTrapOptions={viewerTrapOptions(requestClose)}>
          <Dialog
            role="dialog"
            aria-labelledby={HEADING_ID}
            style={{ width: '100%', maxWidth: dialogWidth }}
          >
            <Header
              size="500"
              style={{ paddingInline: `${config.space.S400} ${config.space.S200}` }}
            >
              <Text id={HEADING_ID} size="H4" style={{ flexGrow: 1 }}>
                {t('featureUi.room.jumpToTime.jumpToTime')}
              </Text>
              <IconButton
                aria-label={t('featureUi.room.jumpToTime.close')}
                size="300"
                radii="300"
                onClick={() => requestClose()}
              >
                <Icon src={Icons.Cross} size="200" />
              </IconButton>
            </Header>
            <Box direction="Column" gap="400" style={{ padding: bodyPadding }}>
              <Section title={t('featureUi.room.jumpToTime.preset')}>
                {presets.map(([value, label]) => (
                  <Chip
                    key={value}
                    radii="Pill"
                    variant={preset === value ? 'Primary' : 'SurfaceVariant'}
                    aria-pressed={preset === value}
                    onClick={() => choosePreset(value)}
                  >
                    <Text size="T300">{label}</Text>
                  </Chip>
                ))}
              </Section>
              <Section title={t('featureUi.room.jumpToTime.date')}>
                <Picker
                  label={t('sharedUi.datePicker.day')}
                  value={Math.min(moment.day, lastDayOf(moment.year, moment.month))}
                  options={numbers(1, lastDayOf(moment.year, moment.month)).map((day) => [
                    day,
                    String(day),
                  ])}
                  onPick={(day) => change({ day })}
                />
                <Picker
                  label={t('sharedUi.datePicker.month')}
                  value={moment.month}
                  options={monthNames}
                  onPick={(month) => change({ month })}
                />
                <Picker
                  label={t('sharedUi.datePicker.year')}
                  value={moment.year}
                  options={numbers(firstYear, thisYear).map((year) => [year, String(year)])}
                  onPick={(year) => change({ year })}
                />
              </Section>
              <Section title={t('featureUi.room.jumpToTime.time')}>
                <Picker
                  className={css.TimePicker}
                  label={t('sharedUi.timePicker.hour')}
                  value={hour24Clock ? moment.hour : moment.hour % 12}
                  options={hourOptions}
                  onPick={pickHour}
                />
                <Text as="span" size="T300" aria-hidden>
                  :
                </Text>
                <Picker
                  className={css.TimePicker}
                  label={t('sharedUi.timePicker.minutes')}
                  value={moment.minute}
                  options={numbers(0, 59).map((minute) => [minute, twoDigits(minute)])}
                  onPick={(minute) => change({ minute })}
                />
                {!hour24Clock && (
                  <Picker
                    className={css.TimePicker}
                    label={t('sharedUi.timePicker.period')}
                    value={pm ? 1 : 0}
                    options={[
                      [0, t('sharedUi.timePicker.am')],
                      [1, t('sharedUi.timePicker.pm')],
                    ]}
                    onPick={(period) => change({ hour: (moment.hour % 12) + period * 12 })}
                  />
                )}
              </Section>
              {problem && (
                <Text size="T300" role="alert" style={{ color: color.Critical.Main }}>
                  {problem}
                </Text>
              )}
              <Button
                variant="Primary"
                size="500"
                disabled={looking}
                onClick={() => {
                  void openTimeline();
                }}
                before={looking ? <Spinner variant="Primary" fill="Solid" size="200" /> : undefined}
              >
                <Text size="B500">{t('featureUi.room.jumpToTime.openTimeline')}</Text>
              </Button>
            </Box>
          </Dialog>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}
