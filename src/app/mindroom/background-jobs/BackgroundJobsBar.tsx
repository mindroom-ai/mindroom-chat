import type { Room } from 'matrix-js-sdk';
import { Icon, IconButton, Icons } from 'folds';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import * as css from './backgroundJobsBar.css';
import { type BackgroundJobsBarItem, presentBackgroundJobs } from './backgroundJobsPresentation';
import { type BackgroundJobCancelRequest, cancelBackgroundJob } from './cancelBackgroundJob';
import { useBackgroundJobs } from './useBackgroundJobs';

type BackgroundJobsBarProps = {
  room: Room;
  threadId: string | null;
};

/** The view's background jobs above the composer, each with a cancel button, and Stop all for several. */
export function BackgroundJobsBar({ room, threadId }: BackgroundJobsBarProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const jobs = useBackgroundJobs(room, threadId);
  // Jobs whose cancel was sent; each stays "Stopping…" until it leaves the published state.
  const [stopping, setStopping] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string>();

  useEffect(() => {
    const live = new Set(jobs.map((job) => job.jobId));
    setStopping((previous) => {
      const kept = [...previous].filter((jobId) => live.has(jobId));
      return kept.length === previous.size ? previous : new Set(kept);
    });
  }, [jobs]);

  const cancel = useCallback(
    async (request: BackgroundJobCancelRequest, jobIds: string[], tool: string) => {
      setError(undefined);
      setStopping((previous) => new Set([...previous, ...jobIds]));
      try {
        await cancelBackgroundJob(mx, room.roomId, threadId, request);
      } catch {
        setStopping(
          (previous) => new Set([...previous].filter((jobId) => !jobIds.includes(jobId)))
        );
        setError(t('mindroomUi.backgroundJobs.cancelFailed', { tool }));
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
      {error && (
        <small role="alert" className={css.Status}>
          {error}
        </small>
      )}
    </div>
  );
}
