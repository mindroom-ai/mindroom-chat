import React, { useMemo, useState } from 'react';
import { Badge, Box, Chip, Icon, Icons, Spinner, Text, color } from 'folds';
import { MatrixEvent, MsgType, Room, Thread } from 'matrix-js-sdk';
import classNames from 'classnames';
import { ThreadIndicator, Time } from '../../components/message';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { getMemberDisplayName, trimReplyFromBody } from '../../utils/room';
import { getMxIdLocalPart } from '../../utils/matrix';
import { buildThreadParticipantMap } from './threadUtils';
import { useRoomThreadList } from './useRoomThreadList';
import { getThreadLastActivityTs } from './roomThreadList';
import { useRoomThreadResolutionMap, useToggleThreadResolution } from './useRoomThreadResolution';
import * as css from './RoomThreadOverview.css';

type ThreadFilter = 'unresolved' | 'resolved' | 'all';

type ThreadOverviewEntry = {
  thread: Thread;
  isResolved: boolean;
  lastActivityTs: number;
  preview: string;
  participantIds: string[];
  replyCount: number;
  senderLabel: string;
  isPending: boolean;
};

const getEditedContent = (event: MatrixEvent): Record<string, unknown> => {
  const replacingEvent = event.replacingEvent?.();
  const newContent = replacingEvent?.getContent()['m.new_content'];
  if (newContent && typeof newContent === 'object') {
    return newContent as Record<string, unknown>;
  }

  return event.getContent<Record<string, unknown>>();
};

const getThreadPreview = (rootEvent?: MatrixEvent): string => {
  if (!rootEvent) return 'Thread root is unavailable.';
  if (rootEvent.isRedacted()) return 'Message was deleted.';

  const content = getEditedContent(rootEvent);
  const body = typeof content.body === 'string' ? trimReplyFromBody(content.body) : undefined;
  if (content.msgtype === 'm.bad.encrypted') return 'Unable to decrypt message.';
  if (rootEvent.getType() === 'm.sticker') return body ? `Sticker: ${body}` : 'Sticker';

  switch (content.msgtype) {
    case MsgType.Text:
    case MsgType.Emote:
    case MsgType.Notice:
      return body || 'Text message';
    case MsgType.Image:
      return body ? `Image: ${body}` : 'Image';
    case MsgType.Video:
      return body ? `Video: ${body}` : 'Video';
    case MsgType.Audio:
      return body ? `Audio: ${body}` : 'Audio';
    case MsgType.File:
      return body ? `File: ${body}` : 'File';
    default:
      return body || 'Unsupported message';
  }
};

const getThreadParticipantIds = (thread: Thread): string[] =>
  buildThreadParticipantMap(thread.events).get(thread.id) ?? [];

const getThreadSenderLabel = (room: Room, rootEvent?: MatrixEvent): string => {
  const senderId = rootEvent?.getSender();
  if (!senderId) return 'Unknown user';

  return getMemberDisplayName(room, senderId) ?? getMxIdLocalPart(senderId) ?? senderId;
};

const matchesFilter = (entry: ThreadOverviewEntry, filter: ThreadFilter): boolean => {
  if (filter === 'all') return true;
  return filter === 'resolved' ? entry.isResolved : !entry.isResolved;
};

const sortEntries = (
  threadA: ThreadOverviewEntry,
  threadB: ThreadOverviewEntry,
  filter: ThreadFilter
) => {
  if (filter === 'all' && threadA.isResolved !== threadB.isResolved) {
    return Number(threadA.isResolved) - Number(threadB.isResolved);
  }

  return threadB.lastActivityTs - threadA.lastActivityTs;
};

const formatThreadCount = (count: number, fullyLoaded: boolean): string => {
  if (!fullyLoaded && count === 0) {
    return '-';
  }

  return fullyLoaded ? `${count}` : `${count}+`;
};

export function RoomThreadOverview({
  room,
  hour24Clock,
  dateFormatString,
}: {
  room: Room;
  hour24Clock: boolean;
  dateFormatString: string;
}) {
  const { navigateRoomThread } = useRoomNavigate();
  const { threads, loading, fullyLoaded, error, retry } = useRoomThreadList(room);
  const resolutionMap = useRoomThreadResolutionMap(room);
  const { canToggle, setResolved, updating, error: toggleError } = useToggleThreadResolution(room);
  const [filter, setFilter] = useState<ThreadFilter>('unresolved');
  const [lastToggledThreadId, setLastToggledThreadId] = useState<string>();

  const entries = useMemo(
    () =>
      threads.map((thread) => {
        const resolutionState = resolutionMap.get(thread.id);

        return {
          thread,
          isResolved: resolutionState?.isResolved ?? false,
          lastActivityTs: getThreadLastActivityTs(thread),
          preview: getThreadPreview(thread.rootEvent),
          participantIds: getThreadParticipantIds(thread),
          replyCount: thread.length,
          senderLabel: getThreadSenderLabel(room, thread.rootEvent),
          isPending: resolutionState?.isPending ?? false,
        };
      }),
    [room, resolutionMap, threads]
  );

  const counts = useMemo(() => {
    const resolved = entries.filter((entry) => entry.isResolved).length;
    const unresolved = entries.length - resolved;

    return {
      all: entries.length,
      resolved,
      unresolved,
    };
  }, [entries]);

  const filteredEntries = useMemo(
    () =>
      entries
        .filter((entry) => matchesFilter(entry, filter))
        .sort((a, b) => sortEntries(a, b, filter)),
    [entries, filter]
  );

  const countLabels = useMemo(
    () => ({
      all: formatThreadCount(counts.all, fullyLoaded),
      resolved: formatThreadCount(counts.resolved, fullyLoaded),
      unresolved: formatThreadCount(counts.unresolved, fullyLoaded),
    }),
    [counts, fullyLoaded]
  );

  const summaryText = useMemo(() => {
    if (error) {
      return 'Showing loaded threads only.';
    }

    if (fullyLoaded) {
      return 'Unresolved threads stay surfaced here.';
    }

    return counts.all === 0 ? 'Loading room threads.' : 'Loading older thread pages.';
  }, [counts.all, error, fullyLoaded]);

  const emptyMessage =
    error && counts.all === 0
      ? 'Unable to load threads right now.'
      : !fullyLoaded
      ? counts.all === 0
        ? 'Loading threads.'
        : 'No loaded threads match this filter yet.'
      : counts.all === 0
      ? 'No threads yet.'
      : filter === 'resolved'
      ? 'No resolved threads yet.'
      : filter === 'all'
      ? 'No threads match this filter.'
      : 'No unresolved threads.';

  return (
    <Box className={css.Overview} direction="Column" gap="200" data-room-thread-overview="true">
      <Box
        direction="Row"
        gap="200"
        style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}
      >
        <Box
          direction="Row"
          gap="200"
          alignItems="Center"
          style={{ minWidth: 0, flexGrow: 1, flexWrap: 'wrap' }}
        >
          <Text size="B300">Threads</Text>
          <Text size="T200" priority="300" truncate>
            {summaryText}
          </Text>
        </Box>

        <Box className={css.FilterRow}>
          <Chip
            variant={filter === 'unresolved' ? 'Primary' : 'SurfaceVariant'}
            radii="Pill"
            outlined={filter !== 'unresolved'}
            aria-pressed={filter === 'unresolved'}
            aria-label={`Show unresolved threads (${countLabels.unresolved})`}
            onClick={() => setFilter('unresolved')}
          >
            <Text size="T200">{`Unresolved (${countLabels.unresolved})`}</Text>
          </Chip>
          <Chip
            variant={filter === 'resolved' ? 'Success' : 'SurfaceVariant'}
            radii="Pill"
            outlined={filter !== 'resolved'}
            aria-pressed={filter === 'resolved'}
            aria-label={`Show resolved threads (${countLabels.resolved})`}
            onClick={() => setFilter('resolved')}
          >
            <Text size="T200">{`Resolved (${countLabels.resolved})`}</Text>
          </Chip>
          <Chip
            variant={filter === 'all' ? 'Primary' : 'SurfaceVariant'}
            radii="Pill"
            outlined={filter !== 'all'}
            aria-pressed={filter === 'all'}
            aria-label={`Show all threads (${countLabels.all})`}
            onClick={() => setFilter('all')}
          >
            <Text size="T200">{`All (${countLabels.all})`}</Text>
          </Chip>
        </Box>
      </Box>

      {error && (
        <Box alignItems="Center" gap="200" style={{ flexWrap: 'wrap' }}>
          <Text size="T200" style={{ color: color.Critical.Main }}>
            {error.message}
          </Text>
          <Chip
            variant="SurfaceVariant"
            radii="Pill"
            outlined
            aria-label="Retry loading room threads"
            onClick={retry}
          >
            <Text size="T200">Retry</Text>
          </Chip>
        </Box>
      )}

      {loading && counts.all === 0 ? (
        <Chip
          variant="SurfaceVariant"
          radii="Pill"
          outlined
          before={<Spinner variant="Secondary" fill="Soft" size="100" />}
        >
          <Text size="T200">Loading threads</Text>
        </Chip>
      ) : filteredEntries.length === 0 ? (
        <Text size="T300" priority="300">
          {emptyMessage}
        </Text>
      ) : (
        <Box className={css.ThreadList}>
          {filteredEntries.map((entry) => {
            const buttonLabel = entry.isResolved ? 'Unresolve' : 'Resolve';
            const buttonVariant = entry.isResolved ? 'Secondary' : 'Success';

            return (
              <Box
                key={entry.thread.id}
                className={classNames(css.ThreadRow, entry.isResolved && css.ThreadRowResolved)}
                direction="Column"
                gap="200"
              >
                <Box
                  direction="Row"
                  gap="200"
                  style={{
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                  }}
                >
                  <Box direction="Column" gap="100" style={{ minWidth: 0, flexGrow: 1 }}>
                    <Box alignItems="Center" gap="200" style={{ flexWrap: 'wrap' }}>
                      <Text size="T200" truncate>
                        <b>{entry.senderLabel}</b>
                      </Text>
                      {entry.isResolved && (
                        <Badge as="span" variant="Success" fill="Soft" radii="Pill" outlined>
                          <Text size="T200">Resolved</Text>
                        </Badge>
                      )}
                    </Box>
                    {entry.lastActivityTs > 0 && (
                      <Time
                        ts={entry.lastActivityTs}
                        hour24Clock={hour24Clock}
                        dateFormatString={dateFormatString}
                      />
                    )}
                  </Box>

                  <Box className={css.ActionRow}>
                    <Chip
                      variant="SurfaceVariant"
                      radii="Pill"
                      outlined
                      aria-label={`Open thread ${entry.thread.id}`}
                      onClick={() => navigateRoomThread(room.roomId, entry.thread.id)}
                    >
                      <Text size="T200">Open</Text>
                    </Chip>
                    <Chip
                      variant={buttonVariant}
                      radii="Pill"
                      outlined={buttonVariant !== 'Success'}
                      disabled={!canToggle || updating || entry.isPending}
                      aria-label={`${buttonLabel} thread ${entry.thread.id}`}
                      before={
                        entry.isPending ? (
                          <Spinner
                            size="100"
                            variant={buttonVariant}
                            fill={buttonVariant === 'Success' ? 'Solid' : 'Soft'}
                          />
                        ) : (
                          <Icon size="50" src={entry.isResolved ? Icons.CheckTwice : Icons.Check} />
                        )
                      }
                      onClick={() => {
                        setLastToggledThreadId(entry.thread.id);
                        setResolved(entry.thread.id, !entry.isResolved);
                      }}
                    >
                      <Text size="T200">{buttonLabel}</Text>
                    </Chip>
                    {toggleError && lastToggledThreadId === entry.thread.id && (
                      <Text size="T200" style={{ color: color.Critical.Main }}>
                        {toggleError.message}
                      </Text>
                    )}
                  </Box>
                </Box>

                <Text size="T200" className={css.ThreadPreview}>
                  {entry.preview}
                </Text>

                <ThreadIndicator
                  room={room}
                  threadReplyCount={entry.replyCount}
                  threadParticipantIds={entry.participantIds}
                  isResolved={entry.isResolved}
                />
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
