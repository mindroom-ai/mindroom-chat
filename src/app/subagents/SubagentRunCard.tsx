import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { Room } from 'matrix-js-sdk';
import { Text } from 'folds';
import { getLocalizedThreadMessagePreviewText } from '../event-store/threads/threadMessagePreview';
import { useAppLanguageCode } from '../i18n/useAppLanguageCode';
import { useRelativeTime } from '../i18n/useRelativeTime';
import { formatWorkDuration } from '../lib/time';
import type { LiveDocs } from '../matrix/protocol/liveFrame';
import {
  isActiveSubagentStatus,
  isFailedRun,
  isRestartInterrupted,
  type SubagentMeta,
} from '../matrix/protocol/subagentFrame';
import { getAiRunCompactModelLabel, getAiRunModelLabel } from '../matrix/protocol/aiRunModelLabel';
import type { SubagentRun } from '../messages/live/subagentRunStore';
import { useAgentProfile } from './AgentAvatar';
import { RunLogo, runLogoState } from './RunLogo';
import { type RunLine, type ToolActivity, runLine } from './runActivity';
import { runTotals, usageTexts } from './runUsage';
import * as css from './subagentsPanel.css';

/** One turn of a sub-agent, a run of its own, and the sub-agents that turn started. */
export type SubagentTurn = { run: SubagentRun; nested: SubagentNode[] };

/**
 * A sub-agent: its turns, the first on top, and the sub-agent that started it while that one is
 * listed too.
 */
export type SubagentNode = {
  id: string;
  parent: string | null;
  turns: [SubagentTurn, ...SubagentTurn[]];
};

/** The sub-agent's newest turn, which says how it stands. */
export const latestTurn = ({ turns }: SubagentNode): SubagentRun =>
  (turns[turns.length - 1] ?? turns[0]).run;

/**
 * How the run stands: a dot in the status's color, then its word. A turn a restart cut short reads
 * as interrupted, not failed, since MindRoom may continue it. `loud` gives a run that waits for
 * approval the word in the dot's color too, as the jobs bar's pill does.
 */
export function RunStatus({ meta, loud = false }: { meta: SubagentMeta; loud?: boolean }) {
  const { t } = useTranslation();
  const status = isRestartInterrupted(meta) ? 'interrupted' : meta.status;
  return (
    <span className={loud && status === 'awaiting_approval' ? css.StatusLoud : css.Status}>
      <span className={css.StatusDot[status]} />
      {t(`mindroomUi.subagents.${status}`)}
    </span>
  );
}

/** How long the run has been at it, or took; unknown for an ended run without an end time. */
export const elapsedSeconds = (meta: SubagentMeta, now: number): number | undefined => {
  if (isActiveSubagentStatus(meta.status)) return now / 1000 - meta.startedAt;
  return meta.endedAt === null ? undefined : meta.endedAt - meta.startedAt;
};

/**
 * How long the run has been at it or took, as the jobs bar says it ("24m 12s"); an ended run
 * without an end time says how long ago it ended.
 */
export const useRunTime = (meta: SubagentMeta, now: number): string => {
  const language = useAppLanguageCode();
  const elapsed = elapsedSeconds(meta, now);
  const ago = useRelativeTime(elapsed === undefined ? meta.startedAt * 1000 : undefined, 'compact');
  return elapsed === undefined ? ago : formatWorkDuration(elapsed * 1000, language);
};

const previewText = (text: string, t: TFunction): string | undefined =>
  getLocalizedThreadMessagePreviewText({ msgtype: 'm.text', body: text }, t);

/**
 * A run that ended badly, or that a restart cut short, says why; any other says what it wrote, as a thread card
 * previews it.
 */
const runPreview = (meta: SubagentMeta, docs: LiveDocs, t: TFunction): string | undefined => {
  const failed = meta.status === 'failed' || meta.status === 'denied';
  const text = failed && meta.result ? meta.result : docs.md || meta.result;
  return text ? previewText(text, t) : undefined;
};

/** The line a card shows for its run (`runLine`), with the texts it needs. */
const useRunLine = (run: SubagentRun): { line: RunLine; failed: boolean } => {
  const { t } = useTranslation();
  const { meta, docs } = run;
  const reason = meta.result?.trim() ? previewText(meta.result, t) : undefined;
  return { line: runLine(run, runPreview(meta, docs, t), reason), failed: isFailedRun(meta) };
};

/** A call as a card's line shows it: the tool in the code font, then its arguments, muted. */
export function ToolCallText({ activity }: { activity: ToolActivity }) {
  return (
    <span className={css.ToolCall} data-subagent-tool="">
      <span className={css.ToolName}>{activity.tool}</span>
      {activity.preview && (
        <>
          {' '}
          <span className={css.ToolArgs}>{activity.preview}</span>
        </>
      )}
    </span>
  );
}

/** How each kind of third line is labelled: its words, the mark before them, and their tone. */
const LINE_LOOKS = {
  now: { label: 'mindroomUi.subagents.now', mark: '', tone: 'now' },
  approval: { label: 'mindroomUi.subagents.needsApproval', mark: '!', tone: 'approval' },
  result: { label: 'mindroomUi.subagents.result', mark: '✓', tone: 'result' },
  cancelled: { label: 'mindroomUi.subagents.cancelled', mark: '✕', tone: 'ended' },
  failed: { label: 'mindroomUi.subagents.failed', mark: '✕', tone: 'ended' },
  denied: { label: 'mindroomUi.subagents.denied', mark: '✕', tone: 'ended' },
  interrupted: { label: 'mindroomUi.subagents.interrupted', mark: '', tone: 'result' },
} as const satisfies Record<
  string,
  { label: string; mark: string; tone: keyof typeof css.LineLabel }
>;

/** What follows a line's label: the call, the start of what the run wrote, or why it ended. */
function LineRest({ line }: { line: Exclude<RunLine, { kind: 'plain' }> }) {
  if (line.kind === 'now' || line.kind === 'approval')
    return <ToolCallText activity={line.activity} />;
  const text = line.kind === 'result' ? line.text : line.reason;
  return text ? (
    <span className={css.LineText} dir="auto">
      {text}
    </span>
  ) : null;
}

/**
 * A card's third line, labelled by what it shows: Now and the call it makes, Needs approval and
 * the call that waits, Result and the start of what it wrote, or how it ended and why. Without
 * any (older MindRoom) it is the text line it was, unlabelled.
 */
function RunLineText({ run }: { run: SubagentRun }) {
  const { t } = useTranslation();
  const { line, failed } = useRunLine(run);
  if (line.kind === 'plain') {
    return (
      <Text
        as="span"
        size="T200"
        priority={failed ? undefined : '300'}
        className={failed ? css.PreviewFailed : css.Line}
        dir="auto"
        truncate
        data-subagent-line="plain"
      >
        {line.text ?? ' '}
      </Text>
    );
  }
  const { label, mark, tone } = LINE_LOOKS[line.kind === 'ended' ? line.status : line.kind];
  return (
    <Text as="span" size="T200" className={css.Line} data-subagent-line={line.kind}>
      <span className={css.LineLabel[tone]}>
        {line.kind === 'now' && <span className={css.Tick} aria-hidden />}
        {mark && (
          <span className={css.LineMark} aria-hidden>
            {mark}
          </span>
        )}
        {t(label)}
      </span>
      <LineRest line={line} />
    </Text>
  );
}

/** A sub-agent's calls, tokens and cost over all its turns (`runTotals`), each left out while unknown, then its time. */
function RunStats({ node, now }: { node: SubagentNode; now: number }) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const time = useRunTime(latestTurn(node).meta, now);
  const texts = usageTexts(runTotals(node.turns.map(({ run }) => run.meta.usage)), t, language);
  return (
    <Text as="span" size="T200" priority="300" className={css.Stats}>
      {(['calls', 'tokens', 'cost'] as const).map((key) => {
        const text = texts[key];
        return (
          text && (
            <span key={key} data-subagent-stat={key}>
              {text.labelled}
            </span>
          )
        );
      })}
      <span className={css.StatsTime} data-subagent-time="">
        {time}
      </span>
    </Text>
  );
}

/** A turn's title: the one its call named, else its task's first line, else its agent. */
export const turnTitle = (meta: SubagentMeta, agentName: string): string =>
  meta.title || meta.task?.split('\n', 1)[0] || agentName;

/** A run's title: its first turn's. */
export const nodeTitle = (node: SubagentNode, agentName: string): string =>
  turnTitle(node.turns[0].run.meta, agentName);

/**
 * A sub-agent another one started, inside its card: on an elbow from it, its logo, title, and its
 * time or that it waits for approval, then its labelled line.
 */
function NestedRun({ room, node, now }: { room: Room; node: SubagentNode; now: number }) {
  const run = latestTurn(node);
  const { meta } = run;
  const agent = useAgentProfile(room, meta.agent);
  const time = useRunTime(meta, now);
  const first = node.turns[0].run.meta;
  return (
    <span className={css.NestedRun} data-subagent-nested={node.id}>
      <RunLogo
        model={meta.model}
        agent={agent}
        kind="agent"
        state={runLogoState(meta)}
        small
        className={css.NestedLogo}
      />
      <Text
        as="span"
        size="T200"
        className={css.NestedTitle}
        title={first.task}
        dir="auto"
        truncate
      >
        {nodeTitle(node, agent.name)}
      </Text>
      <Text as="span" size="T200" priority="300" className={css.NestedTime}>
        {meta.status === 'awaiting_approval' ? <RunStatus meta={meta} loud /> : time}
      </Text>
      <span className={css.NestedLine}>
        <RunLineText run={run} />
      </span>
    </span>
  );
}

type CardProps = {
  room: Room;
  node: SubagentNode;
  /** The panel's clock, in Unix milliseconds. */
  now: number;
  onOpen: (subagent: string) => void;
};

/**
 * One sub-agent as the jobs bar shows a job: its model's logo with a dot for how it stands, the
 * title its first turn's call named (else that turn's task) in bold, then the agent, the model its
 * newest turn ran on, how it stands and how many turns it took, then a line labelled by what it
 * shows (`RunLineText`). The sub-agents it started follow inside it, then what it used and its
 * time. Pressing it opens the sub-agent.
 */
export const SubagentRunCard = memo(function SubagentRunCard({
  room,
  node,
  now,
  onOpen,
}: CardProps) {
  const { t } = useTranslation();
  const run = latestTurn(node);
  const { meta } = run;
  const nested = node.turns.flatMap((turn) => turn.nested);
  const agent = useAgentProfile(room, meta.agent);
  const modelLabel = meta.model && getAiRunCompactModelLabel(meta.model);
  const first = node.turns[0].run.meta;

  return (
    <button
      type="button"
      className={css.Card}
      data-subagent={node.id}
      onClick={() => onOpen(node.id)}
    >
      <RunLogo
        model={meta.model}
        agent={agent}
        kind="agent"
        state={runLogoState(meta)}
        className={css.CardLogo}
      />
      <span className={css.CardText}>
        <Text as="span" size="T300" className={css.Title} title={first.task} dir="auto" truncate>
          {nodeTitle(node, agent.name)}
        </Text>
        <Text as="span" size="T200" className={css.Meta}>
          <span className={css.AgentName}>{agent.name}</span>
          {modelLabel && (
            <span
              className={css.Model}
              title={meta.model && getAiRunModelLabel(meta.model)}
              data-subagent-model=""
            >
              {modelLabel}
            </span>
          )}
          <RunStatus meta={meta} loud />
          {node.turns.length > 1 && (
            <span className={css.Counts}>
              {t('mindroomUi.subagents.turns', { count: node.turns.length })}
            </span>
          )}
        </Text>
        <RunLineText run={run} />
      </span>
      {nested.map((child) => (
        <NestedRun key={child.id} room={room} node={child} now={now} />
      ))}
      <RunStats node={node} now={now} />
    </button>
  );
});
