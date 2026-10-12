import type { Room } from 'matrix-js-sdk';
import { Icon, IconButton, Icons } from 'folds';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import * as css from './backgroundJobsBar.css';
import { jobsInView } from './backgroundJobsContract';
import { presentBackgroundJobs } from './backgroundJobsPresentation';
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

/** The view's background jobs above the composer, each with a cancel button, and Stop all for several. */
export function BackgroundJobsBar({ room, threadId, canCancel }: BackgroundJobsBarProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const roomJobs = useRoomBackgroundJobs(room);
  const jobs = useMemo(() => jobsInView(roomJobs, threadId), [roomJobs, threadId]);
  const sent = useSentCancels(room.roomId);
  const [failures, setFailures] = useState<ReadonlyMap<string, Failure>>(new Map());
  const bar = useRef<HTMLDivElement>(null);

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

  const model = presentBackgroundJobs(jobs, sent, t);
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
  return (
    <div ref={bar} tabIndex={-1} className={css.Bar} role="region" aria-label={model.title}>
      <small className={css.Status} role="status">
        <Icon src={Icons.Clock} size="50" aria-hidden />
        <span className={css.Label} title={model.title}>
          {model.title}
        </span>
      </small>
      <div className={css.Items}>
        {model.items.map((item) => (
          <span key={item.jobId} className={css.Item}>
            <span className={css.Label} title={item.label}>
              {item.label}
            </span>
            {!stoppable.includes(item) ? (
              <span>{t('mindroomUi.backgroundJobs.stopping')}</span>
            ) : (
              canCancel && (
                <IconButton
                  size="300"
                  radii="Pill"
                  variant="SurfaceVariant"
                  aria-label={t('mindroomUi.backgroundJobs.cancel', { tool: item.name })}
                  data-cancel-job
                  onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
                    focusNextCancel(event.currentTarget);
                    cancel(
                      { jobId: item.jobId },
                      [item.jobId],
                      t('mindroomUi.backgroundJobs.cancelFailed', { tool: item.name })
                    );
                  }}
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
          onClick={() => {
            bar.current?.focus();
            cancel(
              { all: true },
              model.items.map((item) => item.jobId),
              t('mindroomUi.backgroundJobs.stopAllFailed')
            );
          }}
        >
          {t('mindroomUi.backgroundJobs.stopAll')}
        </button>
      )}
      {shownFailures.length > 0 && (
        <small role="alert" className={css.Status}>
          {shownFailures.join(' ')}
        </small>
      )}
    </div>
  );
}
