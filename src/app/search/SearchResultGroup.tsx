import { useTranslation } from 'react-i18next';
import { Box, Chip, Text, config } from 'folds';
import { SequenceCard } from '../ui/sequence-card';
import { useRelativeTime } from '../i18n/useRelativeTime';
import { getMemberDisplayName } from '../matrix/room';
import { getMxIdLocalPart } from '../matrix/matrix';
import { getSearchResultOpenTarget, type SearchResultOpenTarget } from './searchResultOpenTarget';
import { MindroomSearchResultBody, type SearchResultBodyProps } from './SearchResultBody';
import type { ResultItem } from './useMessageSearch';

function SearchResultTime({ ts }: { ts: number }) {
  const relative = useRelativeTime(ts);
  return (
    <Text as="time" size="T200" priority="300" dateTime={new Date(ts).toISOString()}>
      {relative}
    </Text>
  );
}

type SearchResultItemProps = SearchResultBodyProps & {
  onOpen: (roomId: string, target: SearchResultOpenTarget) => void;
};

/** One hit: who sent it, when, its body, and a way to jump to it. */
export function SearchResultItem({ onOpen, ...props }: SearchResultItemProps) {
  const { t } = useTranslation();
  const { room, item } = props;
  const { event } = item;
  const sender =
    getMemberDisplayName(room, event.sender) ?? getMxIdLocalPart(event.sender) ?? event.sender;
  const target = getSearchResultOpenTarget(event);

  return (
    <SequenceCard
      as="article"
      direction="Column"
      gap="300"
      style={{ padding: `${config.space.S300} ${config.space.S400}` }}
    >
      <Box gap="200" alignItems="Center" style={{ minWidth: 0 }}>
        <Text as="span" size="T300" truncate style={{ fontWeight: 600, minWidth: 0 }}>
          {sender}
        </Text>
        <SearchResultTime ts={event.origin_server_ts} />
        <Box grow="Yes" />
        <Chip
          variant="Secondary"
          radii="400"
          onClick={() => onOpen(room.roomId, target)}
          data-event-id={target.mainEventId}
          data-thread-root-id={target.threadRootId}
        >
          <Text size="B300">{t('mindroomUi.message-search.searchResultGroup.open')}</Text>
        </Chip>
      </Box>
      <Box direction="Column" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
        <MindroomSearchResultBody {...props} />
      </Box>
    </SequenceCard>
  );
}

type SearchResultGroupProps = Omit<SearchResultBodyProps, 'item'> & {
  /** The room's hits, in the order the server ranked them. */
  items: ResultItem[];
  onOpen: (roomId: string, target: SearchResultOpenTarget) => void;
};

/** A room's hits under its name. */
export function SearchResultGroup({ room, items, ...rest }: SearchResultGroupProps) {
  return (
    <Box direction="Column" gap="200">
      <Text size="H5" truncate>
        {room.name}
      </Text>
      {items.map((item) => (
        <SearchResultItem key={item.event.event_id} room={room} item={item} {...rest} />
      ))}
    </Box>
  );
}
