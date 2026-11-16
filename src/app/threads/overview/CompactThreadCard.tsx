import { memo, type ReactNode, type RefObject, useEffect, useRef } from 'react';
import { Avatar, Box, Icon, Icons, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { IconCalendarEvent, IconClock } from '@tabler/icons-react';
import * as threadIndicatorCss from '../../messages/ThreadIndicator.css';
import { UserAvatar } from '../../avatars/UserAvatar';
import { useRelativeTime } from '../../i18n/useRelativeTime';
import { useSnoozedUntilText } from '../tags/useSnoozedUntilText';
import type { CompactThreadCardViewModel } from '../../event-store/threads/types';
import * as css from './CompactRoomView.css';
import { FailedSendIndicator, PendingSendIndicator } from '../../ui/PendingSendIndicator';
import { ThreadStreamingDot } from '../ThreadStreamingDot';
import { ThreadTagPill } from '../tags/ThreadTagPill';
import { ownDirectionBlock } from '../../ui/directional';
import { playsMotion } from '../../ui/listMotion';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';
import { OverflowChip } from '../ThreadContextBanner.css';

export type CompactThreadCardProps = {
  viewModel: CompactThreadCardViewModel;
  onClick: (threadRootId: string, summaryText?: string) => void;
  /**
   * Shown in the card under the thread's summary, with controls of its own, such as a call's row:
   * the card then holds the button that opens the thread, beside it.
   */
  attachment?: ReactNode;
  /**
   * Shown in the metadata row after the thread's tags, inside the button: marks with no control of
   * their own, such as client plugins' thread card badges. Keep the node the same across renders,
   * or the memoized card renders again for it.
   */
  badges?: ReactNode;
};

/** How long ago a thread's last activity may be for its card to show it as just happened. */
const JUST_NOW_MS = 60_000;

type Shown = Pick<CompactThreadCardViewModel, 'lastActivityTs' | 'isStreaming' | 'messageCount'>;

/**
 * Shows that a thread changed while its card was up: a reply that just came, or an agent's run
 * that ended, tints the card once, brings in the new preview and pops a reply count that grew.
 * Activity that only loads (older than a minute) plays nothing, and neither does each part of an
 * answer still being written: the card would glow for as long as the agent writes.
 */
const useShowChange = (cardRef: RefObject<HTMLElement>, now: Shown): void => {
  const { lastActivityTs, isStreaming, messageCount } = now;
  const shownRef = useRef<Shown>(now);
  useEffect(() => {
    const before = shownRef.current;
    shownRef.current = { lastActivityTs, isStreaming, messageCount };
    const card = cardRef.current;
    const justReplied =
      !isStreaming &&
      lastActivityTs !== undefined &&
      lastActivityTs > (before.lastActivityTs ?? 0) &&
      Date.now() - lastActivityTs < JUST_NOW_MS;
    const runEnded = before.isStreaming && !isStreaming;
    if (!card || !(justReplied || runEnded) || !playsMotion(card)) return;
    // The card's own overlay (`Card` in CompactRoomView.css.ts), so nothing repaints the card.
    card.animate([{ opacity: 0.16 }, { opacity: 0 }], {
      duration: 1500,
      easing: 'ease-out',
      pseudoElement: '::after',
    });
    card
      .querySelector('[data-compact-card-preview]')
      ?.animate([{ opacity: 0, translate: '0px 4px' }, {}], {
        duration: 200,
        easing: 'cubic-bezier(0, 0, 0, 1)',
      });
    if (messageCount > before.messageCount) {
      card
        .querySelector('[data-compact-card-reply-count]')
        ?.animate([{ scale: 1 }, { scale: 1.25 }, { scale: 1 }], { duration: 240 });
    }
  }, [cardRef, lastActivityTs, isStreaming, messageCount]);
};

// As many whole tags as the thread banner shows, then a count of the rest.
const DESKTOP_MAX_TAGS = 3;
const MOBILE_MAX_TAGS = 2;

function CompactThreadCardBase({ viewModel, onClick, attachment, badges }: CompactThreadCardProps) {
  const { t } = useTranslation();
  const maxTags = useScreenSizeContext() === ScreenSize.Mobile ? MOBILE_MAX_TAGS : DESKTOP_MAX_TAGS;
  const {
    id,
    titleText,
    displayTitleText,
    previewText,
    messageCount,
    messageCountLabel,
    messageCountText,
    attentionState,
    attentionStatusText,
    participants,
    tags,
    isResolved,
    resolvedByDisplayName,
    isUnread,
    isStreaming,
    hasPendingSend,
    hasFailedSend,
    snoozedUntilTs,
    scheduledDisplayText,
    scheduledTaskLabel,
    lastActivityTs,
    lastActivityTitle,
    primarySummaryText,
  } = viewModel;
  // The card is a button, or a box around one: the same node either way for what plays on it.
  const cardRef = useRef<HTMLButtonElement & HTMLDivElement>(null);
  useShowChange(cardRef, { lastActivityTs, isStreaming, messageCount });
  const relativeTime = useRelativeTime(lastActivityTs, 'compact');
  const snoozedText = useSnoozedUntilText(snoozedUntilTs);
  // A thread nobody has replied to shows no count, as the Threads view shows no chip under it.
  const hasReplies = messageCount > 0;
  const resolvedByLabel =
    isResolved && resolvedByDisplayName
      ? t('thread.resolvedBy', { name: resolvedByDisplayName })
      : undefined;
  const ariaLabel = [
    t('thread.aria.openThread', { title: titleText }),
    attentionStatusText,
    previewText,
    hasReplies ? messageCountLabel : undefined,
    isResolved
      ? resolvedByLabel ?? t('thread.aria.resolvedThread')
      : t('thread.aria.unresolvedThread'),
    isUnread ? t('thread.aria.unreadMessages') : undefined,
    isStreaming ? t('thread.aria.agentStreaming') : undefined,
    hasFailedSend ? t('thread.aria.messageFailed') : undefined,
    hasPendingSend ? t('thread.aria.messageSending') : undefined,
    snoozedText,
    scheduledTaskLabel,
    lastActivityTitle || relativeTime
      ? t('thread.aria.lastActivity', { time: lastActivityTitle || relativeTime })
      : undefined,
  ]
    .filter(Boolean)
    .join('. ');

  // Unread threads carry an accent edge and an accented time rather than a
  // dot, so no card reserves a leading gutter that most of them never use.
  const cardClassName = [
    css.Card,
    isResolved && css.CardResolved,
    snoozedText && css.CardSnoozed,
    isUnread && css.CardUnread,
  ]
    .filter(Boolean)
    .join(' ');

  const card = (
    <button
      ref={attachment ? undefined : cardRef}
      className={attachment ? css.CardButton : cardClassName}
      type="button"
      onClick={() => onClick(id.threadRootId, primarySummaryText)}
      data-thread-root-id={id.threadRootId}
      data-attention-state={attentionState}
      data-thread-unread={isUnread ? 'true' : undefined}
      aria-label={ariaLabel}
    >
      <Box className={css.TitleRow}>
        <Text className={css.TitleText} size="B300" title={titleText} {...ownDirectionBlock}>
          {isResolved && (
            <span className={css.ResolvedBadge} data-compact-card-resolved-badge="true">
              <Icon size="50" src={Icons.Check} aria-hidden="true" />
            </span>
          )}
          {snoozedText && (
            <span className={css.SnoozedBadge}>
              <IconClock size={12} stroke={2.2} aria-hidden="true" />
            </span>
          )}
          {displayTitleText}
        </Text>
        {relativeTime && (
          <Text
            as="span"
            className={isUnread ? `${css.TimeText} ${css.TimeTextUnread}` : css.TimeText}
            size="T200"
            priority="300"
            title={lastActivityTitle}
          >
            {relativeTime}
          </Text>
        )}
      </Box>

      <Box className={css.MessagePreview} alignItems="Center">
        <Text
          className={css.MessageText}
          size="T200"
          priority="300"
          truncate
          data-compact-card-preview="true"
          {...ownDirectionBlock}
        >
          {previewText}
        </Text>
        {hasFailedSend ? <FailedSendIndicator /> : hasPendingSend && <PendingSendIndicator />}
      </Box>

      <Box className={css.MetadataRow} data-compact-card-metadata="true">
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
        {resolvedByLabel && (
          <Text
            as="span"
            className={css.ResolutionByline}
            data-compact-card-resolution-byline="true"
            size="T200"
          >
            <span className={css.ResolutionBylineLabel}>{resolvedByLabel}</span>
          </Text>
        )}
        {tags.slice(0, maxTags).map((tagName) => (
          <ThreadTagPill key={tagName} name={tagName} />
        ))}
        {tags.length > maxTags && (
          <span className={OverflowChip} title={tags.slice(maxTags).join(', ')}>
            +{tags.length - maxTags}
          </span>
        )}
        {badges}
        {isStreaming && (
          <Text as="span" className={css.StreamingStatus} size="T200" priority="300">
            <ThreadStreamingDot aria-hidden="true" />
            {t('mindroomUi.threads.compactThreadCard.streaming')}
          </Text>
        )}
        <span className={css.Stats}>
          {snoozedText && (
            <Text
              as="span"
              className={`${css.ScheduledIndicator} ${css.SnoozedIndicator}`}
              size="T200"
              title={snoozedText}
              truncate
              data-thread-snoozed="true"
            >
              {snoozedText}
            </Text>
          )}
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
          {hasReplies && (
            <Text
              as="span"
              className={css.ReplyCount}
              size="T200"
              priority="300"
              title={messageCountLabel}
              data-compact-card-reply-count="true"
            >
              <Icon size="50" src={Icons.Thread} aria-hidden="true" />
              {messageCountText}
            </Text>
          )}
        </span>
      </Box>
    </button>
  );
  if (!attachment) return card;
  return (
    <div ref={cardRef} className={cardClassName}>
      {card}
      {attachment}
    </div>
  );
}

// Memoized: the compact overview re-renders on every thread-index refresh
// (each streaming edit anywhere in the room); with content-stable view models
// only the cards whose content changed re-render.
export const CompactThreadCard = memo(CompactThreadCardBase);
