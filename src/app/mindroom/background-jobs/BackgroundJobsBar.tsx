import type { Room } from 'matrix-js-sdk';
import { Icon, IconButton, Icons } from 'folds';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import * as css from './backgroundJobsBar.css';
import { jobsInView } from './backgroundJobsContract';
import { type BackgroundJobsBarItem, presentBackgroundJobs } from './backgroundJobsPresentation';
import { type BackgroundJobCancelRequest, cancelBackgroundJob } from './cancelBackgroundJob';
import { useRoomBackgroundJobs } from './useBackgroundJobs';

type BackgroundJobsBarProps = {
  room: Room;
  threadId: string | null;
};

/** The view's background jobs above the composer, each with a cancel button, and Stop all for several. */
export function BackgroundJobsBar({ room, threadId }: BackgroundJobsBarProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const roomJobs = useRoomBackgroundJobs(room);
  const jobs = useMemo(() => jobsInView(roomJobs, threadId), [roomJobs, threadId]);
  // Each job whose cancel was sent, with the request that sent it; it stays "Stopping…" until it
  // leaves the room's published jobs, also while another view of the room is open.
  const [stopping, setStopping] = useState<ReadonlyMap<string, number>>(new Map());
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
      setStopping((previous) => {
        const next = new Map(previous);
        jobIds.forEach((jobId) => {
          if (!next.has(jobId)) next.set(jobId, sent);
        });
        return next;
      });
      try {
        await cancelBackgroundJob(mx, room.roomId, threadId, request);
      } catch {
        // Only this request's marks go; a job an earlier cancel already reached stays stopping.
        setStopping((previous) => new Map([...previous].filter(([, owner]) => owner !== sent)));
        setError({ text: t('mindroomUi.backgroundJobs.cancelFailed', { tool }), jobIds });
      }
    },
    [mx, room.roomId, threadId, t]
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
            <span>{item.label}</span>
            {isStopping(item) ? (
              <span>{t('mindroomUi.backgroundJobs.stopping')}</span>
            ) : (
              <IconButton
                size="300"
                radii="Pill"
                variant="SurfaceVariant"
                aria-label={t('mindroomUi.backgroundJobs.cancel', { tool: item.label })}
                onClick={() => cancel({ jobId: item.jobId }, [item.jobId], item.label)}
              >
                <Icon src={Icons.Cross} size="50" />
              </IconButton>
            )}
          </span>
        ))}
        {model.items.length > 1 && stoppable.length > 0 && (
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
      </div>
      {error && jobs.some((job) => error.jobIds.includes(job.jobId)) && (
        <small role="alert" className={css.Status}>
          {error.text}
        </small>
      )}
    </div>
  );
}
