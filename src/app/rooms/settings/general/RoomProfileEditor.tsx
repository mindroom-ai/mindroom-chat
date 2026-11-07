import { type FormEvent, useState } from 'react';
import { Box, Button, Input, Text, TextArea, color } from 'folds';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { SettingTile } from '../../../ui/SettingTile';
import { useMatrixClient } from '../../../matrix/hooks/useMatrixClient';
import { usePowerLevels } from '../../../matrix/hooks/usePowerLevels';
import { useRoomCreators } from '../../../matrix/hooks/useRoomCreators';
import { useRoomName, useRoomTopic } from '../../../matrix/hooks/useRoomMeta';
import { useRoomPermissions } from '../../../matrix/hooks/useRoomPermissions';
import { StateEvent } from '../../../matrix/types/room';
import { revealDirectionControls } from '../../../ui/directional';

const PROFILE = 'featureUi.commonSettings.general.roomProfile';

type SaveState = 'idle' | 'saving' | 'failed';

/**
 * The room's name and topic. Those allowed to change them get an Edit button that turns both into
 * fields; Save sends only what changed.
 */
export function RoomProfileEditor({ room }: { room: Room }) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const me = client.getSafeUserId();
  const name = useRoomName(room);
  const topic = useRoomTopic(room) ?? '';
  const may = useRoomPermissions(useRoomCreators(room), usePowerLevels(room));
  const canName = may.stateEvent(StateEvent.RoomName, me);
  const canTopic = may.stateEvent(StateEvent.RoomTopic, me);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [draftTopic, setDraftTopic] = useState(topic);
  const [saveState, setSaveState] = useState<SaveState>('idle');

  const startEditing = () => {
    setDraftName(name);
    setDraftTopic(topic);
    setSaveState('idle');
    setEditing(true);
  };

  const save = (evt: FormEvent<HTMLFormElement>) => {
    evt.preventDefault();
    const nextName = draftName.trim();
    const writes: Array<Promise<unknown>> = [];
    if (canName && nextName && nextName !== name) {
      writes.push(client.setRoomName(room.roomId, nextName));
    }
    if (canTopic && draftTopic !== topic) writes.push(client.setRoomTopic(room.roomId, draftTopic));
    if (writes.length === 0) {
      setEditing(false);
      return;
    }
    setSaveState('saving');
    Promise.all(writes).then(
      () => {
        setSaveState('idle');
        setEditing(false);
      },
      () => setSaveState('failed')
    );
  };

  if (!editing) {
    return (
      <SettingTile
        // Shown with direction controls as code points; the fields below edit the exact text.
        title={revealDirectionControls(name)}
        description={topic ? revealDirectionControls(topic) : undefined}
        after={
          (canName || canTopic) && (
            <Button size="300" radii="300" variant="Secondary" fill="Soft" onClick={startEditing}>
              <Text size="B300">{t(`${PROFILE}.edit`)}</Text>
            </Button>
          )
        }
      />
    );
  }

  const saving = saveState === 'saving';
  return (
    <Box as="form" direction="Column" gap="300" onSubmit={save}>
      <Box direction="Column" gap="100">
        <Text as="label" htmlFor="room-profile-name" size="L400">
          {t(`${PROFILE}.name`)}
        </Text>
        <Input
          id="room-profile-name"
          value={draftName}
          onChange={(evt) => setDraftName(evt.currentTarget.value)}
          disabled={!canName || saving}
          variant="Background"
          size="400"
          radii="300"
        />
      </Box>
      <Box direction="Column" gap="100">
        <Text as="label" htmlFor="room-profile-topic" size="L400">
          {t(`${PROFILE}.topic`)}
        </Text>
        <TextArea
          id="room-profile-topic"
          value={draftTopic}
          onChange={(evt) => setDraftTopic(evt.currentTarget.value)}
          disabled={!canTopic || saving}
          variant="Background"
          radii="300"
          rows={3}
        />
      </Box>
      {saveState === 'failed' && (
        <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
          {t(
            'featureUi.commonSettings.permissions.permissionGroups.failedToApplyChangesPleaseTryAgain'
          )}
        </Text>
      )}
      <Box gap="200">
        <Button type="submit" size="300" radii="300" variant="Success" disabled={saving}>
          <Text size="B300">{t(`${PROFILE}.save`)}</Text>
        </Button>
        <Button
          type="button"
          size="300"
          radii="300"
          variant="Secondary"
          fill="Soft"
          disabled={saving}
          onClick={() => setEditing(false)}
        >
          <Text size="B300">{t(`${PROFILE}.cancel`)}</Text>
        </Button>
      </Box>
    </Box>
  );
}
