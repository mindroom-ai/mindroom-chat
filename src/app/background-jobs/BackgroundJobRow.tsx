import { type CSSProperties, type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import classNames from 'classnames';
import { Icon, Icons } from 'folds';
import { IconAlertCircle, IconArrowUpRight, IconMessage } from '@tabler/icons-react';
import { useAppLanguageCode } from '../i18n/useAppLanguageCode';
import { subscribeRelativeTimeClock, useRelativeTime } from '../i18n/useRelativeTime';
import { formatWorkDuration } from '../lib/time';
import type { SubagentUsage } from '../matrix/protocol/subagentFrame';
import {
  formatCostUsd,
  getAiRunCompactModelLabel,
  getAiRunModelLabel,
} from '../messages/agent-run/aiRunDisplay';
import { ProviderModelIcon } from '../models/ProviderModelIcon';
import { useRoomNavigate } from '../navigation/useRoomNavigate';
import { AgentAvatar, useAgentProfile } from '../subagents/SubagentRunCard';
import { useThreadTitle } from '../threads/fork/ThreadForkDivider';
import * as css from './BackgroundJobsBar.css';
import type { BackgroundJobsBarItem, BackgroundJobsBarModel } from './backgroundJobsPresentation';

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
  const model = item.run?.meta.model;
  let logo: ReactNode = <Icon src={Icons.Terminal} size={small ? '50' : '100'} aria-hidden />;
  if (model) {
    logo = (
      <ProviderModelIcon provider={model.modelProvider} id={model.modelId} size={small ? 12 : 16} />
    );
  } else if (item.subagent) {
    logo = <AgentAvatar agent={agent} size="200" />;
  }
  return (
    <span
      className={classNames(css.Logo, className)}
      data-job-logo={model ? 'model' : item.subagent ? 'agent' : 'tool'}
      data-model-provider={model?.modelProvider}
      aria-hidden
    >
      {logo}
      {dot && <span className={css.Dot[item.state]} data-job-state={item.state} />}
    </span>
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

/** A thread's title, which shows that thread: for a job of another conversation than the view's. */
function ThreadChip({ room, threadId }: { room: Room; threadId: string }) {
  const { navigateRoomThread } = useRoomNavigate();
  const title = useThreadTitle(room, threadId, undefined, undefined);
  return (
    <button
      type="button"
      className={css.ThreadChip}
      title={title}
      aria-label={title}
      onClick={() => navigateRoomThread(room.roomId, threadId)}
      data-job-thread={threadId}
    >
      <IconMessage size={14} stroke={1.8} aria-hidden />
      <span className={css.ThreadTitle}>{title}</span>
    </button>
  );
}

const tokenFormat = (language: string) =>
  new Intl.NumberFormat(language, { notation: 'compact', maximumFractionDigits: 1 });

type UsageCell = { text: string; title: string } | undefined;

/**
 * The run's calls, tokens and cost as bare numbers, each with its words as its title. A count of
 * none shows nothing, and no cost shows before any token.
 */
const useUsageCells = (usage: SubagentUsage | undefined): [UsageCell, UsageCell, UsageCell] => {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  if (!usage) return [undefined, undefined, undefined];
  const tokens = usage.inputTokens + usage.outputTokens;
  const compact = tokenFormat(language).format(tokens);
  const cost = usage.costUsd !== undefined ? formatCostUsd(usage.costUsd, language) : undefined;
  return [
    usage.toolCalls > 0
      ? {
          text: String(usage.toolCalls),
          title: t('mindroomUi.backgroundJobs.toolCalls', { count: usage.toolCalls }),
        }
      : undefined,
    tokens > 0
      ? {
          text: compact,
          title: t('mindroomUi.backgroundJobs.tokens', { count: tokens, tokens: compact }),
        }
      : undefined,
    tokens > 0 && cost ? { text: cost, title: cost } : undefined,
  ];
};

type RowProps = {
  room: Room;
  item: BackgroundJobsBarItem;
  // The view's conversation; a job of another one links to its thread.
  viewThreadId: string | null;
  // When an ended job ended, which its time stops at.
  endedAt?: number;
  // Shows the job's run in the Sub-agents panel; only for a job whose run the panel has.
  onOpen?: () => void;
  // The job's Stop, or its Stopping.
  stop: ReactNode;
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
 * One listed job on the bar's grid: its task as the headline, with at most one pill; under it who,
 * on what model, doing what, and the thread it runs in when that is not the view's. Then its
 * calls, tokens and cost, its time, Open and Stop, each in its column. A job without its run's
 * frames shows its name alone, as before.
 */
export function BackgroundJobRow({ room, item, viewThreadId, endedAt, onOpen, stop }: RowProps) {
  const { t } = useTranslation();
  const agent = useAgentProfile(room, item.agent ?? '');
  const meta = item.run?.meta;
  const modelLabel = meta?.model && getAiRunCompactModelLabel(meta.model);
  const task = meta?.task?.split('\n', 1)[0];
  const [calls, tokens, cost] = useUsageCells(meta?.usage);
  const elsewhere = item.threadId !== null && item.threadId !== viewThreadId;
  const name = meta ? agent.name : item.name;
  const headline = task || name;
  const nested = item.depth > 0;
  const { activity } = item;
  const doing = activity && (item.subagent || activity.preview);
  const waiting = item.waiting && !item.stopping;
  const detail = (task && meta) || doing || elsewhere;
  return (
    <li
      className={classNames(css.Job, nested && css.Nested)}
      style={nested ? ({ '--job-depth': item.depth } as CSSProperties) : undefined}
      data-job-kind={item.subagent ? 'subagent' : 'tool'}
      data-job-depth={item.depth}
    >
      <JobLogo room={room} item={item} small={nested} />
      <span className={css.JobText}>
        <span className={css.Headline}>
          <span className={css.Task} title={task ? task : item.name} dir="auto">
            {headline}
          </span>
          {waiting && (
            <span className={css.Pill.waiting} title={t('mindroomUi.backgroundJobs.waiting')}>
              <span className={css.PillIcon}>
                <IconAlertCircle size={14} stroke={1.8} aria-hidden />
              </span>
              <span className={css.PillText}>{t('mindroomUi.backgroundJobs.waiting')}</span>
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
            {task && meta && (
              <span className={css.Name} title={agent.name}>
                {agent.name}
              </span>
            )}
            {task && modelLabel && (
              <span
                className={css.Model}
                title={meta?.model && getAiRunModelLabel(meta.model)}
                data-job-model
              >
                {modelLabel}
              </span>
            )}
            {task && modelLabel && doing && (
              <span className={css.Model} aria-hidden>
                ·
              </span>
            )}
            {doing && (
              // A tool job's headline is its tool already: its line 2 is the call's arguments.
              <span className={css.Activity} data-job-activity>
                {item.subagent && activity.tool}
                {activity.preview && (
                  <span className={css.Preview}>
                    {item.subagent && ' '}
                    {activity.preview}
                  </span>
                )}
              </span>
            )}
            {elsewhere && <ThreadChip room={room} threadId={item.threadId!} />}
          </span>
        )}
      </span>
      {[calls, tokens, cost].map((cell, index) => (
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
      <span className={css.Actions}>
        {onOpen && <OpenButton name={name} onOpen={onOpen} />}
        {stop}
      </span>
    </li>
  );
}
