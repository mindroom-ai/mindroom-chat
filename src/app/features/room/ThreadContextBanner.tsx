import React, { useCallback, useEffect } from 'react';
import { Box, Icon, IconButton, Icons, Text, Button } from 'folds';
import { IconCalendarEvent } from '@tabler/icons-react';
import { Room } from 'matrix-js-sdk';
import * as replyCss from '../../components/message/Reply.css';
import { useThreadHeaderInfo } from '../../hooks/useThreadHeaderInfo';
import { useThreadRootEvent } from './useThreadRootEvent';
import { useThreadTags } from './useThreadTags';
import { useMutateThreadTags } from './useMutateThreadTags';
import { ThreadTagPill } from './ThreadTagPill';
import { ThreadTagPicker } from './ThreadTagPicker';
import * as css from './ThreadContextBanner.css';

export interface ThreadContextBannerProps {
  room: Room;
  threadId: string;
  summaryText?: string;
  onExitThread: () => void;
}

const DESKTOP_MAX_PILLS = 3;
const MOBILE_MAX_PILLS = 2;

function TagPills({
  tags,
  maxPills,
  allTags,
  canEdit,
  onRemove,
}: {
  tags: string[];
  maxPills: number;
  allTags: string[];
  canEdit: boolean;
  onRemove: (name: string) => void;
}) {
  const visible = tags.slice(0, maxPills);
  const overflowCount = tags.length - visible.length;

  return (
    <>
      {visible.map((tag) => (
        <ThreadTagPill
          key={tag}
          name={tag}
          onRemove={canEdit ? () => onRemove(tag) : undefined}
        />
      ))}
      {overflowCount > 0 && (
        <span
          className={css.OverflowChip}
          title={allTags.slice(maxPills).join(', ')}
        >
          +{overflowCount}
        </span>
      )}
    </>
  );
}

export function ThreadContextBanner({
  room,
  threadId,
  summaryText,
  onExitThread,
}: ThreadContextBannerProps) {
  const rootEventId = useThreadRootEvent(room, threadId);
  const { scheduledTaskCount, nextScheduledTs, scheduledDisplayText } = useThreadHeaderInfo(
    room,
    threadId
  );
  const { displayTags, isResolved, canEdit, availableTags } = useThreadTags(
    room,
    rootEventId
  );
  const { addTag, removeTag, setResolved, updating, error } = useMutateThreadTags(room);

  useEffect(() => {
    if (error) {
      console.error('[ThreadContextBanner] Tag mutation failed:', error);
    }
  }, [error]);

  const handleAddTag = useCallback(
    (name: string) => {
      if (!rootEventId) return;
      addTag(rootEventId, name);
    },
    [rootEventId, addTag]
  );

  const handleRemoveTag = useCallback(
    (name: string) => {
      if (!rootEventId) return;
      removeTag(rootEventId, name);
    },
    [rootEventId, removeTag]
  );

  const handleToggleResolve = useCallback(() => {
    if (!rootEventId) return;
    setResolved(rootEventId, !isResolved);
  }, [rootEventId, isResolved, setResolved]);

  const pickerDisabled = !rootEventId || updating;
  const hasTags = displayTags.length > 0;
  const scheduledLabel =
    scheduledTaskCount > 0
      ? nextScheduledTs === undefined
        ? scheduledDisplayText
        : `${scheduledTaskCount} pending scheduled ${
            scheduledTaskCount === 1 ? 'task' : 'tasks'
          }${scheduledDisplayText ? `, ${scheduledDisplayText}` : ''}`
      : undefined;
  const bannerScheduledText =
    scheduledDisplayText && !summaryText && nextScheduledTs !== undefined
      ? `Next task ${scheduledDisplayText}`
      : scheduledDisplayText && !summaryText && scheduledTaskCount > 0
        ? `${scheduledTaskCount} scheduled ${scheduledTaskCount === 1 ? 'task' : 'tasks'}`
        : scheduledDisplayText;

  return (
    <div className={isResolved ? css.BannerResolved : css.Banner}>
      <div className={css.TitleRow}>
        <IconButton size="300" radii="300" onClick={onExitThread}>
          <Icon src={Icons.ArrowLeft} />
        </IconButton>
        <Box direction="Column" grow="Yes" gap="0">
          <Box direction="Row" alignItems="Center" gap="200">
            <Text size="B400">Thread View</Text>
            {/* Desktop: tags inline on title row */}
            {(hasTags || canEdit) && (
              <div className={`${css.TagsRow} ${css.DesktopOnlyTags}`}>
                <TagPills
                  tags={displayTags}
                  maxPills={DESKTOP_MAX_PILLS}
                  allTags={displayTags}
                  canEdit={canEdit}
                  onRemove={handleRemoveTag}
                />
                {canEdit && (
                  <ThreadTagPicker
                    availableTags={availableTags}
                    onAddTag={handleAddTag}
                    disabled={pickerDisabled}
                  />
                )}
              </div>
            )}
          </Box>
          {(summaryText || bannerScheduledText) && (
            <div className={css.SubtitleRow}>
              {summaryText && (
                <span data-thread-context-summary="true">
                  <Text
                    className={css.SummaryText}
                    size="T200"
                    priority="300"
                    truncate
                    title={summaryText}
                  >
                    {summaryText}
                  </Text>
                </span>
              )}
              {bannerScheduledText && scheduledLabel && (
                <Box as="span" className={css.ScheduledWrap} alignItems="Center" gap="100">
                  {summaryText && (
                    <Text
                      as="span"
                      className={css.MetadataDot}
                      size="T200"
                      priority="300"
                      aria-hidden="true"
                    >
                      ·
                    </Text>
                  )}
                  <Box
                    as="span"
                    className={`${css.ScheduledIndicator} ${replyCss.ThreadScheduledIndicator}`}
                    alignItems="Center"
                    gap="100"
                    role="img"
                    aria-label={scheduledLabel}
                    title={scheduledLabel}
                  >
                    <IconCalendarEvent
                      size={12}
                      stroke={1.8}
                      className={replyCss.ThreadScheduledIcon}
                      aria-hidden="true"
                    />
                    <Text as="span" size="T200" priority="300" truncate>
                      {bannerScheduledText}
                    </Text>
                  </Box>
                </Box>
              )}
            </div>
          )}
          {/* Mobile: tags in a dedicated row below subtitle */}
          {(hasTags || canEdit) && (
            <div className={css.MobileOnlyTags}>
              <TagPills
                tags={displayTags}
                maxPills={MOBILE_MAX_PILLS}
                allTags={displayTags}
                canEdit={canEdit}
                onRemove={handleRemoveTag}
              />
              {canEdit && (
                <ThreadTagPicker
                  availableTags={availableTags}
                  onAddTag={handleAddTag}
                  disabled={pickerDisabled}
                />
              )}
            </div>
          )}
        </Box>
        <div className={css.ResolveChip}>
          <Button
            size="300"
            variant={isResolved ? 'Success' : 'Secondary'}
            fill={isResolved ? 'Solid' : 'Soft'}
            outlined={!isResolved}
            radii="300"
            onClick={handleToggleResolve}
            disabled={!canEdit || pickerDisabled}
          >
            <Text size="T200">{isResolved ? 'Resolved' : 'Resolve'}</Text>
          </Button>
        </div>
      </div>
    </div>
  );
}
