import React, { useId } from 'react';
import { Box, Icon, Icons, Line, MenuItem, Text, config } from 'folds';
import { useTranslation } from 'react-i18next';
import { Room } from 'matrix-js-sdk';
import { useRoomFolders } from './RoomFoldersProvider';

export function RoomFolderMenuItems({
  room,
  requestClose,
}: {
  room: Room;
  requestClose: () => void;
}) {
  const { t } = useTranslation();
  const { folders, moveRoom } = useRoomFolders();
  const groupLabelId = useId();
  if (folders.length === 0) return null;

  const currentFolder = folders.find((folder) => folder.roomIds.includes(room.roomId));
  const handleMove = (folderId?: string) => {
    requestClose();
    if (currentFolder?.id === folderId || (!currentFolder && !folderId)) return;
    void moveRoom(room.roomId, folderId).catch(() => undefined);
  };

  return (
    <>
      <Box
        direction="Column"
        gap="100"
        style={{ padding: config.space.S100 }}
        role="group"
        aria-labelledby={groupLabelId}
      >
        <Text
          id={groupLabelId}
          size="L400"
          priority="300"
          style={{ padding: `0 ${config.space.S200}` }}
        >
          {t('nav.moveToRoomFolder')}
        </Text>
        <MenuItem
          onClick={() => handleMove(undefined)}
          size="300"
          after={!currentFolder && <Icon size="100" src={Icons.Check} />}
          radii="300"
          aria-pressed={!currentFolder}
        >
          <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
            {t('nav.noRoomFolder')}
          </Text>
        </MenuItem>
        {folders.map((folder) => (
          <MenuItem
            key={folder.id}
            onClick={() => handleMove(folder.id)}
            size="300"
            after={currentFolder?.id === folder.id && <Icon size="100" src={Icons.Check} />}
            radii="300"
            aria-pressed={currentFolder?.id === folder.id}
          >
            <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
              {folder.name}
            </Text>
          </MenuItem>
        ))}
      </Box>
      <Line variant="Surface" size="300" />
    </>
  );
}
