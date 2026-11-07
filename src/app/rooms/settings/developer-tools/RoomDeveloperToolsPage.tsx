import { useCallback, useEffect, useState } from 'react';
import { Box, Button, Chip, Icon, Icons, Text, config, toRem } from 'folds';
import { useTranslation } from 'react-i18next';
import { EventTimeline, type MatrixEvent, type Room, RoomEvent } from 'matrix-js-sdk';
import { SettingTile } from '../../../ui/SettingTile';
import { useStateEventCallback } from '../../../matrix/hooks/useStateEventCallback';
import { useForceUpdate } from '../../../lib/hooks/useForceUpdate';
import { copyToClipboard } from '../../../lib/dom';
import { useMatrixClient } from '../../../matrix/hooks/useMatrixClient';
import { type JsonEventDraft, JsonEventEditor, type JsonEventKind } from './JsonEventEditor';
import { SettingsCard } from '../../../ui/settings/SettingsCard';
import { SettingsPageFrame } from '../../../ui/settings/SettingsPageFrame';

const TOOLS = 'featureUi.commonSettings.developerTools.developTools';
const EDITOR = 'featureUi.commonSettings.developerTools.stateEventEditor';

/** What the page's editor is writing, if anything. */
type Editing = {
  kind: JsonEventKind;
  initial?: { type: string; stateKey?: string; content: object };
};

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

type JsonEntry = { id: string; label: string; content: object };

/** A chip per entry that unfolds its JSON below, one at a time, with Edit when it may change. */
function JsonChips({
  entries,
  onEdit,
}: {
  entries: JsonEntry[];
  onEdit?: (entry: JsonEntry) => void;
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
      {shown && onEdit && (
        <Box>
          <Button
            size="300"
            radii="300"
            variant="Secondary"
            fill="Soft"
            onClick={() => onEdit(shown)}
          >
            <Text size="B300">{t(`${EDITOR}.edit`)}</Text>
          </Button>
        </Box>
      )}
    </>
  );
}

/** One state event type: its count, and its events by state key, each editable. */
function StateTypeTile({
  type,
  events,
  onEdit,
}: {
  type: string;
  events: MatrixEvent[];
  onEdit: (editing: Editing) => void;
}) {
  return (
    <SettingTile title={type} description={String(events.length)}>
      <JsonChips
        onEdit={(entry) =>
          onEdit({
            kind: 'state',
            initial: {
              type,
              stateKey: entry.id,
              content:
                events.find((event) => (event.getStateKey() ?? '') === entry.id)?.getContent() ??
                {},
            },
          })
        }
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

/** A small soft button beside a section's title. */
function SideButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button size="300" radii="300" variant="Secondary" fill="Soft" onClick={onClick}>
      <Text size="B300">{label}</Text>
    </Button>
  );
}

/**
 * Room internals for developers: the room ID; a raw message event to compose and send; the room
 * state, each event editable and new ones addable; and this account's room data, editable too.
 * The server checks power levels, and its refusals show in the editor.
 */
export function RoomDeveloperToolsPage({
  room,
  requestClose,
}: {
  room: Room;
  requestClose: () => void;
}) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState<Editing>();
  const state = useRoomStateByType(room);
  const accountData = useRoomAccountData(room);
  const total = state.reduce((sum, [, events]) => sum + events.length, 0);
  const done = () => setEditing(undefined);

  const write = ({ type, stateKey, content }: JsonEventDraft) => {
    if (editing?.kind === 'message') {
      return client.sendEvent(room.roomId, type as never, content as never);
    }
    if (editing?.kind === 'state') {
      return client.sendStateEvent(room.roomId, type as never, content as never, stateKey);
    }
    return client.setRoomAccountData(room.roomId, type as never, content as never);
  };

  const editor = (kind: JsonEventKind) =>
    editing?.kind === kind && (
      <JsonEventEditor
        key={`${editing.initial?.type ?? ''}:${editing.initial?.stateKey ?? ''}`}
        kind={kind}
        initial={editing.initial}
        onSubmit={write}
        onDone={done}
      />
    );

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
              onClick={() => void copyToClipboard(room.roomId).then(setCopied)}
            >
              <Text size="B300">
                {copied ? t('featureUi.settings.account.matrixId.copied') : t(`${TOOLS}.copy`)}
              </Text>
            </Button>
          }
        />
      </SettingsCard>
      <Box direction="Column" gap="100">
        <Text size="L400" data-settings-heading="">
          {t(`${TOOLS}.data`)}
        </Text>
        <SettingsCard>
          <SettingTile
            title={t(`${TOOLS}.newMessageEvent`)}
            description={t(`${TOOLS}.createAndSendANewMessageEvent`)}
            after={
              editing?.kind !== 'message' && (
                <SideButton
                  label={t(`${TOOLS}.compose`)}
                  onClick={() => setEditing({ kind: 'message' })}
                />
              )
            }
          />
          {editor('message')}
        </SettingsCard>
      </Box>
      <Box direction="Column" gap="100">
        <Text size="L400" data-settings-heading="">
          {t(`${TOOLS}.roomState`)}
        </Text>
        <SettingsCard>
          <SettingTile
            title={t(`${TOOLS}.stateEventsOfTheRoom`)}
            description={t(`${TOOLS}.total`, { count: total })}
            after={
              editing?.kind !== 'state' && (
                <SideButton
                  label={t(`${TOOLS}.addNew`)}
                  onClick={() => setEditing({ kind: 'state' })}
                />
              )
            }
          />
          {editor('state')}
          {state.map(([type, events]) => (
            <StateTypeTile key={type} type={type} events={events} onEdit={setEditing} />
          ))}
        </SettingsCard>
      </Box>
      <Box direction="Column" gap="100">
        <Text size="L400" data-settings-heading="">
          {t(`${TOOLS}.accountData`)}
        </Text>
        <SettingsCard>
          <SettingTile
            title={t(`${TOOLS}.accountData`)}
            description={t(`${TOOLS}.privatePersonalizationDataStoredWithinRoom`)}
            after={
              editing?.kind !== 'accountData' && (
                <SideButton
                  label={t(`${TOOLS}.addNew`)}
                  onClick={() => setEditing({ kind: 'accountData' })}
                />
              )
            }
          >
            <Text size="T200" priority="300">
              {t(`${TOOLS}.total`, { count: accountData.length })}
            </Text>
            <JsonChips
              onEdit={(entry) =>
                setEditing({
                  kind: 'accountData',
                  initial: { type: entry.id, content: entry.content },
                })
              }
              entries={accountData.map((event) => ({
                id: event.getType(),
                label: event.getType(),
                content: event.getContent(),
              }))}
            />
          </SettingTile>
          {editor('accountData')}
        </SettingsCard>
      </Box>
    </SettingsPageFrame>
  );
}
