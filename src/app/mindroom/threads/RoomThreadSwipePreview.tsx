import React from 'react';
import classNames from 'classnames';
import { Text } from 'folds';
import * as css from './MindroomRoomViewSwipe.css';

export type RoomThreadSwipePreviewDirection = 'left' | 'right';

export type RoomThreadSwipePreviewProps = {
  direction: RoomThreadSwipePreviewDirection;
  roomName?: string;
  targetLabel?: string;
  targetThreadId?: string;
};

const getInitial = (value: string | undefined): string => {
  const trimmed = value?.trim();
  return trimmed ? trimmed[0].toUpperCase() : '#';
};

export function RoomThreadSwipePreview({
  direction,
  roomName,
  targetLabel,
  targetThreadId,
}: RoomThreadSwipePreviewProps) {
  const title = direction === 'left' ? roomName ?? 'Room overview' : targetLabel ?? 'Thread';
  const subtitle =
    direction === 'left'
      ? targetLabel ?? 'Overview'
      : targetThreadId
      ? `Last exited thread ${targetThreadId}`
      : 'Last exited thread';

  return (
    <aside
      aria-hidden="true"
      className={css.PreviewChrome}
      data-room-thread-swipe-preview="true"
      {...{ inert: '' }}
    >
      <div className={css.PreviewHeader}>
        <div className={css.PreviewAvatar} aria-hidden="true">
          {getInitial(title)}
        </div>
        <div className={css.PreviewTitleColumn}>
          <Text size="H4" truncate>
            {title}
          </Text>
          <Text size="T200" priority="300" truncate>
            {subtitle}
          </Text>
        </div>
      </div>
      <div className={css.PreviewBody}>
        <div className={classNames(css.PreviewLine, css.PreviewLineLong)} />
        <div className={classNames(css.PreviewLine, css.PreviewLineMedium)} />
        <div className={classNames(css.PreviewLine, css.PreviewLineShort)} />
      </div>
    </aside>
  );
}
