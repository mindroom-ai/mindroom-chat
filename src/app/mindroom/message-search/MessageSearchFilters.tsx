import { ChangeEvent, useMemo, useState } from 'react';
import FocusTrap from 'focus-trap-react';
import { useTranslation } from 'react-i18next';
import { KnownMembership, type MatrixClient, type Room } from 'matrix-js-sdk';
import { Box, Button, Icon, Icons, Input, Text, config } from 'folds';
import { Menu, MenuItem } from '../../components/glass/GlassPrimitives';
import { RoomIcon } from '../../components/room-avatar';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { isMindroomEmojiRoom } from '../../utils/room';
import * as css from './MessageSearch.css';
import { matchesEnum } from '../../utils/matchesEnum';

const nameOrder = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/**
 * The rooms a search can be narrowed to, sorted by name: every joined room that holds messages
 * when the page may search them all, else the page's own rooms, plus whatever is already picked.
 */
const pickableRooms = (
  client: MatrixClient,
  scopeRooms: string[],
  everyRoom: boolean,
  picked: string[]
): Room[] => {
  const ids = everyRoom
    ? client
        .getRooms()
        .filter(
          (room) =>
            matchesEnum(room.getMyMembership(), KnownMembership.Join) &&
            !room.isSpaceRoom() &&
            !isMindroomEmojiRoom(room)
        )
        .map((room) => room.roomId)
    : scopeRooms;
  const rooms = new Map<string, Room>();
  [...picked, ...ids].forEach((roomId) => {
    const room = client.getRoom(roomId);
    if (room) rooms.set(roomId, room);
  });
  return [...rooms.values()].sort((a, b) => nameOrder.compare(a.name, b.name));
};

type SearchRoomPickerProps = {
  scopeRooms: string[];
  /** Offer every joined room, not only `scopeRooms`. */
  everyRoom: boolean;
  picked: string[];
  /** An empty list goes back to the page's own scope. */
  onSave(roomIds: string[]): void;
  onDismiss(): void;
};

/**
 * Narrows a message search to rooms of the user's choice: a filterable list of checkable rooms,
 * kept as a draft until Save. Escape or a click outside drops the draft.
 */
export function SearchRoomPicker({
  scopeRooms,
  everyRoom,
  picked,
  onSave,
  onDismiss,
}: SearchRoomPickerProps) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  // A snapshot taken on opening: rooms that arrive while the list is open would move rows.
  const [rooms] = useState(() => pickableRooms(client, scopeRooms, everyRoom, picked));
  const [draft, setDraft] = useState(() => new Set(picked));
  const [query, setQuery] = useState('');
  const needle = query.trim().toLocaleLowerCase();
  const shown = useMemo(
    () => (needle ? rooms.filter((room) => room.name.toLocaleLowerCase().includes(needle)) : rooms),
    [rooms, needle]
  );

  const flip = (roomId: string) =>
    setDraft((current) => {
      const next = new Set(current);
      if (next.has(roomId)) next.delete(roomId);
      else next.add(roomId);
      return next;
    });
  // Saved in list order, so the address does not depend on the order of the clicks.
  const save = () => onSave(rooms.filter((room) => draft.has(room.roomId)).map((r) => r.roomId));

  return (
    <FocusTrap
      focusTrapOptions={{
        onDeactivate: onDismiss,
        clickOutsideDeactivates: true,
        escapeDeactivates: true,
      }}
    >
      <Menu
        className={css.RoomPicker}
        aria-label={t('mindroomUi.message-search.searchFilters.selectRooms')}
      >
        <Box direction="Column" gap="200" className={css.RoomPickerHead}>
          <Text size="L400">{t('mindroomUi.message-search.searchFilters.selectRooms')}</Text>
          <Input
            size="300"
            radii="300"
            variant="Background"
            autoFocus
            before={<Icon size="50" src={Icons.Search} />}
            placeholder={t('mindroomUi.message-search.searchFilters.search')}
            aria-label={t('mindroomUi.message-search.searchFilters.search')}
            value={query}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
          />
        </Box>
        <div className={css.RoomPickerList} role="group">
          {needle && shown.length > 0 && (
            <Text size="T200" priority="300" className={css.RoomPickerNote}>
              {t('mindroomUi.message-search.searchFilters.roomsFor', { query: query.trim() })}
            </Text>
          )}
          {shown.length === 0 && (
            <Text size="T300" priority="300" className={css.RoomPickerNote}>
              {t('mindroomUi.message-search.searchFilters.noMatchFound')}
            </Text>
          )}
          {shown.map((room) => {
            const checked = draft.has(room.roomId);
            return (
              <MenuItem
                key={room.roomId}
                role="menuitemcheckbox"
                aria-checked={checked}
                size="300"
                radii="300"
                fill={checked ? 'Soft' : 'None'}
                variant={checked ? 'Primary' : 'Surface'}
                before={<RoomIcon size="100" joinRule={room.getJoinRule()} />}
                after={checked ? <Icon size="50" src={Icons.Check} /> : undefined}
                onClick={() => flip(room.roomId)}
              >
                <Text as="span" size="T300" truncate className={css.RoomPickerName}>
                  {room.name}
                </Text>
              </MenuItem>
            );
          })}
        </div>
        <Box gap="200" justifyContent="End" style={{ padding: config.space.S200 }}>
          {draft.size > 0 && (
            <Button
              size="300"
              radii="300"
              variant="Secondary"
              fill="None"
              onClick={() => setDraft(new Set())}
            >
              <Text size="B300">{t('mindroomUi.message-search.searchFilters.deselectAll')}</Text>
            </Button>
          )}
          <Button size="300" radii="300" variant="Primary" onClick={save}>
            <Text size="B300">
              {draft.size > 0
                ? t('mindroomUi.message-search.searchFilters.saveCount', { count: draft.size })
                : t('mindroomUi.message-search.searchFilters.save')}
            </Text>
          </Button>
        </Box>
      </Menu>
    </FocusTrap>
  );
}
