import type { CSSProperties } from 'react';
import { Text } from 'folds';
import { useRelativeTime } from '../../i18n/useRelativeTime';

const activityTimeStyle: CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
  flexShrink: 0,
};

/** Compact relative timestamp mounted only on quiet rows when activity times are shown. */
export function RoomActivityTime({ timestamp }: { timestamp: number }) {
  const time = useRelativeTime(timestamp, 'compact');
  if (!time) return null;
  return (
    <Text as="span" size="T200" priority="300" data-room-activity-time="" style={activityTimeStyle}>
      {time}
    </Text>
  );
}
