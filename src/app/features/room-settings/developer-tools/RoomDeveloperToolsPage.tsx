import React, { useCallback, useEffect, useState } from 'react';
import { Box, Button, Chip, Icon, Icons, Text, config, toRem } from 'folds';
import { useTranslation } from 'react-i18next';
import { EventTimeline, type MatrixEvent, type Room, RoomEvent } from 'matrix-js-sdk';
import { SettingTile } from '../../../components/setting-tile';
import { useStateEventCallback } from '../../../hooks/useStateEventCallback';
import { useForceUpdate } from '../../../hooks/useForceUpdate';
import { copyToClipboard } from '../../../utils/dom';
import { SettingsCard } from '../../settings/SettingsCard';
import { SettingsPageFrame } from '../../settings/SettingsPageFrame';

const TOOLS = 'featureUi.commonSettings.developerTools.developTools';

const JSON_STYLE = {
  margin: 0,
  padding: config.space.S200,
  maxHeight: toRem(320),
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontFamily: 'monospace',
} as const;

/** The room's current state, grouped by event type and sorted, following state changes. */
const useRoomStateByType = (room: Room): Array<[string, MatrixEvent[]]> => {
  const [, refresh] = useForceUpdate();
  const onState = useCallback(
    (event: MatrixEvent) => {
      if (event.getRoomId() === room.roomId) refresh();
    },
    [room.roomId, refresh]
  );
  useStateEventCallback(room.client, onState);
  const events = room.getLiveTimeline().getState(EventTimeline.FORWARDS)?.events;
  if (!events) return [];
  return [...events.entries()]
    .map(([type, byKey]): [string, MatrixEvent[]] => [type, [...byKey.values()]])
    .sort(([a], [b]) => a.localeCompare(b));
};

/** A chip per entry that unfolds its JSON below, one at a time. */
function JsonChips({
  entries,
}: {
  entries: Array<{ id: string; label: string; content: object }>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<string>();
  const shown = entries.find((entry) => entry.id === open);
  return (
    <>
      <Box gap="200" wrap="Wrap">
        {entries.map((entry) => {
          const expanded = entry.id === open;
          return (
            <Chip
              key={entry.id}
              radii="Pill"
              variant={expanded ? 'Primary' : 'Secondary'}
              aria-pressed={expanded}
              aria-label={`${t(expanded ? `${TOOLS}.collapse` : `${TOOLS}.expand`)} ${entry.label}`}
              after={<Icon size="50" src={expanded ? Icons.ChevronTop : Icons.ChevronBottom} />}
              onClick={() => setOpen(expanded ? undefined : entry.id)}
            >
              <Text size="T200">{entry.label}</Text>
            </Chip>
          );
        })}
      </Box>
      {shown && (
        <Text as="pre" size="T200" style={JSON_STYLE}>
          {JSON.stringify(shown.content, null, 2)}
        </Text>
      )}
    </>
  );
}

/** One state event type: its count, and its events by state key. */
function StateTypeTile({ type, events }: { type: string; events: MatrixEvent[] }) {
  return (
    <SettingTile title={type} description={String(events.length)}>
      <JsonChips
        entries={events.map((event) => {
          const stateKey = event.getStateKey() ?? '';
          return {
            id: stateKey,
            label: stateKey === '' ? '""' : stateKey,
            content: event.getEffectiveEvent(),
          };
        })}
      />
    </SettingTile>
  );
}

/** The room's account data of this user, following changes. */
const useRoomAccountData = (room: Room): MatrixEvent[] => {
  const [, refresh] = useForceUpdate();
  useEffect(() => {
    room.on(RoomEvent.AccountData, refresh);
    return () => {
      room.off(RoomEvent.AccountData, refresh);
    };
  }, [room, refresh]);
  return [...room.accountData.values()].sort((a, b) => a.getType().localeCompare(b.getType()));
};

/** Read-only room internals for developers: the room ID, its state and its account data. */
export function RoomDeveloperToolsPage({
  room,
  requestClose,
}: {
  room: Room;
  requestClose: () => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const state = useRoomStateByType(room);
  const accountData = useRoomAccountData(room);
  const total = state.reduce((sum, [, events]) => sum + events.length, 0);

  return (
    <SettingsPageFrame title={t(`${TOOLS}.developerTools`)} requestClose={requestClose}>
      <SettingsCard>
        <SettingTile
          title={t(`${TOOLS}.roomId`)}
          description={room.roomId}
          after={
            <Button
              size="300"
              radii="300"
              variant="Secondary"
              fill="Soft"
              onClick={() => copyToClipboard(room.roomId).then(setCopied)}
            >
              <Text size="B300">
                {copied ? t('featureUi.settings.account.matrixId.copied') : t(`${TOOLS}.copy`)}
              </Text>
            </Button>
          }
        />
      </SettingsCard>
      <Box direction="Column" gap="100">
        <Text size="L400">{t(`${TOOLS}.roomState`)}</Text>
        <SettingsCard>
          <SettingTile
            title={t(`${TOOLS}.stateEventsOfTheRoom`)}
            description={t(`${TOOLS}.total`, { count: total })}
          />
          {state.map(([type, events]) => (
            <StateTypeTile key={type} type={type} events={events} />
          ))}
        </SettingsCard>
      </Box>
      <Box direction="Column" gap="100">
        <Text size="L400">{t(`${TOOLS}.accountData`)}</Text>
        <SettingsCard>
          <SettingTile
            title={t(`${TOOLS}.accountData`)}
            description={t(`${TOOLS}.privatePersonalizationDataStoredWithinRoom`)}
          >
            <Text size="T200" priority="300">
              {t(`${TOOLS}.total`, { count: accountData.length })}
            </Text>
            <JsonChips
              entries={accountData.map((event) => ({
                id: event.getType(),
                label: event.getType(),
                content: event.getContent(),
              }))}
            />
          </SettingTile>
        </SettingsCard>
      </Box>
    </SettingsPageFrame>
  );
}
