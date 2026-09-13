import React, { memo } from 'react';
import { Avatar, Badge, Box, Chip, Icon, Icons, Text } from 'folds';
import { IconCalendarEvent } from '@tabler/icons-react';
import * as threadIndicatorCss from './ThreadIndicator.css';
import { UserAvatar } from '../../components/user-avatar';
import { useRelativeTime } from '../../hooks/useRelativeTime';
import type { CompactThreadCardViewModel } from './types';
import * as css from './CompactRoomView.css';
import { PendingSendIndicator } from '../messages/pendingSendIndicator';

const tagColor = (tagName: string): string => {
  let hash = 0;
  for (let i = 0; i < tagName.length; i++) {
    hash = tagName.charCodeAt(i) + ((hash << 5) - hash);
    hash &= hash;
  }
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue}, 65%, 82%)`;
};

export type CompactThreadCardProps = {
  viewModel: CompactThreadCardViewModel;
  onClick: (threadRootId: string, summaryText?: string) => void;
};

function CompactThreadCardBase({ viewModel, onClick }: CompactThreadCardProps) {
  const {
    id,
    titleText,
    displayTitleText,
    previewText,
    messageCountLabel,
    attentionState,
    attentionStatusText,
    participants,
    tags,
    isResolved,
    isUnread,
    isStreaming,
    hasPendingSend,
    scheduledDisplayText,
    scheduledTaskLabel,
    lastActivityTs,
    lastActivityTitle,
    primarySummaryText,
  } = viewModel;
  const relativeTime = useRelativeTime(lastActivityTs);
  const ariaLabel = [
    `Open thread: ${titleText}`,
    attentionStatusText,
    previewText,
    messageCountLabel,
    isResolved ? 'Resolved thread' : 'Unresolved thread',
    isUnread ? 'Unread messages' : undefined,
    isStreaming ? 'Agent streaming' : undefined,
    hasPendingSend ? 'Message sending' : undefined,
    scheduledTaskLabel,
    relativeTime ? `Last activity ${relativeTime}` : undefined,
  ]
    .filter(Boolean)
    .join('. ');
  const hasMetadata = participants.length > 0 || tags.length > 0 || isStreaming || isUnread;

  return (
    <button
      className={isResolved ? `${css.Card} ${css.CardResolved}` : css.Card}
      type="button"
      onClick={() => onClick(id.threadRootId, primarySummaryText)}
      data-thread-root-id={id.threadRootId}
      aria-label={ariaLabel}
    >
      <Box className={css.TitleRow}>
        <Box className={css.TitleLead}>
          <span
            className={css.AttentionDot({ state: attentionState })}
            data-attention-state={attentionState}
            aria-hidden="true"
          />
          <span className={css.ScreenReaderText}>{`Thread status: ${attentionStatusText}.`}</span>
          <Text className={css.TitleText} size="B300" title={titleText}>
            {displayTitleText}
          </Text>
        </Box>
        {relativeTime && (
          <Text
            className={css.TimeText}
            size="T200"
            priority="300"
            title={lastActivityTitle}
            aria-label={lastActivityTitle ? `Last activity ${lastActivityTitle}` : undefined}
          >
            {relativeTime}
          </Text>
        )}
      </Box>

      <Box className={css.MessageRow}>
        <Box className={css.MessagePreview} alignItems="Center">
          <Text className={css.MessageText} size="T200" priority="300" truncate>
            {previewText}
          </Text>
          {hasPendingSend && <PendingSendIndicator />}
        </Box>
        <Box className={css.Stats}>
          <Badge className={css.StatBadge} variant="Secondary" fill="Soft" radii="Pill">
            <Text as="span" size="T200">
              {messageCountLabel}
            </Text>
          </Badge>
          {scheduledDisplayText && scheduledTaskLabel && (
            <Box
              as="span"
              className={`${css.ScheduledIndicator} ${threadIndicatorCss.ThreadScheduledIndicator}`}
              alignItems="Center"
              gap="100"
              role="img"
              aria-label={scheduledTaskLabel}
              title={scheduledTaskLabel}
            >
              <IconCalendarEvent
                size={12}
                stroke={1.8}
                className={threadIndicatorCss.ThreadScheduledIcon}
                aria-hidden="true"
              />
              <Text as="span" size="T200" priority="300" truncate>
                {scheduledDisplayText}
              </Text>
            </Box>
          )}
        </Box>
      </Box>

      {hasMetadata && (
        <Box className={css.MetadataRow}>
          {participants.length > 0 && (
            <Box className={css.Participants} alignItems="Center">
              {participants.map((participant, index) => (
                <Avatar
                  key={participant.userId}
                  className={`${css.ParticipantAvatar} ${threadIndicatorCss.ThreadParticipant}`}
                  size="200"
                  radii="400"
                  title={participant.displayName}
                  style={
                    index === 0
                      ? { zIndex: participants.length - index }
                      : {
                          marginInlineStart: '-0.375rem',
                          zIndex: participants.length - index,
                        }
                  }
                >
                  <UserAvatar
                    userId={participant.userId}
                    src={participant.avatarUrl}
                    alt={participant.displayName}
                    renderFallback={() => <Icon size="100" src={Icons.User} filled />}
                  />
                </Avatar>
              ))}
            </Box>
          )}
          {tags.map((tagName) => (
            <Box
              key={tagName}
              as="span"
              style={{
                backgroundColor: tagColor(tagName),
                color: '#1a1a1a',
                fontSize: '0.65rem',
                fontWeight: 500,
                padding: '0.1rem 0.4rem',
                borderRadius: '0.5rem',
                whiteSpace: 'nowrap',
                display: 'inline-flex',
                alignItems: 'center',
                flexShrink: 0,
              }}
            >
              {tagName}
            </Box>
          ))}
          {isStreaming && (
            <Chip as="span" className={css.StatusChip} variant="Primary" fill="Soft" radii="Pill">
              <Box as="span" alignItems="Center" gap="100">
                <span className={threadIndicatorCss.ThreadStreamingDot} aria-hidden="true" />
                <Text as="span" size="T200">
                  streaming
                </Text>
              </Box>
            </Chip>
          )}
          {isUnread && (
            <Box as="span" className={css.UnreadWrap} alignItems="Center" gap="100">
              <span
                className={`${threadIndicatorCss.ThreadUnreadDot} ${css.UnreadDot}`}
                role="img"
                aria-label="Unread messages"
              />
              <Text as="span" size="T200" priority="300">
                unread
              </Text>
            </Box>
          )}
        </Box>
      )}
    </button>
  );
}

// Memoized: the compact overview re-renders on every thread-index refresh
// (each streaming edit anywhere in the room); with content-stable view models
// only the cards whose content changed re-render.
export const CompactThreadCard = memo(CompactThreadCardBase);
