import type { Room } from 'matrix-js-sdk';
import { Icon, Icons, Text } from 'folds';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Chip, IconButton } from '../../components/glass/GlassPrimitives';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { IconTooltip } from '../tooltip/IconTooltip';
import * as css from './backgroundJobsBar.css';
import { jobsInView } from './backgroundJobsContract';
import { type BackgroundJobsBarItem, presentBackgroundJobs } from './backgroundJobsPresentation';
import { type BackgroundJobCancelRequest, cancelBackgroundJob } from './cancelBackgroundJob';
import { forgetCancel, keepCancelsOf, markCancelSent, useSentCancels } from './sentCancels';
import { useRoomBackgroundJobs } from './useRoomBackgroundJobs';

type BackgroundJobsBarProps = {
  room: Room;
  threadId: string | null;
  // Whether the viewer may send the cancel event here; without it the jobs show without controls.
  canCancel: boolean;
};

// The last failed cancel of a job, with the view it was sent from, where it shows.
type Failure = { view: string | null; text: string };

/** The view's background jobs above the composer: one job with Stop, or several, each with ✕, and Stop all. */
export function BackgroundJobsBar({ room, threadId, canCancel }: BackgroundJobsBarProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const roomJobs = useRoomBackgroundJobs(room);
  const jobs = useMemo(() => jobsInView(roomJobs, threadId), [roomJobs, threadId]);
  const sent = useSentCancels(room.roomId);
  const [failures, setFailures] = useState<ReadonlyMap<string, Failure>>(new Map());
  const bar = useRef<HTMLDivElement>(null);
  const several = jobs.length > 1;
  // Focus was in the bar and did not move elsewhere, also when its focused control unmounted.
  const focused = useRef(false);
  // Going from several jobs to one, or back, replaces the controls; focus then stays in the bar.
  useLayoutEffect(() => {
    const active = document.activeElement;
    if (focused.current && (!active || active === document.body)) bar.current?.focus();
  }, [several]);

  useEffect(() => {
    keepCancelsOf(room.roomId, new Set(roomJobs.map((job) => job.jobId)));
  }, [room.roomId, roomJobs]);

  const cancel = useCallback(
    async (request: BackgroundJobCancelRequest, jobIds: string[], failure: string) => {
      const view = threadId;
      setFailures(
        (previous) => new Map([...previous].filter(([jobId]) => !jobIds.includes(jobId)))
      );
      const marked = markCancelSent(room.roomId, jobIds);
      try {
        await cancelBackgroundJob(mx, room, view, request);
      } catch {
        forgetCancel(room.roomId, marked);
        setFailures(
          (previous) =>
            new Map([
              ...previous,
              ...jobIds.map((jobId): [string, Failure] => [jobId, { view, text: failure }]),
            ])
        );
      }
    },
    [mx, room, threadId]
  );

  const model = presentBackgroundJobs(jobs, (jobId) => sent.has(jobId), t);
  if (!model) return null;
  const stoppable = model.items.filter((item) => !item.stopping);
  // A failure shows in its own view while its job is listed and no cancel reached it, here or elsewhere.
  const shownFailures = [
    ...new Set(
      stoppable.flatMap((item) => {
        const failed = failures.get(item.jobId);
        return failed && failed.view === threadId ? [failed.text] : [];
      })
    ),
  ];
  // A pressed ✕ turns into "Stopping…", so keyboard focus moves to the next ✕, or to the bar.
  const focusNextCancel = (pressed: HTMLElement) => {
    const others = [
      ...(bar.current?.querySelectorAll<HTMLElement>('[data-cancel-job]') ?? []),
    ].filter((control) => control !== pressed);
    const after = others.find(
      (control) => pressed.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING
    );
    (after ?? others.at(-1) ?? bar.current)?.focus();
  };
  const [single] = model.items;
  const stopJob = (item: BackgroundJobsBarItem, pressed: HTMLElement) => {
    focusNextCancel(pressed);
    cancel(
      { jobId: item.jobId },
      [item.jobId],
      t('mindroomUi.backgroundJobs.stopFailed', { tool: item.name })
    );
  };
  const stopAll = () => {
    bar.current?.focus();
    cancel(
      { all: true },
      model.items.map((item) => item.jobId),
      t('mindroomUi.backgroundJobs.stopAllFailed')
    );
  };
  // One job's Stop, or several jobs' Stop all, ends the status row; each is its own button.
  const action = canCancel && stoppable.length > 0 && (
    <Chip
      key={several ? 'all' : 'one'}
      type="button"
      radii="Pill"
      aria-label={
        several ? undefined : t('mindroomUi.backgroundJobs.stopJob', { tool: single.name })
      }
      data-cancel-job={several ? undefined : true}
      onClick={(event: React.MouseEvent<HTMLButtonElement>) =>
        several ? stopAll() : stopJob(single, event.currentTarget)
      }
    >
      <Text size="B300">
        {several ? t('mindroomUi.backgroundJobs.stopAll') : t('mindroomUi.backgroundJobs.stop')}
      </Text>
    </Chip>
  );
  return (
    <div
      ref={bar}
      tabIndex={-1}
      className={css.Bar}
      role="region"
      aria-label={model.title}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={(event) => {
        // A control that unmounts blurs without a new target; that keeps focus in the bar.
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) {
          focused.current = false;
        }
      }}
    >
      <small className={css.Status} role="status">
        <Icon src={Icons.Clock} size="50" aria-hidden />
        <Text as="span" size="T200" truncate title={model.title}>
          {model.title}
        </Text>
      </small>
      {action}
      {several && (
        <div className={css.Items}>
          {model.items.map((item) => (
            <span key={item.jobId} className={css.Item}>
              <span className={css.Label} title={item.label}>
                {item.label}
              </span>
              {item.stopping ? (
                <span className={css.ItemStatus}>{t('mindroomUi.backgroundJobs.stopping')}</span>
              ) : (
                canCancel && (
                  <IconTooltip
                    label={t('mindroomUi.backgroundJobs.stopJob', { tool: item.name })}
                    position="Top"
                  >
                    {(triggerRef) => (
                      <IconButton
                        ref={triggerRef}
                        size="300"
                        radii="Pill"
                        aria-label={t('mindroomUi.backgroundJobs.stopJob', { tool: item.name })}
                        data-cancel-job
                        onClick={(event: React.MouseEvent<HTMLButtonElement>) =>
                          stopJob(item, event.currentTarget)
                        }
                      >
                        <Icon src={Icons.Cross} size="50" />
                      </IconButton>
                    )}
                  </IconTooltip>
                )
              )}
            </span>
          ))}
        </div>
      )}
      {shownFailures.length > 0 && (
        <Text as="small" size="T200" role="alert" className={css.Alert}>
          {shownFailures.join(' ')}
        </Text>
      )}
    </div>
  );
}
