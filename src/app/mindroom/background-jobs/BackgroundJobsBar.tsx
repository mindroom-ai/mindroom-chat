import type { Room } from 'matrix-js-sdk';
import { Chip, Icon, Icons, Text } from 'folds';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMatrixClient } from '../../hooks/useMatrixClient';
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

/** The view's background jobs above the composer: one job with Stop, or several, each with Stop, and Stop all. */
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
  // A job that ends, or one job turning into several, takes its focused control away; focus stays in the bar.
  useLayoutEffect(() => {
    const active = document.activeElement;
    if (focused.current && (!active || active === document.body)) bar.current?.focus();
  });

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
  // A pressed Stop turns into "Stopping…", so keyboard focus moves to the next Stop, or to the bar.
  const focusNextCancel = (pressed: HTMLElement) => {
    const others = [
      ...(bar.current?.querySelectorAll<HTMLElement>('[data-cancel-job]') ?? []),
    ].filter((control) => control !== pressed);
    const after = others.find(
      (control) => pressed.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING
    );
    (after ?? others.at(-1) ?? bar.current)?.focus();
  };
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
  // Stop and Stop all are text on the bar's own material: no control adds a fill, rim or border.
  // A row's Stop is regular weight, under the bar's own Stop or Stop all.
  const stop = (item: BackgroundJobsBarItem, inRow: boolean) =>
    item.stopping ? (
      <Text as="span" size="T200" className={css.Stopping}>
        {t('mindroomUi.backgroundJobs.stopping')}
      </Text>
    ) : (
      canCancel && (
        <Chip
          key={item.jobId}
          type="button"
          variant="SurfaceVariant"
          fill="None"
          radii="Pill"
          className={css.Action}
          aria-label={t('mindroomUi.backgroundJobs.stopJob', { tool: item.name })}
          data-cancel-job
          onClick={(event: React.MouseEvent<HTMLButtonElement>) =>
            stopJob(item, event.currentTarget)
          }
        >
          <Text size={inRow ? 'T200' : 'B300'}>{t('mindroomUi.backgroundJobs.stop')}</Text>
        </Chip>
      )
    );
  const [single] = model.items;
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
        const { currentTarget, relatedTarget, target } = event;
        if (relatedTarget) {
          if (!currentTarget.contains(relatedTarget)) focused.current = false;
          return;
        }
        // Without a new target, focus left for the page or another window, unless its control unmounted.
        queueMicrotask(() => {
          if (target.isConnected) focused.current = false;
        });
      }}
    >
      <div className={css.Row}>
        <small className={css.Status} role="status">
          <Icon src={Icons.Clock} size="50" aria-hidden />
          <Text as="span" size="T200" truncate title={model.title}>
            {model.title}
          </Text>
        </small>
        {several
          ? canCancel &&
            stoppable.length > 0 && (
              // Its own button, so a focused Stop never turns into Stop all when a job arrives.
              <Chip
                key="all"
                type="button"
                variant="SurfaceVariant"
                fill="None"
                radii="Pill"
                className={css.Action}
                onClick={stopAll}
              >
                <Text size="B300">{t('mindroomUi.backgroundJobs.stopAll')}</Text>
              </Chip>
            )
          : !single.stopping && stop(single, false)}
      </div>
      {several && (
        // Lists without bullets keep their role in WebKit only when it is stated.
        // eslint-disable-next-line jsx-a11y/no-redundant-roles
        <ul role="list" className={css.Jobs}>
          {model.items.map((item) => (
            <li key={item.jobId} className={css.Job}>
              <Text as="span" size="T200" truncate className={css.Label} title={item.name}>
                {item.name}
              </Text>
              {item.waiting && !item.stopping && (
                <Text as="span" size="T200" truncate className={css.Muted}>
                  {t('mindroomUi.backgroundJobs.waiting')}
                </Text>
              )}
              {stop(item, true)}
            </li>
          ))}
        </ul>
      )}
      {shownFailures.length > 0 && (
        <Text as="small" size="T200" role="alert" className={css.Alert}>
          {shownFailures.join(' ')}
        </Text>
      )}
    </div>
  );
}
