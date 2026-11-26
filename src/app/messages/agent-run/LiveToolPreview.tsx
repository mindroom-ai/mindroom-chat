import { useContext, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Icons, Spinner } from 'folds';
import { useStore } from 'jotai';
import { toToolArgumentFields, type ArgumentValue } from '../../approvals/argumentFields';
import { useAppLanguageCode } from '../../i18n/useAppLanguageCode';
import { useInterval } from '../../lib/hooks/useInterval';
import { formatWorkDuration } from '../../lib/time';
import { useOptionalMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { isActiveSubagentStatus } from '../../matrix/protocol/subagentFrame';
import { toolEndedAt, toolStartedAt } from '../../matrix/protocol/toolTrace';
import { openSubagentsPanel } from '../../navigation/subagentsPanel';
import { ownDirectionLine, revealDirectionControls } from '../../ui/directional';
import { useRevealOnOpen } from '../../ui/disclosureReveal';
import * as activityCss from '../../ui/ThreadActivity.css';
import { useRoomSubagentRuns, type SubagentRun } from '../live/subagentRunStore';
import { ToolCallClockContext } from './toolCallStatus';
import * as css from './LiveToolPreview.css';

export type LiveToolItem = {
  index: number;
  toolName: string;
  command: string;
  argsPreview?: string;
  toolCallId?: string;
  progress?: string;
  startedAt?: number;
};

type StepState = 'running' | 'done' | 'failed';
type LiveToolPreviewProps = {
  running: readonly LiveToolItem[];
  roomId?: string;
  threadId?: string;
};
type SubagentStep = {
  key: number;
  state: StepState;
  toolName: string;
  arg?: string;
  startedAt?: number;
  endedAt?: number;
  output?: string;
};

const LIVE_CLOCK_MS = 1_000;
const SUBAGENT_STEP_LIMIT = 4;
const SUBAGENT_OUTPUT_LINES = 3;
const SHELL_OUTPUT_LINES = 4;
const FALLBACK_OUTPUT_LINES = 6;
const PRIMARY_ARG_KEYS = [
  'command',
  'args',
  'path',
  'file_path',
  'file_name',
  'query',
  'pattern',
  'url',
] as const;

const isShellTool = (name: string): boolean => name === 'run_shell_command' || name === 'bash';
const isSubagentTool = (name: string): boolean =>
  name === 'run_subagent' || name === 'continue_subagent';

// Output drops leading blank lines but keeps its first line's indentation, as in YAML or a tree listing.
export const normalizeToolOutput = (value: unknown): string | undefined =>
  typeof value === 'string'
    ? revealDirectionControls(value.replace(/^(?:[ \t\r]*\n)+/, '').trimEnd()) || undefined
    : undefined;

const tailLines = (text: string, maxLines: number): string =>
  text.split('\n').slice(-maxLines).join('\n');

const flattenArgValue = (value: ArgumentValue): string =>
  (value.kind === 'nested'
    ? value.fields.map((field) => `${field.key}: ${flattenArgValue(field.value)}`).join(', ')
    : value.text
  )
    .replace(/\s+/g, ' ')
    .trim();

/** Extracts one concise single-line primary argument from `args_preview`, preferring target keys. */
export const extractPrimaryArg = (argsPreview: string | undefined): string | undefined => {
  const trimmed = argsPreview?.trim();
  if (!trimmed) return undefined;
  const parsed = toToolArgumentFields(trimmed);
  if ('fields' in parsed) {
    for (const key of PRIMARY_ARG_KEYS) {
      const match = parsed.fields.find((field) => field.key.toLowerCase() === key);
      const text = match && flattenArgValue(match.value);
      if (text) return text;
    }
  }
  return revealDirectionControls(trimmed.replace(/\s+/g, ' ')) || undefined;
};

/** Finds the room's sub-agent run linked to a parent reply's tool call in the same conversation. */
export const findLinkedSubagentRun = (
  runs: readonly SubagentRun[],
  toolCallId: string | undefined,
  threadId: string | undefined
): SubagentRun | undefined => {
  if (!toolCallId) return undefined;
  const expectedThread = threadId ?? null;
  const matches = runs.filter(
    ({ meta }) => meta.callerToolCallId === toolCallId && meta.threadId === expectedThread
  );
  return matches.sort(
    (a, b) =>
      Number(isActiveSubagentStatus(b.meta.status)) -
        Number(isActiveSubagentStatus(a.meta.status)) || b.meta.startedAt - a.meta.startedAt
  )[0];
};

/**
 * Current Unix milliseconds while `active` is true: reuses `ToolCallClockContext` when provided
 * (as in `SubagentRunView`), otherwise ticks every second only while active. Zero timers when idle.
 */
export const useLiveToolClock = (active: boolean): number | undefined => {
  const sharedNow = useContext(ToolCallClockContext);
  const [tick, setTick] = useState(0);
  useInterval(
    () => setTick((count) => count + 1),
    active && sharedNow === undefined ? LIVE_CLOCK_MS : -1
  );
  if (!active) return undefined;
  void tick;
  return sharedNow ?? Date.now();
};

const recentSubagentSteps = (run: SubagentRun): SubagentStep[] => {
  const runActive = isActiveSubagentStatus(run.meta.status);
  const failedRun =
    run.meta.status === 'failed' || run.meta.status === 'cancelled' || run.meta.status === 'denied';
  return run.docs.tools
    .flatMap((event, key) => {
      const rawName = typeof event.tool_name === 'string' ? event.tool_name.trim() : '';
      return rawName ? [{ event, key, toolName: revealDirectionControls(rawName) }] : [];
    })
    .slice(-SUBAGENT_STEP_LIMIT)
    .map(({ event, key, toolName }) => {
      const state: StepState =
        event.type === 'tool_call_started'
          ? runActive
            ? 'running'
            : failedRun
              ? 'failed'
              : 'done'
          : event.is_error === true
            ? 'failed'
            : 'done';
      const rawOutput = state === 'running' ? normalizeToolOutput(event.progress) : undefined;
      return {
        key,
        state,
        toolName,
        arg:
          typeof event.args_preview === 'string'
            ? extractPrimaryArg(event.args_preview)
            : undefined,
        startedAt: toolStartedAt(event),
        endedAt: toolEndedAt(event),
        output: rawOutput ? tailLines(rawOutput, SUBAGENT_OUTPUT_LINES) : undefined,
      };
    });
};

const formatStepDuration = (
  state: StepState,
  startedAt: number | undefined,
  endedAt: number | undefined,
  now: number | undefined,
  language: string
): string | undefined => {
  if (startedAt === undefined) return undefined;
  if (state === 'running') {
    return now === undefined
      ? undefined
      : formatWorkDuration(Math.max(0, now - startedAt * 1000), language);
  }
  return endedAt !== undefined && endedAt >= startedAt
    ? formatWorkDuration(Math.max(1_000, (endedAt - startedAt) * 1000), language)
    : undefined;
};

function LiveStepRow({
  state,
  toolName,
  arg,
  duration,
  output,
}: {
  state: StepState;
  toolName: string;
  arg?: string;
  duration?: string;
  output?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const outputId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const outputRef = useRef<HTMLPreElement>(null);
  const armReveal = useRevealOnOpen(open, toggleRef, outputRef);
  const failedLabel = t('mindroomUi.messages.mindroomHtmlBlocks.toolCallFailed');
  const durationTitle =
    state === 'running' && duration
      ? t('mindroomUi.messages.mindroomHtmlBlocks.toolRunningFor', { duration })
      : undefined;

  const content = (
    <>
      {state === 'failed' ? (
        <span
          className={css.StepIcon.failed}
          role="img"
          aria-label={failedLabel}
          title={failedLabel}
        >
          <Icon size="50" src={Icons.Warning} aria-hidden />
        </span>
      ) : (
        <span className={css.StepIcon[state]} aria-hidden>
          {state === 'running' ? (
            <Spinner size="50" variant="Secondary" />
          ) : (
            <Icon size="50" src={Icons.Check} />
          )}
        </span>
      )}
      <span className={css.StepName[state]}>{toolName}</span>
      {arg && (
        <span className={css.StepArg} title={arg} {...ownDirectionLine}>
          {arg}
        </span>
      )}
      {duration && (
        <span className={css.StepElapsed} title={durationTitle} data-live-step-elapsed="">
          {duration}
        </span>
      )}
    </>
  );

  return (
    <div className={css.Step} data-live-step={state}>
      {state === 'running' && output ? (
        <>
          <button
            ref={toggleRef}
            type="button"
            className={css.StepRowButton}
            aria-expanded={open}
            aria-controls={outputId}
            onClick={() => {
              if (!open) armReveal();
              setOpen((value) => !value);
            }}
          >
            {content}
          </button>
          {open && (
            <pre ref={outputRef} id={outputId} className={css.TerminalWell} data-live-output="">
              {output}
            </pre>
          )}
        </>
      ) : (
        <div className={css.StepRow}>{content}</div>
      )}
    </div>
  );
}

function SubagentPreviewCard({
  tool,
  run,
  steps,
  roomId,
  now,
}: {
  tool: LiveToolItem;
  run: SubagentRun;
  steps: readonly SubagentStep[];
  roomId: string;
  now: number | undefined;
}) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const jotaiStore = useStore();
  const title = revealDirectionControls(run.meta.title || run.meta.agent);
  const callCount = run.meta.usage?.toolCalls ?? run.docs.tools.length;
  const trimmed = tool.progress?.trim();
  const fallbackOutput =
    steps.length === 0 &&
    tool.progress &&
    trimmed &&
    trimmed !== title &&
    trimmed !== run.meta.agent
      ? tailLines(tool.progress, SUBAGENT_OUTPUT_LINES)
      : undefined;

  return (
    <div className={css.Card} data-live-subagent={run.meta.subagent}>
      <div className={css.CardHeader}>
        <span className={css.CardTitle} title={title} {...ownDirectionLine}>
          {title}
        </span>
        {callCount > 0 && (
          <span className={css.CardCount} data-live-subagent-count="">
            <span aria-hidden>·</span> {t('mindroomUi.subagents.calls', { count: callCount })}
          </span>
        )}
        <button
          type="button"
          className={css.OpenButton}
          aria-label={t('mindroomUi.subagents.showFor', { name: title })}
          onClick={() => openSubagentsPanel(jotaiStore, roomId, run.meta.threadId, run.run)}
          data-live-subagent-open=""
        >
          <span>{t('mindroomUi.subagents.title')}</span>
          <Icon size="50" src={Icons.External} aria-hidden />
        </button>
      </div>
      {steps.length > 0 && (
        <div className={css.Steps}>
          {steps.map((step) => (
            <LiveStepRow
              key={step.key}
              state={step.state}
              toolName={step.toolName}
              arg={step.arg}
              duration={formatStepDuration(step.state, step.startedAt, step.endedAt, now, language)}
              output={step.output}
            />
          ))}
        </div>
      )}
      {fallbackOutput && (
        <pre className={css.TerminalWell} data-live-output="">
          {fallbackOutput}
        </pre>
      )}
    </div>
  );
}

type PreviewEntry =
  | {
      kind: 'subagent';
      tool: LiveToolItem;
      run: SubagentRun;
      steps: SubagentStep[];
      roomId: string;
    }
  | { kind: 'shell'; tool: LiveToolItem }
  | { kind: 'fallback'; tool: LiveToolItem; progress: string };

function LiveToolPreviewList({
  running,
  roomId,
  threadId,
  subagentRuns,
}: LiveToolPreviewProps & { subagentRuns?: readonly SubagentRun[] }) {
  const language = useAppLanguageCode();
  const entries = running.flatMap((tool): PreviewEntry[] => {
    if (roomId && subagentRuns && isSubagentTool(tool.toolName)) {
      const run = findLinkedSubagentRun(subagentRuns, tool.toolCallId, threadId);
      if (run) return [{ kind: 'subagent', tool, run, steps: recentSubagentSteps(run), roomId }];
    }
    if (isShellTool(tool.toolName)) return [{ kind: 'shell', tool }];
    return tool.progress ? [{ kind: 'fallback', tool, progress: tool.progress }] : [];
  });
  const needsClock = entries.some(
    (entry) =>
      (entry.kind === 'shell' && entry.tool.startedAt !== undefined) ||
      (entry.kind === 'subagent' &&
        entry.steps.some((step) => step.state === 'running' && step.startedAt !== undefined))
  );
  const now = useLiveToolClock(needsClock);
  if (entries.length === 0) return null;

  return (
    <div className={css.Stack} data-live-tool-preview="">
      {entries.map((entry) => {
        if (entry.kind === 'subagent') {
          return (
            <SubagentPreviewCard
              key={`subagent-${entry.tool.index}`}
              tool={entry.tool}
              run={entry.run}
              steps={entry.steps}
              roomId={entry.roomId}
              now={now}
            />
          );
        }
        if (entry.kind === 'shell') {
          const { tool } = entry;
          return (
            <div key={`shell-${tool.index}`} className={css.Card} data-live-shell={tool.index}>
              <LiveStepRow
                state="running"
                toolName={tool.toolName}
                arg={extractPrimaryArg(tool.argsPreview)}
                duration={formatStepDuration('running', tool.startedAt, undefined, now, language)}
                output={tool.progress ? tailLines(tool.progress, SHELL_OUTPUT_LINES) : undefined}
              />
            </div>
          );
        }
        return (
          <div key={`fallback-${entry.tool.index}`}>
            <div className={activityCss.OutputLabel}>{entry.tool.command}</div>
            <pre className={activityCss.Output}>
              {tailLines(entry.progress, FALLBACK_OUTPUT_LINES)}
            </pre>
          </div>
        );
      })}
    </div>
  );
}

function LiveToolPreviewWithSubagents(props: LiveToolPreviewProps & { roomId: string }) {
  const runs = useRoomSubagentRuns(props.roomId);
  return <LiveToolPreviewList {...props} subagentRuns={runs} />;
}

/**
 * Structured live preview under `Running N tool calls`: linked sub-agent step cards, immediate
 * foreground shell/bash rows, and a compact fallback for other running calls reporting progress.
 * Subscribes to `SubagentRunStore` only while a running sub-agent call with a call ID is shown.
 */
export function LiveToolPreview({ running, roomId, threadId }: LiveToolPreviewProps) {
  const mx = useOptionalMatrixClient();
  const needsSubagents =
    !!roomId && !!mx && running.some((tool) => !!tool.toolCallId && isSubagentTool(tool.toolName));
  return needsSubagents ? (
    <LiveToolPreviewWithSubagents running={running} roomId={roomId} threadId={threadId} />
  ) : (
    <LiveToolPreviewList running={running} />
  );
}
