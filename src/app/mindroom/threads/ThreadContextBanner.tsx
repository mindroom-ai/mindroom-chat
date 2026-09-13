import React, { useCallback, useEffect } from 'react';
import { Box, Icon, IconButton, Icons, Text, Button } from 'folds';
import { useTranslation } from 'react-i18next';
import { IconCalendarEvent } from '@tabler/icons-react';
import { Room } from 'matrix-js-sdk';
import type { MindroomThreadSummaryInfo } from '../messages/threadSummary';
import * as threadIndicatorCss from './ThreadIndicator.css';
import { useThreadHeaderInfo } from './useThreadHeaderInfo';
import { buildThreadHeaderViewModelFromRecord } from './threadHeaderViewModel';
import { buildThreadRecord } from './threadRecord';
import { useThreadRootEvent } from './useThreadRootEvent';
import { useThreadTags } from './useThreadTags';
import { useMutateThreadTags } from './useMutateThreadTags';
import { ThreadTagPill } from './ThreadTagPill';
import { ThreadTagPicker } from './ThreadTagPicker';
import { isConfirmedMatrixEventId } from './threadRouteUtils';
import { getThreadResolverDisplayName } from './threadResolutionAttribution';
import * as css from './ThreadContextBanner.css';

export interface ThreadContextBannerProps {
  room: Room;
  threadId: string;
  summaryInfo?: MindroomThreadSummaryInfo;
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
        <ThreadTagPill key={tag} name={tag} onRemove={canEdit ? () => onRemove(tag) : undefined} />
      ))}
      {overflowCount > 0 && (
        <span className={css.OverflowChip} title={allTags.slice(maxPills).join(', ')}>
          +{overflowCount}
        </span>
      )}
    </>
  );
}

export function ThreadContextBanner({
  room,
  threadId,
  summaryInfo,
  onExitThread,
}: ThreadContextBannerProps) {
  const { t } = useTranslation();
  const rootEventId = useThreadRootEvent(room, threadId);
  const { scheduledTaskCount, nextScheduledTs, cronDescription, scheduledDisplayText } =
    useThreadHeaderInfo(room, threadId);
  const { tags, isResolved, canEdit, availableTags } = useThreadTags(room, rootEventId);
  const { addTag, removeTag, setResolved, updating, error } = useMutateThreadTags(room);
  const threadRootId = rootEventId ?? threadId;
  const mutableThreadRootId = isConfirmedMatrixEventId(rootEventId) ? rootEventId : undefined;
  const threadRootEvent =
    room.getThread(threadRootId)?.rootEvent ?? room.findEventById(threadRootId);
  const headerRecord = buildThreadRecord({
    room,
    threadRootId,
    threadRootEvent,
    summaryInfo,
    threadResolution: {
      isResolved,
      tags,
    },
    scheduledStatus: {
      scheduledTaskCount,
      nextScheduledTs,
      cronDescription,
    },
  });
  const pickerDisabled = !mutableThreadRootId || updating;
  const headerModel = buildThreadHeaderViewModelFromRecord({
    record: headerRecord,
    scheduledDisplayText,
    canEdit: canEdit && !!mutableThreadRootId,
    availableTags,
    pickerDisabled,
  });
  const resolvedByDisplayName = getThreadResolverDisplayName(
    room,
    headerRecord.status.resolvedByUserId
  );
  const resolvedByLabel =
    headerModel.isResolved && resolvedByDisplayName
      ? t('thread.resolvedBy', { name: resolvedByDisplayName })
      : undefined;

  useEffect(() => {
    if (error) {
      console.error('[ThreadContextBanner] Tag mutation failed:', error);
    }
  }, [error]);

  const handleAddTag = useCallback(
    (name: string) => {
      if (!mutableThreadRootId) return;
      addTag(mutableThreadRootId, name);
    },
    [mutableThreadRootId, addTag]
  );

  const handleRemoveTag = useCallback(
    (name: string) => {
      if (!mutableThreadRootId) return;
      removeTag(mutableThreadRootId, name);
    },
    [mutableThreadRootId, removeTag]
  );

  const handleToggleResolve = useCallback(() => {
    if (!mutableThreadRootId) return;
    setResolved(mutableThreadRootId, !headerModel.isResolved);
  }, [mutableThreadRootId, headerModel.isResolved, setResolved]);

  const hasTags = headerModel.displayTags.length > 0;

  return (
    <div className={headerModel.isResolved ? css.BannerResolved : css.Banner}>
      <div className={css.TitleRow}>
        <IconButton size="300" radii="300" onClick={onExitThread}>
          <Icon src={Icons.ArrowLeft} />
        </IconButton>
        <div className={css.TitleColumn}>
          <Box direction="Row" alignItems="Center" gap="200">
            <Text className={css.ViewLabel} size="L400" priority="300">
              {t('thread.view')}
            </Text>
            {/* Desktop: tags inline on title row */}
            {(hasTags || headerModel.canEdit) && (
              <div className={`${css.TagsRow} ${css.DesktopOnlyTags}`}>
                <TagPills
                  tags={headerModel.displayTags}
                  maxPills={DESKTOP_MAX_PILLS}
                  allTags={headerModel.displayTags}
                  canEdit={headerModel.canEdit}
                  onRemove={handleRemoveTag}
                />
                {headerModel.canEdit && (
                  <ThreadTagPicker
                    availableTags={headerModel.availableTags}
                    onAddTag={handleAddTag}
                    disabled={headerModel.pickerDisabled}
                  />
                )}
              </div>
            )}
          </Box>
          {(headerModel.summaryText || headerModel.bannerScheduledText) && (
            <div className={css.SubtitleRow}>
              {headerModel.summaryText && (
                <Text
                  as="span"
                  data-thread-context-summary="true"
                  className={css.SummaryText}
                  size="T300"
                  truncate
                  title={headerModel.summaryText}
                >
                  {headerModel.summaryText}
                </Text>
              )}
              {headerModel.bannerScheduledText && headerModel.scheduledLabel && (
                <Box as="span" className={css.ScheduledWrap} alignItems="Center" gap="100">
                  {headerModel.summaryText && (
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
                    className={`${css.ScheduledIndicator} ${threadIndicatorCss.ThreadScheduledIndicator}`}
                    alignItems="Center"
                    gap="100"
                    role="img"
                    aria-label={headerModel.scheduledLabel}
                    title={headerModel.scheduledLabel}
                  >
                    <IconCalendarEvent
                      size={12}
                      stroke={1.8}
                      className={threadIndicatorCss.ThreadScheduledIcon}
                      aria-hidden="true"
                    />
                    <Text as="span" size="T200" priority="300" truncate>
                      {headerModel.bannerScheduledText}
                    </Text>
                  </Box>
                </Box>
              )}
            </div>
          )}
          {/* Mobile: tags in a dedicated row below subtitle */}
          {(hasTags || headerModel.canEdit) && (
            <div className={css.MobileOnlyTags}>
              <TagPills
                tags={headerModel.displayTags}
                maxPills={MOBILE_MAX_PILLS}
                allTags={headerModel.displayTags}
                canEdit={headerModel.canEdit}
                onRemove={handleRemoveTag}
              />
              {headerModel.canEdit && (
                <ThreadTagPicker
                  availableTags={headerModel.availableTags}
                  onAddTag={handleAddTag}
                  disabled={headerModel.pickerDisabled}
                />
              )}
            </div>
          )}
        </div>
        <div className={css.ResolveChip}>
          <Button
            size="300"
            variant={headerModel.isResolved ? 'Success' : 'Secondary'}
            fill={headerModel.isResolved ? 'Solid' : 'Soft'}
            outlined={!headerModel.isResolved}
            radii="300"
            onClick={handleToggleResolve}
            disabled={!headerModel.canEdit || headerModel.pickerDisabled}
            title={resolvedByLabel}
          >
            <Text size="T200">
              {headerModel.isResolved ? t('thread.resolved') : t('thread.resolve')}
            </Text>
          </Button>
          {resolvedByDisplayName && (
            <Text
              className={css.ResolutionByline}
              data-thread-resolution-byline="true"
              size="T200"
              priority="300"
              truncate
            >
              {t('thread.resolvedByShort', { name: resolvedByDisplayName })}
            </Text>
          )}
        </div>
      </div>
    </div>
  );
}
