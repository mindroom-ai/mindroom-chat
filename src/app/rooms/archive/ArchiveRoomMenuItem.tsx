import type { Room } from 'matrix-js-sdk';
import { useTranslation } from 'react-i18next';
import { Box, Spinner, Text, color, type IconSrc } from 'folds';
import { MenuEntry } from '../../ui/MenuEntry';
import { useRoomArchiveAction } from './useRoomArchiveAction';

/**
 * A storage box with its lid: the room goes away into the archive. Drawn on folds' 24-unit grid
 * with its 2-unit stroke.
 */
const ArchiveBoxIcon: IconSrc = () => (
  <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="5" rx="1.5" />
    <path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9" />
    <path d="M10 13h4" />
  </g>
);

type ArchiveRoomMenuItemProps = {
  room: Room;
  /** Closes the menu once the server has the new choice. */
  onClose: () => void;
};

/**
 * "Archive Room" in a room's menu, or "Restore Room" for an archived one. Archiving hides the room
 * from the room lists without leaving it; a write that fails keeps the menu open and says so.
 */
export function ArchiveRoomMenuItem({ room, onClose }: ArchiveRoomMenuItemProps) {
  const { t } = useTranslation();
  const { archived, busy, failed, toggle } = useRoomArchiveAction(room.roomId, onClose);

  return (
    <Box direction="Column" gap="100">
      <MenuEntry
        label={archived ? t('archivedRooms.restore') : t('archivedRooms.archive')}
        icon={ArchiveBoxIcon}
        after={busy ? <Spinner size="100" /> : undefined}
        disabled={busy}
        aria-busy={busy}
        onSelect={() => {
          void toggle();
        }}
      />
      {failed && (
        <Text size="T200" role="alert" style={{ color: color.Critical.Main, paddingInline: 8 }}>
          {t('archivedRooms.failed')}
        </Text>
      )}
    </Box>
  );
}
