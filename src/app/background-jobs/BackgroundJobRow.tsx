import {
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
  type Ref,
  useEffect,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import classNames from 'classnames';
import { Icon, Icons } from 'folds';
import { IconAlertCircle, IconArrowUpRight, IconMessage } from '@tabler/icons-react';
import { useAppLanguageCode } from '../i18n/useAppLanguageCode';
import { subscribeRelativeTimeClock, useRelativeTime } from '../i18n/useRelativeTime';
import { formatWorkDuration } from '../lib/time';
import { getAiRunCompactModelLabel, getAiRunModelLabel } from '../matrix/protocol/aiRunModelLabel';
import { useRoomNavigate } from '../navigation/useRoomNavigate';
import { settingsAtom } from '../preferences/settings';
import { useSettingValue } from '../preferences/useSettingValue';
import { RunLogo } from '../subagents/RunLogo';
import { useUsageCells } from '../subagents/runUsage';
import { useAgentProfile } from '../subagents/AgentAvatar';
import { useThreadTitle } from '../threads/fork/ThreadForkDivider';
import * as css from './BackgroundJobsBar.css';
import {
  type BackgroundJobsBarItem,
  type BackgroundJobsBarModel,
  shownJobName,
} from './backgroundJobsPresentation';

/**
 * A job's logo: its run's model, else a sub-agent's agent or a tool's terminal, on a tile with a
 * dot that says how it stands. The dot is decoration; the row's words say it too.
 */
export function JobLogo({
  room,
  item,
  small = false,
  dot = true,
  className,
}: {
  room: Room;
  item: BackgroundJobsBarItem;
  small?: boolean;
  dot?: boolean;
  className?: string;
}) {
  const agent = useAgentProfile(room, item.agent ?? '');
  return (
    <RunLogo
      model={item.run?.meta.model}
      agent={agent}
      kind={item.subagent ? 'agent' : 'tool'}
      state={item.state}
      small={small}
      dot={dot}
      className={className}
    />
  );
}

/** The most sub-agent logos several jobs' title stacks. */
const STACKED_LOGOS = 4;

/**
 * After several jobs' title: the first sub-agents' logos, stacked, then how many sub-agents and
 * tools run, and how many need approval. A count of none is left out.
 */
export function BackgroundJobsSummary({
  room,
  model,
}: {
  room: Room;
  model: BackgroundJobsBarModel;
}) {
  const { t } = useTranslation();
  const { summary } = model;
  if (!summary) return null;
  const logos = model.items.filter((item) => item.subagent).slice(0, STACKED_LOGOS);
  const counts = [
    summary.subagents > 0 && t('mindroomUi.subagents.nested', { count: summary.subagents }),
    summary.tools > 0 && t('mindroomUi.backgroundJobs.tools', { count: summary.tools }),
  ].filter((part): part is string => !!part);
  return (
    <>
      {logos.length > 0 && (
        <span className={css.Stack} aria-hidden>
          {logos.map((item) => (
            <JobLogo
              key={item.jobId}
              room={room}
              item={item}
              small
              dot={false}
              className={css.StackedLogo}
            />
          ))}
        </span>
      )}
      {counts.length > 0 && <span className={css.Summary}>{counts.join(' · ')}</span>}
      {summary.waiting > 0 && (
        // Outside the muted counts, so its warning color keeps its full contrast.
        <span className={css.SummaryWaiting} data-needs-approval>
          {t('mindroomUi.backgroundJobs.needApproval', { count: summary.waiting })}
        </span>
      )}
    </>
  );
}

/** How long the job ran ("38m 12s"), ticking on one shared clock until `endedAt`; readers hear its start. */
export function JobElapsed({ startedAt, endedAt }: { startedAt: number; endedAt?: number }) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const live = endedAt === undefined;
  const [ticked, setNow] = useState(Date.now);
  useEffect(
    () => (live ? subscribeRelativeTimeClock(1_000, () => setNow(Date.now())) : undefined),
    [live]
  );
  const now = endedAt ?? ticked;
  const started = useRelativeTime(Number.isFinite(startedAt) ? startedAt : undefined);
  if (!Number.isFinite(startedAt)) return <span />;
  return (
    <span className={css.Elapsed}>
      <span aria-hidden data-job-elapsed>
        {formatWorkDuration(now - startedAt, language)}
      </span>
      <span className={css.VisuallyHidden}>
        {t('mindroomUi.backgroundJobs.started', { time: started })}
      </span>
    </span>
  );
}

/**
 * An icon button, beside Open and Stop, that shows the thread of a job of another conversation
 * than the view's, named for that thread.
 */
function ThreadButton({ room, threadId }: { room: Room; threadId: string }) {
  const { t } = useTranslation();
  const { navigateRoomThread } = useRoomNavigate();
  const title = useThreadTitle(room, threadId, undefined, undefined);
  const label = t('thread.aria.openThread', { title });
  return (
    <button
      type="button"
      className={css.IconButton}
      title={label}
      aria-label={label}
      onClick={() => navigateRoomThread(room.roomId, threadId)}
      data-job-thread={threadId}
    >
      <IconMessage size={16} stroke={1.8} aria-hidden />
    </button>
  );
}

/** The folded bar's one job: its title lists it, as several jobs' title does. */
export type FoldedToggle = {
  ref: Ref<HTMLButtonElement>;
  props: ButtonHTMLAttributes<HTMLButtonElement>;
};

type RowProps = {
  room: Room;
  item: BackgroundJobsBarItem;
  // The view's conversation; a job of another one has a button to its thread.
  viewThreadId: string | null;
  // When an ended job ended, which its time stops at.
  endedAt?: number;
  // Shows the job's run in the Sub-agents panel, from a press anywhere on the row; only for a job
  // whose run the panel has.
  onOpen?: () => void;
  // The job's Stop, or its Stopping.
  stop: ReactNode;
  // The folded bar's one job, on the title line: its title lists it, and Open shows its run.
  folded?: FoldedToggle;
};

/** Open: an icon button that shows the job's run in the Sub-agents panel. */
export function OpenButton({ name, onOpen }: { name: string; onOpen: () => void }) {
  const { t } = useTranslation();
  const label = t('mindroomUi.backgroundJobs.openFor', { name });
  return (
    <button
      type="button"
      className={css.IconButton}
      aria-label={label}
      title={label}
      onClick={onOpen}
      data-job-open
    >
      <IconArrowUpRight size={16} stroke={1.8} aria-hidden />
    </button>
  );
}

/**
 * One listed job on the bar's grid: its title, else its task, as the headline, with at most one
 * pill; under it who, on what model, and what it does now (the tool it calls, then its arguments;
 * a tool job's headline is its tool already). Then its calls, tokens and cost, its time, and its
 * buttons: the thread it runs in when that is not the view's, and Stop. A sub-agent job's title
 * opens its run, from anywhere on the row.
 * Without the usage details (`showUsageDetails`) it shows neither the line under the headline nor
 * the numbers, and a tool job's headline is its tool in plain words (`shownJobName`).
 * Folded, the bar's one job is this row on its title line: the headline and the rest on one line,
 * the title listing it, and Open beside Stop.
 * A job without its run's frames shows its name alone, as before.
 */
export function BackgroundJobRow({
  room,
  item,
  viewThreadId,
  endedAt,
  onOpen,
  stop,
  folded,
}: RowProps) {
  const { t } = useTranslation();
  const details = useSettingValue(settingsAtom, 'showUsageDetails');
  const agent = useAgentProfile(room, item.agent ?? '');
  const meta = item.run?.meta;
  const modelLabel = meta?.model && getAiRunCompactModelLabel(meta.model);
  const task = meta?.task?.split('\n', 1)[0];
  const [calls, tokens, cost] = useUsageCells(meta?.usage);
  const elsewhere = item.threadId !== null && item.threadId !== viewThreadId;
  const name = meta ? agent.name : item.name;
  const described = meta?.title || task;
  const headline = item.subagent ? described || name : shownJobName(item, details, t);
  const nested = item.depth > 0;
  // A sub-agent names the tool it calls; a tool job's headline is its tool already.
  const tool = item.subagent ? item.activity?.tool : undefined;
  const doing = item.activity?.preview;
  const waiting = item.waiting && !item.stopping;
  const detail = details && ((described && meta) || tool || doing);
  const headlineTitle = meta?.task || item.name;
  let title: ReactNode = (
    <span className={css.Task} title={headlineTitle} dir="auto">
      {headline}
    </span>
  );
  if (folded) {
    title = (
      // The title line's way to the list: its title, whose reach is the row's text.
      <button
        ref={folded.ref}
        type="button"
        className={classNames(css.Task, css.FoldedToggle)}
        title={headlineTitle}
        dir="auto"
        {...folded.props}
      >
        {headline}
      </button>
    );
  } else if (onOpen) {
    title = (
      // The row's way to its run: its title, whose reach is the whole row.
      <button
        type="button"
        className={classNames(css.Task, css.RowOpen)}
        title={headlineTitle}
        aria-label={t('mindroomUi.backgroundJobs.openFor', { name: headline })}
        onClick={onOpen}
        data-job-open
        dir="auto"
      >
        {headline}
      </button>
    );
  }
  const Element = folded ? 'div' : 'li';
  return (
    <Element
      className={classNames(folded ? css.Folded : css.Job, nested && css.Nested)}
      style={nested ? ({ '--job-depth': item.depth } as CSSProperties) : undefined}
      data-job-kind={item.subagent ? 'subagent' : 'tool'}
      data-job-depth={item.depth}
      data-job-folded={folded ? '' : undefined}
    >
      <JobLogo room={room} item={item} small={nested || !!folded} />
      <span className={folded ? css.FoldedText : css.JobText}>
        <span className={css.Headline}>
          {title}
          {waiting && (
            <span className={css.Pill.waiting} title={t('mindroomUi.backgroundJobs.waiting')}>
              <span className={css.PillIcon}>
                <IconAlertCircle size={14} stroke={1.8} aria-hidden />
              </span>
              <span className={css.PillText}>{t('mindroomUi.backgroundJobs.waiting')}</span>
            </span>
          )}
          {item.finished && (
            <span className={css.Pill.done} data-job-done>
              {t('mindroomUi.subagents.completed')}
            </span>
          )}
          {item.stopping && (
            // Its Stop's place says so to screen readers.
            <span className={css.Pill.stopping} aria-hidden>
              {t('mindroomUi.backgroundJobs.stopping')}
            </span>
          )}
        </span>
        {detail && (
          <span className={css.Detail}>
            {described && meta && (
              <span className={css.Name} title={agent.name}>
                {agent.name}
              </span>
            )}
            {described && modelLabel && (
              <span
                className={css.Model}
                title={meta?.model && getAiRunModelLabel(meta.model)}
                data-job-model
              >
                {modelLabel}
              </span>
            )}
            {(tool || doing) && (
              <span className={css.Activity} data-job-activity>
                {tool && <span className={css.ToolName}>{tool}</span>}
                {tool && doing && ' '}
                {doing && <span className={css.Preview}>{doing}</span>}
              </span>
            )}
          </span>
        )}
        {folded && (
          <span className={css.Chevron} aria-hidden>
            <Icon src={Icons.ChevronTop} size="100" />
          </span>
        )}
      </span>
      {details &&
        [calls, tokens, cost].map((cell, index) => (
          <span
            // The columns are fixed: calls, tokens, cost.
            // eslint-disable-next-line react/no-array-index-key
            key={index}
            className={css.Stat}
            title={cell?.title}
            data-job-stat={['calls', 'tokens', 'cost'][index]}
          >
            {cell?.text}
          </span>
        ))}
      <JobElapsed startedAt={item.startedAt} endedAt={endedAt} />
      <span className={folded ? css.FoldedActions : css.Actions}>
        {folded && onOpen && <OpenButton name={headline} onOpen={onOpen} />}
        {elsewhere && <ThreadButton room={room} threadId={item.threadId!} />}
        {stop}
      </span>
    </Element>
  );
}
