import type { Room } from 'matrix-js-sdk';
import { Icon, IconButton, Icons } from 'folds';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import * as css from './backgroundJobsBar.css';
import { jobsInView } from './backgroundJobsContract';
import { type BackgroundJobsBarItem, presentBackgroundJobs } from './backgroundJobsPresentation';
import { type BackgroundJobCancelRequest, cancelBackgroundJob } from './cancelBackgroundJob';
import { useRoomBackgroundJobs } from './useRoomBackgroundJobs';

type BackgroundJobsBarProps = {
  room: Room;
  threadId: string | null;
  // Whether the viewer may send the cancel event here; without it the jobs show without controls.
  canCancel: boolean;
};

/** The view's background jobs above the composer, each with a cancel button, and Stop all for several. */
export function BackgroundJobsBar({ room, threadId, canCancel }: BackgroundJobsBarProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const roomJobs = useRoomBackgroundJobs(room);
  const jobs = useMemo(() => jobsInView(roomJobs, threadId), [roomJobs, threadId]);
  // Each job whose cancel was sent, with the requests that sent one; it stays "Stopping…" while any of
  // them may have arrived, until it leaves the room's published jobs, also while another view is open.
  const [stopping, setStopping] = useState<ReadonlyMap<string, ReadonlySet<number>>>(new Map());
  const [error, setError] = useState<{ text: string; jobIds: string[] }>();
  const requests = useRef(0);

  useEffect(() => {
    const live = new Set(roomJobs.map((job) => job.jobId));
    setStopping((previous) => {
      const kept = [...previous].filter(([jobId]) => live.has(jobId));
      return kept.length === previous.size ? previous : new Map(kept);
    });
  }, [roomJobs]);

  const cancel = useCallback(
    async (request: BackgroundJobCancelRequest, jobIds: string[], tool: string) => {
      requests.current += 1;
      const sent = requests.current;
      setError(undefined);
      setStopping(
        (previous) =>
          new Map([
            ...previous,
            ...jobIds.map((jobId): [string, ReadonlySet<number>] => [
              jobId,
              new Set([...(previous.get(jobId) ?? []), sent]),
            ]),
          ])
      );
      try {
        await cancelBackgroundJob(mx, room, threadId, request);
      } catch {
        // Only this request's marks go; a job another cancel also reached stays stopping.
        setStopping(
          (previous) =>
            new Map(
              [...previous]
                .map(([jobId, sends]): [string, ReadonlySet<number>] => [
                  jobId,
                  new Set([...sends].filter((other) => other !== sent)),
                ])
                .filter(([, sends]) => sends.size > 0)
            )
        );
        setError({ text: t('mindroomUi.backgroundJobs.cancelFailed', { tool }), jobIds });
      }
    },
    [mx, room, threadId, t]
  );

  const model = presentBackgroundJobs(jobs, t);
  if (!model) return null;
  const isStopping = (item: BackgroundJobsBarItem) => item.stopping || stopping.has(item.jobId);
  const stoppable = model.items.filter((item) => !isStopping(item));
  return (
    <div className={css.Bar} role="region" aria-label={model.title}>
      <small className={css.Status} role="status">
        <Icon src={Icons.Clock} size="50" aria-hidden />
        <span>{model.title}</span>
      </small>
      <div className={css.Items}>
        {model.items.map((item) => (
          <span key={item.jobId} className={css.Item}>
            <span className={css.Label} title={item.label}>
              {item.label}
            </span>
            {isStopping(item) ? (
              <span>{t('mindroomUi.backgroundJobs.stopping')}</span>
            ) : (
              canCancel && (
                <IconButton
                  size="300"
                  radii="Pill"
                  variant="SurfaceVariant"
                  aria-label={t('mindroomUi.backgroundJobs.cancel', { tool: item.name })}
                  onClick={() => cancel({ jobId: item.jobId }, [item.jobId], item.name)}
                >
                  <Icon src={Icons.Cross} size="50" />
                </IconButton>
              )
            )}
          </span>
        ))}
      </div>
      {canCancel && model.items.length > 1 && stoppable.length > 0 && (
        <button
          type="button"
          className={css.Chip}
          onClick={() =>
            cancel(
              { all: true },
              model.items.map((item) => item.jobId),
              model.title
            )
          }
        >
          {t('mindroomUi.backgroundJobs.stopAll')}
        </button>
      )}
      {error &&
        // A failure matters while one of its jobs is listed and no other cancel reached it.
        jobs.some((job) => error.jobIds.includes(job.jobId) && !stopping.has(job.jobId)) && (
          <small role="alert" className={css.Status}>
            {error.text}
          </small>
        )}
    </div>
  );
}
