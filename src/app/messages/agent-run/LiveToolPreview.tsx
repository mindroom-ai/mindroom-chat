import { useContext, useId, useRef, useState, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Icons, Spinner } from 'folds';
import { useStore } from 'jotai';
import { toToolArgumentFields, valueText } from '../../approvals/argumentFields';
import { useAppLanguageCode } from '../../i18n/useAppLanguageCode';
import { useLiveClock } from '../../lib/hooks/useLiveClock';
import { formatWorkDuration } from '../../lib/time';
import type { SubagentStatus } from '../../matrix/protocol/subagentFrame';
import { toolEndedAt, toolStartedAt } from '../../matrix/protocol/toolTrace';
import { openSubagentsPanel } from '../../navigation/subagentsPanel';
import { ownDirectionLine, revealDirectionControls } from '../../ui/directional';
import { useRevealOnOpen } from '../../ui/disclosureReveal';
import * as activityCss from '../../ui/ThreadActivity.css';
import {
  findLinkedSubagentRun,
  useRoomSubagentRuns,
  type SubagentRun,
} from '../live/subagentRunStore';
import {
  TOOL_STATE_ICON,
  ToolCallClockContext,
  ToolCallWaitingStatusContext,
  type ToolCallState,
  type ToolCallWaitingStatus,
} from './toolCallStatus';
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

type StepState = Extract<ToolCallState, 'running' | 'waiting' | 'done' | 'failed'>;
type TerminalLines = keyof typeof css.LIVE_OUTPUT_LINES;
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

const SUBAGENT_STEP_LIMIT = 4;
const FALLBACK_OUTPUT_LINES = 6;
// Unlike `KEY_ORDER` in argumentFields.ts (which leads with approval/messaging keys like `to`/`room`),
// live step rows lead with execution targets (commands, file paths, search patterns, URLs).
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

const stepStatusLabelKey = (state: StepState, waitingStatus: ToolCallWaitingStatus = 'paused') => {
  switch (state) {
    case 'running':
      return 'mindroomUi.subagents.running';
    case 'waiting':
      return waitingStatus === 'awaiting_approval'
        ? 'mindroomUi.subagents.awaiting_approval'
        : 'mindroomUi.subagents.paused';
    case 'done':
      return 'mindroomUi.subagents.completed';
    case 'failed':
      return 'mindroomUi.messages.mindroomHtmlBlocks.toolCallFailed';
  }
};

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

/** Extracts one concise single-line primary argument from `args_preview`, preferring target keys. */
export const extractPrimaryArg = (argsPreview: string | undefined): string | undefined => {
  const trimmed = argsPreview?.trim();
  if (!trimmed) return undefined;
  const parsed = toToolArgumentFields(trimmed);
  if ('fields' in parsed) {
    for (const key of PRIMARY_ARG_KEYS) {
      const match = parsed.fields.find((field) => field.key.toLowerCase() === key);
      const text = match && valueText(match.value).replace(/\s+/g, ' ').trim();
      if (text) return text;
    }
  }
  return revealDirectionControls(trimmed.replace(/\s+/g, ' ')) || undefined;
};

const unfinishedStepState = (status: SubagentStatus): StepState => {
  if (status === 'running') return 'running';
  if (status === 'paused' || status === 'awaiting_approval') return 'waiting';
  return status === 'completed' ? 'done' : 'failed';
};

const recentSubagentSteps = (run: SubagentRun): SubagentStep[] => {
  const unfinishedState = unfinishedStepState(run.meta.status);
  return run.docs.tools
    .flatMap((event, key) => {
      const rawName = typeof event.tool_name === 'string' ? event.tool_name.trim() : '';
      return rawName ? [{ event, key, toolName: revealDirectionControls(rawName) }] : [];
    })
    .slice(-SUBAGENT_STEP_LIMIT)
    .map(({ event, key, toolName }) => {
      const state: StepState =
        event.type === 'tool_call_started'
          ? unfinishedState
          : event.is_error === true
            ? 'failed'
            : 'done';
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
        output:
          state === 'running' || state === 'waiting'
            ? normalizeToolOutput(event.progress)
            : undefined,
      };
    });
};

/** Leaf timer so 1-second ticks only re-render the elapsed text of actively running steps. */
function LiveStepElapsed({
  state,
  startedAt,
  endedAt,
  language,
}: {
  state: StepState;
  startedAt?: number;
  endedAt?: number;
  language: string;
}) {
  const { t } = useTranslation();
  const sharedNow = useContext(ToolCallClockContext);
  const localNow = useLiveClock(
    state === 'running' && startedAt !== undefined && sharedNow === undefined
  );

  if (startedAt === undefined || state === 'waiting') return null;
  let duration: string | undefined;
  if (state === 'running') {
    if (sharedNow === null) return null;
    duration = formatWorkDuration((sharedNow ?? localNow) - startedAt * 1000, language);
  } else if (endedAt !== undefined && endedAt >= startedAt) {
    duration = formatWorkDuration(Math.max(1_000, (endedAt - startedAt) * 1000), language);
  }
  if (!duration) return null;

  return (
    <span
      className={css.StepElapsed}
      title={
        state === 'running'
          ? t('mindroomUi.messages.mindroomHtmlBlocks.toolRunningFor', { duration })
          : undefined
      }
      data-live-step-elapsed=""
    >
      {duration}
    </span>
  );
}

function TerminalWell({
  lines,
  output,
  id,
  wellRef,
}: {
  lines: TerminalLines;
  output: string;
  id?: string;
  wellRef?: Ref<HTMLDivElement>;
}) {
  return (
    <div ref={wellRef} id={id} className={css.TerminalWell}>
      <pre className={css.TerminalOutput[lines]} data-live-output="">
        {tailLines(output, css.LIVE_OUTPUT_LINES[lines])}
      </pre>
    </div>
  );
}

function LiveStepRow({
  state,
  waitingStatus,
  toolName,
  arg,
  startedAt,
  endedAt,
  output,
  outputLines = 'subagent',
}: {
  state: StepState;
  waitingStatus?: ToolCallWaitingStatus;
  toolName: string;
  arg?: string;
  startedAt?: number;
  endedAt?: number;
  output?: string;
  outputLines?: TerminalLines;
}) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const [open, setOpen] = useState(true);
  const outputId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const armReveal = useRevealOnOpen(open, toggleRef, outputRef);
  const statusLabel = t(stepStatusLabelKey(state, waitingStatus));
  const stepNameClass = css.StepName[state === 'running' || state === 'waiting' ? 'active' : state];

  const content = (
    <>
      <span className={css.StepIcon[state]} role="img" aria-label={statusLabel} title={statusLabel}>
        {state === 'running' ? (
          <Spinner size="50" variant="Secondary" aria-hidden />
        ) : (
          <Icon size="50" src={TOOL_STATE_ICON[state].src} aria-hidden />
        )}
      </span>
      <span className={stepNameClass}>{toolName}</span>
      {arg && (
        <span className={css.StepArg} title={arg} {...ownDirectionLine}>
          {arg}
        </span>
      )}
      <LiveStepElapsed state={state} startedAt={startedAt} endedAt={endedAt} language={language} />
    </>
  );

  return (
    <div className={css.Step} data-live-step={state}>
      {(state === 'running' || state === 'waiting') && output ? (
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
            <TerminalWell wellRef={outputRef} id={outputId} lines={outputLines} output={output} />
          )}
        </>
      ) : (
        <div className={css.StepRow}>{content}</div>
      )}
    </div>
  );
}

function SubagentPreviewCard({ tool, run }: { tool: LiveToolItem; run: SubagentRun }) {
  const { t } = useTranslation();
  const jotaiStore = useStore();
  const steps = recentSubagentSteps(run);
  const title = revealDirectionControls(run.meta.title || run.meta.agent);
  const callCount = run.meta.usage?.toolCalls ?? run.docs.tools.length;
  const waitingStatus: ToolCallWaitingStatus =
    run.meta.status === 'awaiting_approval' ? 'awaiting_approval' : 'paused';
  const trimmed = tool.progress?.trim();
  const fallbackOutput =
    steps.length === 0 &&
    tool.progress &&
    trimmed &&
    trimmed !== title &&
    trimmed !== run.meta.agent
      ? tool.progress
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
          onClick={() => openSubagentsPanel(jotaiStore, run.roomId, run.meta.threadId, run.run)}
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
              waitingStatus={waitingStatus}
              toolName={step.toolName}
              arg={step.arg}
              startedAt={step.startedAt}
              endedAt={step.endedAt}
              output={step.output}
              outputLines="subagent"
            />
          ))}
        </div>
      )}
      {fallbackOutput && <TerminalWell lines="subagent" output={fallbackOutput} />}
    </div>
  );
}

/**
 * Structured live preview under `Running N tool calls`: linked sub-agent step cards, immediate
 * foreground shell/bash rows, and a compact fallback for other running calls reporting progress.
 * Subscribes to `SubagentRunStore` only while a running sub-agent call with a call ID is shown,
 * keeping a single stable component tree so parallel rows never lose local UI state.
 */
export function LiveToolPreview({ running, roomId, threadId }: LiveToolPreviewProps) {
  const clockContext = useContext(ToolCallClockContext);
  const waitingStatus = useContext(ToolCallWaitingStatusContext);
  const shellState: StepState =
    clockContext === null || waitingStatus !== undefined ? 'waiting' : 'running';
  const needsSubagents =
    !!roomId && running.some((tool) => !!tool.toolCallId && isSubagentTool(tool.toolName));
  const subagentRuns = useRoomSubagentRuns(needsSubagents ? roomId : undefined);
  const items = running.flatMap((tool) => {
    if (roomId && isSubagentTool(tool.toolName)) {
      const run = findLinkedSubagentRun(subagentRuns, tool.toolCallId, threadId);
      if (run)
        return [<SubagentPreviewCard key={`subagent-${tool.index}`} tool={tool} run={run} />];
    }
    if (isShellTool(tool.toolName)) {
      return [
        <div key={`shell-${tool.index}`} className={css.Card} data-live-shell={tool.index}>
          <LiveStepRow
            state={shellState}
            waitingStatus={waitingStatus}
            toolName={tool.toolName}
            arg={extractPrimaryArg(tool.argsPreview)}
            startedAt={tool.startedAt}
            output={tool.progress}
            outputLines="shell"
          />
        </div>,
      ];
    }
    if (!tool.progress) return [];
    return [
      <div key={`fallback-${tool.index}`}>
        {running.length > 1 && <div className={activityCss.OutputLabel}>{tool.command}</div>}
        <pre className={activityCss.Output}>{tailLines(tool.progress, FALLBACK_OUTPUT_LINES)}</pre>
      </div>,
    ];
  });
  if (items.length === 0) return null;

  return (
    <div className={css.Stack} data-live-tool-preview="">
      {items}
    </div>
  );
}
