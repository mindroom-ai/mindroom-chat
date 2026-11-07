import React, { useMemo, useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  Checkbox,
  Icon,
  Icons,
  Input,
  Spinner,
  Text,
  color,
  config,
} from 'folds';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { RoomAvatar, RoomIcon } from '../avatars/RoomAvatar';
import { SequenceCard } from '../ui/SequenceCard';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../matrix/hooks/useMediaAuthentication';
import { useAlive } from '../lib/hooks/useAlive';
import { mDirectAtom } from '../matrix/state/mDirectList';
import { allRoomsAtom } from '../matrix/state/roomList';
import { getSpaceChildIds, roomToParentsAtom } from '../matrix/state/roomToParents';
import { getAncestorSpaceIds } from '../matrix/state/spaceAncestors';
import { getRoomAvatarUrl, isEmojiRoom } from '../matrix/room';
import { nameInitials } from '../lib/common';
import { compareNames } from '../lib/nameOrder';
import { CreateDialogFrame } from '../ui/CreateDialogFrame';
import { addSpaceChild } from './lobby/spaceChildren';
import { revealDirectionControls } from '../ui/directional';

/** Which of the user's joined rooms the picker lists. */
type AddExistingKind = 'rooms' | 'spaces';

type AddExistingModalProps = {
  kind: AddExistingKind;
  /** The space the picked entries are added to. */
  into: string;
  requestClose: () => void;
};

/** Joined rooms (or spaces) that can still become children of `parent`, by name. */
const useCandidates = (client: MatrixClient, parent: Room | null, spaces: boolean): Room[] => {
  const joined = useAtomValue(allRoomsAtom);
  const directs = useAtomValue(mDirectAtom);
  const roomToParents = useAtomValue(roomToParentsAtom);
  return useMemo(() => {
    if (!parent) return [];
    const taken = new Set(getSpaceChildIds(parent));
    // Adding a space that `parent` sits in, at any depth, below it would make a loop.
    const above = new Set(getAncestorSpaceIds(roomToParents, parent.roomId));
    return joined
      .map((roomId) => client.getRoom(roomId))
      .filter((room): room is Room => {
        if (!room || room.roomId === parent.roomId || taken.has(room.roomId)) return false;
        if (room.isSpaceRoom() !== spaces) return false;
        if (spaces) return !above.has(room.roomId);
        return !directs.has(room.roomId) && !isEmojiRoom(room);
      })
      .sort((a, b) => compareNames(a.name, b.name));
  }, [client, parent, spaces, joined, directs, roomToParents]);
};

type CandidateRowProps = { room: Room; chosen: boolean; onToggle: () => void };

function CandidateRow({ room, chosen, onToggle }: CandidateRowProps) {
  const client = useMatrixClient();
  const authenticated = useMediaAuthentication();
  const space = room.isSpaceRoom();
  return (
    <Box
      as="label"
      alignItems="Center"
      gap="300"
      style={{ padding: `${config.space.S200} ${config.space.S300}`, cursor: 'pointer' }}
    >
      <Avatar size="300" radii={space ? '300' : '400'}>
        <RoomAvatar
          roomId={room.roomId}
          src={getRoomAvatarUrl(client, room, 96, authenticated)}
          alt={room.name}
          renderFallback={() =>
            space ? (
              <Text size="H6">{nameInitials(room.name)}</Text>
            ) : (
              <RoomIcon size="200" joinRule={room.getJoinRule()} />
            )
          }
        />
      </Avatar>
      <Text size="T300" truncate style={{ flexGrow: 1 }}>
        {revealDirectionControls(room.name)}
      </Text>
      <Checkbox
        variant="Primary"
        aria-label={revealDirectionControls(room.name)}
        checked={chosen}
        // folds leaves onChange out of its Checkbox type; the change event toggles the choice.
        readOnly
        onClick={onToggle}
      />
    </Box>
  );
}

/**
 * Picks joined rooms, or joined spaces, to add to a space. Rooms already in it, direct chats,
 * and spaces the parent sits in (which would loop) are left out. Nothing changes until Apply.
 */
export function AddExistingModal({ kind, into, requestClose }: AddExistingModalProps) {
  const space = kind === 'spaces';
  const { t } = useTranslation();
  const client = useMatrixClient();
  const alive = useAlive();
  const parent = client.getRoom(into);
  const candidates = useCandidates(client, parent, space);
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set());
  const [applying, setApplying] = useState(false);
  const [failed, setFailed] = useState(false);

  const needle = query.trim().toLocaleLowerCase();
  const shown = needle
    ? candidates.filter((room) => room.name.toLocaleLowerCase().includes(needle))
    : candidates;

  const toggle = (roomId: string) =>
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(roomId)) next.delete(roomId);
      else next.add(roomId);
      return next;
    });

  const apply = async () => {
    if (!parent || applying) return;
    setApplying(true);
    setFailed(false);
    const outcomes = await Promise.allSettled(
      [...chosen].map((roomId) => addSpaceChild(client, parent, roomId))
    );
    if (!alive()) return;
    setApplying(false);
    if (outcomes.some((outcome) => outcome.status === 'rejected')) setFailed(true);
    else requestClose();
  };

  const emptyTitle = space
    ? t('featureUi.addExisting.noSpaces')
    : t('featureUi.addExisting.noRooms');
  const emptyText = space
    ? t('featureUi.addExisting.noSpacesDescription')
    : t('featureUi.addExisting.noRoomsDescription');

  let list: React.ReactNode;
  if (candidates.length === 0) {
    list = (
      <Box direction="Column" alignItems="Center" gap="100" style={{ padding: config.space.S700 }}>
        <Text size="H5">{emptyTitle}</Text>
        <Text size="T300" priority="300" align="Center">
          {emptyText}
        </Text>
      </Box>
    );
  } else if (shown.length === 0) {
    list = (
      <Box direction="Column" alignItems="Center" gap="100" style={{ padding: config.space.S700 }}>
        <Text size="H5">{t('featureUi.addExisting.noMatchFound')}</Text>
        <Text size="T300" priority="300" align="Center">
          {t('featureUi.addExisting.noMatchForQuery', { query: query.trim() })}
        </Text>
      </Box>
    );
  } else {
    list = (
      <SequenceCard variant="SurfaceVariant" direction="Column" gap="0">
        {shown.map((room) => (
          <CandidateRow
            key={room.roomId}
            room={room}
            chosen={chosen.has(room.roomId)}
            onToggle={() => toggle(room.roomId)}
          />
        ))}
      </SequenceCard>
    );
  }

  const applyBar =
    chosen.size > 0 ? (
      <Box
        alignItems="Center"
        gap="300"
        wrap="Wrap"
        style={{
          padding: `${config.space.S300} ${config.space.S400}`,
          borderTop: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
        }}
      >
        <Box grow="Yes" direction="Column" style={{ minWidth: 0 }}>
          {failed ? (
            <Text size="T300" role="alert" style={{ color: color.Critical.Main }}>
              {t('featureUi.addExisting.failedToApplyChangesPleaseTryAgain')}
            </Text>
          ) : (
            <Text size="T300">
              {t('featureUi.addExisting.applyWhenReadySelected', { count: chosen.size })}
            </Text>
          )}
        </Box>
        <Button
          size="300"
          radii="300"
          variant="Secondary"
          fill="Soft"
          disabled={applying}
          onClick={() => {
            setChosen(new Set());
            setFailed(false);
          }}
        >
          <Text size="B300">{t('featureUi.addExisting.reset')}</Text>
        </Button>
        <Button
          size="300"
          radii="300"
          variant="Primary"
          disabled={applying}
          before={applying ? <Spinner variant="Primary" fill="Solid" size="100" /> : undefined}
          onClick={() => void apply()}
        >
          <Text size="B300">{t('featureUi.addExisting.applyChanges')}</Text>
        </Button>
      </Box>
    ) : null;

  return (
    <CreateDialogFrame
      title={t('featureUi.addExisting.addExisting')}
      requestClose={requestClose}
      footer={applyBar}
    >
      <Box direction="Column" gap="400">
        <Input
          variant="SurfaceVariant"
          size="400"
          radii="400"
          value={query}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
          placeholder={t('featureUi.addExisting.search')}
          aria-label={t('featureUi.addExisting.search')}
          before={<Icon size="200" src={Icons.Search} />}
          autoFocus
        />
        {list}
      </Box>
    </CreateDialogFrame>
  );
}
