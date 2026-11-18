import type { Room } from 'matrix-js-sdk';
import { Chip, Icon, Icons, Text } from 'folds';
import classNames from 'classnames';
import React, {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from 'jotai';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { openSubagentsPanel } from '../navigation/subagentsPanel';
import { glassDenseOverBackdrop } from '../ui/styles/Glass.css';
import * as css from './BackgroundJobsBar.css';
import { jobsInView } from '../matrix/protocol/backgroundJobsContract';
import { type BackgroundJobsBarItem, presentBackgroundJobs } from './backgroundJobsPresentation';
import { BackgroundJobRow, BackgroundJobsSummary, JobElapsed, JobLogo } from './BackgroundJobRow';
import { type BackgroundJobCancelRequest, cancelBackgroundJob } from './cancelBackgroundJob';
import { forgetCancel, keepCancelsOf, markCancelSent, useSentCancels } from './sentCancels';
import { useRoomBackgroundJobs } from '../matrix/hooks/useRoomBackgroundJobs';
import { useJobsHeldBetweenCalls } from './useJobsHeldBetweenCalls';
import { useJobLookups } from './useJobLookups';

type BackgroundJobsBarProps = {
  room: Room;
  threadId: string | null;
  // Whether the viewer may send the cancel event here; without it the jobs show without controls.
  canCancel: boolean;
};

// The last failed cancel of a job, with the view it was sent from, where it shows.
type Failure = { view: string | null; text: string };

// A mouse resting on the title lists the jobs while it stays in the bar; pressing the title keeps them listed.
type OpenMode = 'hover' | 'pinned';

/**
 * The view's background jobs above the composer, on one line: one job with Stop, or several with
 * Stop all, which list each job with its own Stop on hover or when the title is pressed.
 */
export function BackgroundJobsBar({ room, threadId, canCancel }: BackgroundJobsBarProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const store = useStore();
  const { jobs: roomJobs, total: roomTotal } = useRoomBackgroundJobs(room);
  const sent = useSentCancels(room.roomId);
  const viewJobs = useMemo(() => jobsInView(roomJobs, threadId), [roomJobs, threadId]);
  const jobs = useJobsHeldBetweenCalls(viewJobs, threadId, (jobId) => sent.has(jobId), room);
  const { now, lookups } = useJobLookups(room, jobs);
  const [failures, setFailures] = useState<ReadonlyMap<string, Failure>>(new Map());
  const bar = useRef<HTMLDivElement>(null);
  const several = jobs.length > 1;
  // Focus was in the bar and did not move elsewhere, also when its focused control unmounted.
  const focused = useRef(false);
  // A job that ends, or one job turning into several, takes its focused control away; focus stays in the bar.
  // A bar that went away with its last job forgets it had focus, so a later job does not take it.
  useLayoutEffect(() => {
    if (!bar.current) {
      focused.current = false;
      return;
    }
    const active = document.activeElement;
    if (focused.current && (!active || active === document.body)) bar.current.focus();
  });

  const [open, setOpen] = useState<OpenMode>();
  const expanded = several && !!open;
  const anchor = useRef<HTMLDivElement>(null);
  // While listed, the bar keeps its one-line place in the footer and grows over the timeline,
  // so the timeline, which pads itself for the footer, does not move under the pointer.
  const [anchorHeight, setAnchorHeight] = useState<number>();
  const toggle = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const hoverTimer = useRef<number>();
  const show = (mode: OpenMode) => {
    window.clearTimeout(hoverTimer.current);
    // Fractional, so the footer keeps its exact height while the jobs are listed.
    if (!open) setAnchorHeight(anchor.current?.getBoundingClientRect().height);
    setOpen(mode);
  };
  const hide = useCallback(() => {
    window.clearTimeout(hoverTimer.current);
    setOpen(undefined);
  }, []);
  useEffect(() => {
    if (!several) hide();
  }, [several, hide]);
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);
  useEffect(() => {
    if (!expanded) return undefined;
    // Escape elsewhere closes the list and goes on to the room (to the composer, marking it read).
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) hide();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!bar.current?.contains(event.target as Node)) hide();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [expanded, hide]);

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

  // The agents count their live jobs per room, so only the main timeline knows of jobs they do not list.
  const total = threadId === null ? Math.max(roomTotal, jobs.length) : jobs.length;
  const model = presentBackgroundJobs(jobs, (jobId) => sent.has(jobId), t, total, lookups);
  if (!model) return null;
  const stoppable = model.items.filter((item) => !item.stopping && !item.finished);
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
    void cancel(
      { jobId: item.jobId },
      [item.jobId],
      t('mindroomUi.backgroundJobs.stopFailed', { tool: item.name })
    );
  };
  const stopAll = () => {
    bar.current?.focus();
    void cancel(
      { all: true },
      model.items.map((item) => item.jobId),
      t('mindroomUi.backgroundJobs.stopAllFailed')
    );
  };
  // Stop and Stop all are text on the bar's own material: no control adds a fill, rim or border.
  // A row's Stop is regular weight, under the bar's own Stop or Stop all. A finished job has none.
  const stop = (item: BackgroundJobsBarItem, inRow: boolean) =>
    !item.finished &&
    (item.stopping ? (
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
          className={css.Plain}
          aria-label={t('mindroomUi.backgroundJobs.stopJob', { tool: item.name })}
          data-cancel-job
          onClick={(event: React.MouseEvent<HTMLButtonElement>) =>
            stopJob(item, event.currentTarget)
          }
        >
          <Text size={inRow ? 'T200' : 'B300'}>{t('mindroomUi.backgroundJobs.stop')}</Text>
        </Chip>
      )
    ));
  const [single] = model.items;
  const finished = model.items.every((item) => item.finished);
  // A sub-agent job whose run the Sub-agents panel has opens it there, on that run.
  const openRun = (item: BackgroundJobsBarItem) => {
    const subagent = item.run?.meta.subagent;
    return subagent && (() => openSubagentsPanel(store, room.roomId, item.threadId, subagent));
  };
  const openSingle = single && openRun(single);
  // Only the title text is live, so a change is announced once, not with the button around it.
  const status = (
    <>
      {several ? (
        <Icon src={finished ? Icons.Check : Icons.Clock} size="50" aria-hidden />
      ) : (
        <JobLogo room={room} item={single!} size={20} />
      )}
      <Text as="span" size="T200" truncate role="status" title={model.title}>
        {model.title}
      </Text>
    </>
  );
  return (
    <div
      ref={anchor}
      className={css.Anchor}
      style={expanded ? { height: anchorHeight } : undefined}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !expanded) return;
        // In the bar, Escape closes the list as a menu does, back on its title, and goes no further.
        event.stopPropagation();
        toggle.current?.focus();
        hide();
      }}
    >
      <div
        ref={bar}
        tabIndex={-1}
        // Listed jobs hold irreversible actions over the timeline; the thread behind them must not compete.
        className={classNames(css.Bar, expanded && glassDenseOverBackdrop)}
        role="region"
        aria-label={model.title}
        onPointerLeave={(event: React.PointerEvent) => {
          if (event.pointerType !== 'mouse') return;
          window.clearTimeout(hoverTimer.current);
          if (open === 'hover') hide();
        }}
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={(event) => {
          const { currentTarget, relatedTarget, target } = event;
          if (relatedTarget) {
            if (!currentTarget.contains(relatedTarget)) {
              focused.current = false;
              hide();
            }
            return;
          }
          // Without a new target, focus left for the page or another window, unless its control unmounted.
          queueMicrotask(() => {
            if (target.isConnected) focused.current = false;
          });
        }}
      >
        <small className={css.Status}>
          {several ? (
            <button
              ref={toggle}
              type="button"
              className={css.Toggle}
              aria-expanded={expanded}
              aria-controls={expanded ? listId : undefined}
              onPointerEnter={(event: React.PointerEvent) => {
                if (event.pointerType !== 'mouse' || open) return;
                // Only a mouse resting on the title lists the jobs, so a pointer on its way to
                // the composer or the bars above does not open Stops under itself.
                hoverTimer.current = window.setTimeout(() => show('hover'), 150);
              }}
              onPointerLeave={() => window.clearTimeout(hoverTimer.current)}
              onClick={() => (open === 'pinned' ? hide() : show('pinned'))}
            >
              {status}
              <BackgroundJobsSummary room={room} model={model} />
              <Icon src={Icons.ChevronTop} size="50" className={css.Chevron} aria-hidden />
            </button>
          ) : (
            <>
              {status}
              <JobElapsed startedAt={single!.startedAt} now={now} />
              {openSingle && (
                // Beside the title, which stays the live status, not inside a button around it.
                <button
                  type="button"
                  className={css.Open}
                  aria-label={t('mindroomUi.backgroundJobs.openFor', { name: single.name })}
                  onClick={openSingle}
                  data-job-open
                >
                  <Text as="span" size="B300">
                    {t('mindroomUi.backgroundJobs.open')}
                  </Text>
                </button>
              )}
            </>
          )}
        </small>
        {expanded && (
          // Shown above the title, so the title and Stop all stay under the pointer, but read and
          // reached right after the title, before Stop all. Focus in the list keeps it listed.
          // Sub-agents and tools are lists of their own, headed when both show.
          <div id={listId} className={css.Jobs} onFocus={() => setOpen('pinned')}>
            {model.groups.map((group) => (
              <React.Fragment key={group.kind}>
                {model.groups.length > 1 && (
                  <Text
                    as="h3"
                    size="L400"
                    className={css.GroupHeading}
                    id={`${listId}-${group.kind}`}
                  >
                    {t(
                      group.kind === 'subagent'
                        ? 'mindroomUi.backgroundJobs.groupSubagents'
                        : 'mindroomUi.backgroundJobs.groupTools',
                      { number: group.items.length }
                    )}
                  </Text>
                )}
                {/* Lists without bullets keep their role in WebKit only when it is stated. */}
                {/* eslint-disable-next-line jsx-a11y/no-redundant-roles */}
                <ul
                  role="list"
                  className={css.JobList}
                  aria-labelledby={model.groups.length > 1 ? `${listId}-${group.kind}` : undefined}
                >
                  {group.items.map((item) => (
                    <BackgroundJobRow
                      key={item.jobId}
                      room={room}
                      item={item}
                      viewThreadId={threadId}
                      now={now}
                      onOpen={openRun(item) || undefined}
                      stop={stop(item, true)}
                    />
                  ))}
                </ul>
              </React.Fragment>
            ))}
          </div>
        )}
        <div className={css.Action}>
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
                  className={css.Plain}
                  onClick={stopAll}
                >
                  <Text size="B300">{t('mindroomUi.backgroundJobs.stopAll')}</Text>
                </Chip>
              )
            : !single!.stopping && stop(single!, false)}
        </div>
        {shownFailures.length > 0 && (
          <Text as="small" size="T200" role="alert" className={css.Alert}>
            {shownFailures.join(' ')}
          </Text>
        )}
      </div>
    </div>
  );
}
