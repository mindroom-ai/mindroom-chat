import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { Badge, Icon, Icons, Text } from 'folds';
import { useAppLanguageCode } from '../i18n/useAppLanguageCode';
import { useRelativeTime } from '../i18n/useRelativeTime';
import { formatCallDuration } from '../lib/time';
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
 * A job's logo: its run's model, else a sub-agent's agent or a tool's terminal, with a dot that
 * says how it stands. The dot is decoration; the row's words say it too.
 */
export function JobLogo({
  room,
  item,
  size,
  dot = true,
}: {
  room: Room;
  item: BackgroundJobsBarItem;
  size: number;
  dot?: boolean;
}) {
  const agent = useAgentProfile(room, item.agent ?? '');
  const model = item.run?.meta.model;
  let logo: ReactNode = <Icon src={Icons.Terminal} size="100" aria-hidden />;
  if (model) {
    logo = (
      <ProviderModelIcon
        provider={model.modelProvider}
        id={model.modelId}
        size={Math.round(size * 0.6)}
      />
    );
  } else if (item.subagent) {
    logo = <AgentAvatar agent={agent} size="200" />;
  }
  return (
    <span
      className={css.Logo}
      style={{ inlineSize: size, blockSize: size }}
      data-job-logo={model ? 'model' : item.subagent ? 'agent' : 'tool'}
      data-model-provider={model?.modelProvider}
      data-model-id={model?.modelId}
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
            <JobLogo key={item.jobId} room={room} item={item} size={18} dot={false} />
          ))}
        </span>
      )}
      {counts.length > 0 && (
        <Text as="span" size="T200" truncate className={css.Summary}>
          {counts.join(' · ')}
        </Text>
      )}
      {summary.waiting > 0 && (
        // Outside the muted counts, so its warning color keeps its full contrast.
        <Text as="span" size="T200" truncate className={css.SummaryWaiting}>
          {counts.length > 0 && '· '}
          {t('mindroomUi.backgroundJobs.needApproval', { count: summary.waiting })}
        </Text>
      )}
    </>
  );
}

/** How long the job has run, ticking on the bar's clock; screen readers hear when it started. */
export function JobElapsed({ startedAt, now }: { startedAt: number; now: number }) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const started = useRelativeTime(Number.isFinite(startedAt) ? startedAt : undefined);
  if (!Number.isFinite(startedAt)) return null;
  return (
    <>
      <Text as="span" size="T200" className={css.Elapsed} aria-hidden data-job-elapsed>
        {formatCallDuration((now - startedAt) / 1000, language)}
      </Text>
      <span className={css.VisuallyHidden}>
        {t('mindroomUi.backgroundJobs.started', { time: started })}
      </span>
    </>
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
      onClick={() => navigateRoomThread(room.roomId, threadId)}
      data-job-thread={threadId}
    >
      <Icon src={Icons.Thread} size="50" aria-hidden />
      <Text as="span" size="T200" truncate>
        {title}
      </Text>
    </button>
  );
}

const tokenFormat = (language: string) =>
  new Intl.NumberFormat(language, { notation: 'compact', maximumFractionDigits: 1 });

/** "31 tool calls · 1.9M tokens · $1.30": each part the run has, its sub-agents' not counted. */
const useUsageText = (usage: SubagentUsage | undefined): string | undefined => {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  if (!usage) return undefined;
  const tokens = usage.inputTokens + usage.outputTokens;
  const parts = [
    usage.toolCalls > 0 && t('mindroomUi.backgroundJobs.toolCalls', { count: usage.toolCalls }),
    tokens > 0 &&
      t('mindroomUi.backgroundJobs.tokens', { tokens: tokenFormat(language).format(tokens) }),
    usage.costUsd !== undefined && formatCostUsd(usage.costUsd, language),
  ].filter((part): part is string => !!part);
  return parts.length > 0 ? parts.join(' · ') : undefined;
};

type RowProps = {
  room: Room;
  item: BackgroundJobsBarItem;
  // The view's conversation; a job of another one links to its thread.
  viewThreadId: string | null;
  // The bar's clock, in ms.
  now: number;
  // Shows the job's run in the Sub-agents panel; only for a job whose run the panel has.
  onOpen?: () => void;
  // The job's Stop, or its Stopping.
  stop: ReactNode;
};

/**
 * One listed job, on two lines: who and on what model, its task and status; then what it does now,
 * the thread it runs in when that is not the view's, and what it used. Then how long it has run,
 * Open and Stop. A job without its run's frames shows its name alone, as before.
 */
export function BackgroundJobRow({ room, item, viewThreadId, now, onOpen, stop }: RowProps) {
  const { t } = useTranslation();
  const agent = useAgentProfile(room, item.agent ?? '');
  const meta = item.run?.meta;
  const modelLabel = meta?.model && getAiRunCompactModelLabel(meta.model);
  const task = meta?.task?.split('\n', 1)[0];
  const usage = useUsageText(meta?.usage);
  const elsewhere = item.threadId !== null && item.threadId !== viewThreadId;
  const name = meta ? agent.name : item.name;
  const nested = item.depth > 0;
  return (
    <li
      className={css.Job}
      style={nested ? { paddingInlineStart: `${item.depth * 1.5}rem` } : undefined}
      data-job-kind={item.subagent ? 'subagent' : 'tool'}
      data-job-depth={item.depth}
    >
      <JobLogo room={room} item={item} size={nested ? 20 : 26} />
      <span className={css.JobText}>
        <span className={css.JobLine}>
          <Text as="span" size="T200" truncate className={css.Name} title={item.name}>
            {name}
          </Text>
          {modelLabel && (
            <Badge
              variant="Secondary"
              fill="Soft"
              radii="Pill"
              className={css.ModelPill}
              title={meta?.model && getAiRunModelLabel(meta.model)}
              data-job-model
            >
              <Text as="span" size="L400" truncate>
                {modelLabel}
              </Text>
            </Badge>
          )}
          {task && (
            <Text as="span" size="T200" truncate className={css.Task} title={task} dir="auto">
              {task}
            </Text>
          )}
          {item.waiting && !item.stopping && (
            <Badge variant="Warning" fill="Soft" radii="Pill" className={css.Pill}>
              <Text as="span" size="L400">
                {t('mindroomUi.backgroundJobs.waiting')}
              </Text>
            </Badge>
          )}
          {item.finished && (
            <Badge variant="Secondary" fill="Soft" radii="Pill" className={css.Pill}>
              <Text as="span" size="L400">
                {t('mindroomUi.subagents.completed')}
              </Text>
            </Badge>
          )}
        </span>
        {((item.activity && (item.subagent || item.activity.preview)) || elsewhere || usage) && (
          <span className={css.JobLine}>
            {item.activity && (
              // A tool job's line 1 is its tool already: its line 2 is the call's arguments.
              <span className={css.Activity} data-job-activity>
                {item.subagent && <b>{item.activity.tool}</b>}
                {item.activity.preview && (
                  <code className={css.Preview}>
                    {item.subagent && ' '}
                    {item.activity.preview}
                  </code>
                )}
              </span>
            )}
            {elsewhere && <ThreadChip room={room} threadId={item.threadId!} />}
            {usage && (
              <Text as="span" size="T200" className={css.Stats} data-job-stats>
                {usage}
              </Text>
            )}
          </span>
        )}
      </span>
      <JobElapsed startedAt={item.startedAt} now={now} />
      {onOpen && (
        <button
          type="button"
          className={css.Open}
          aria-label={t('mindroomUi.backgroundJobs.openFor', { name })}
          onClick={onOpen}
          data-job-open
        >
          <Text as="span" size="T200">
            {t('mindroomUi.backgroundJobs.open')}
          </Text>
        </button>
      )}
      {stop}
    </li>
  );
}
