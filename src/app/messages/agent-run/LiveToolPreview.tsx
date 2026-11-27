import { useContext, useEffect, useId, useRef, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Icons, Spinner } from 'folds';
import { useStore } from 'jotai';
import {
  toToolArgumentFields,
  valueText,
  type ArgumentFields,
} from '../../approvals/argumentFields';
import { useAppLanguageCode } from '../../i18n/useAppLanguageCode';
import { copyToClipboard } from '../../lib/dom';
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
  sender?: string;
};
type SubagentStep = {
  key: string;
  state: StepState;
  toolName: string;
  arg?: string;
  detailText?: string;
  startedAt?: number;
  endedAt?: number;
  output?: string;
  result?: string;
};

const SUBAGENT_STEP_LIMIT = 4;
const FALLBACK_OUTPUT_LINES = 6;
const COPY_FEEDBACK_MS = 1_500;
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

const findPrimaryArgText = (parsed: ArgumentFields): string | undefined => {
  if (!('fields' in parsed)) return undefined;
  for (const key of PRIMARY_ARG_KEYS) {
    const match = parsed.fields.find((field) => field.key.toLowerCase() === key);
    const text = match && valueText(match.value).trim();
    if (text) return text;
  }
  return undefined;
};

/** Extracts one concise single-line primary argument from `args_preview`, preferring target keys. */
export const extractPrimaryArg = (argsPreview: string | undefined): string | undefined => {
  const trimmed = argsPreview?.trim();
  if (!trimmed) return undefined;
  const primary = findPrimaryArgText(toToolArgumentFields(trimmed));
  if (primary) return primary.replace(/\s+/g, ' ');
  return revealDirectionControls(trimmed.replace(/\s+/g, ' ')) || undefined;
};

const extractStepDetail = (
  toolName: string,
  argsPreview: string | undefined,
  arg: string | undefined
): string | undefined => {
  const trimmed = argsPreview?.trim();
  if (!trimmed) return arg;
  const parsed = toToolArgumentFields(trimmed);
  if (isShellTool(toolName)) {
    return findPrimaryArgText(parsed) ?? (revealDirectionControls(trimmed) || arg);
  }
  if ('fields' in parsed && parsed.fields.length > 1) {
    return revealDirectionControls(trimmed) || arg;
  }
  return findPrimaryArgText(parsed) ?? arg ?? (revealDirectionControls(trimmed) || undefined);
};

const unfinishedStepState = (status: SubagentStatus): StepState => {
  if (status === 'running') return 'running';
  if (status === 'paused' || status === 'awaiting_approval') return 'waiting';
  return status === 'completed' ? 'done' : 'failed';
};

const recentSubagentSteps = (run: SubagentRun): SubagentStep[] => {
  const unfinishedState = unfinishedStepState(run.meta.status);
  const seen = new Map<string, number>();
  return run.docs.tools
    .flatMap((event) => {
      const rawName = typeof event.tool_name === 'string' ? event.tool_name.trim() : '';
      return rawName ? [{ event, toolName: revealDirectionControls(rawName) }] : [];
    })
    .slice(-SUBAGENT_STEP_LIMIT)
    .map(({ event, toolName }) => {
      const state: StepState =
        event.type === 'tool_call_started'
          ? unfinishedState
          : event.is_error === true
            ? 'failed'
            : 'done';
      const rawArgs = typeof event.args_preview === 'string' ? event.args_preview : undefined;
      const arg = extractPrimaryArg(rawArgs);
      const startedAt = toolStartedAt(event);
      const callId = typeof event.tool_call_id === 'string' ? event.tool_call_id.trim() : '';
      const baseKey = callId
        ? startedAt !== undefined
          ? `id:${callId}:${startedAt}`
          : `id:${callId}`
        : startedAt !== undefined
          ? `at:${toolName}:${startedAt}`
          : `step:${toolName}:${arg ?? ''}`;
      const count = seen.get(baseKey) ?? 0;
      seen.set(baseKey, count + 1);
      return {
        key: count === 0 ? baseKey : `${baseKey}#${count}`,
        state,
        toolName,
        arg,
        detailText: extractStepDetail(toolName, rawArgs, arg),
        startedAt,
        endedAt: toolEndedAt(event),
        output:
          state === 'running' || state === 'waiting'
            ? normalizeToolOutput(event.progress)
            : undefined,
        result:
          state === 'done' || state === 'failed'
            ? normalizeToolOutput(event.result_preview)
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

function TerminalWell({ lines, output }: { lines: TerminalLines; output: string }) {
  return (
    <div className={css.TerminalWell}>
      <pre className={css.TerminalOutput[lines]} data-live-output="">
        {tailLines(output, css.LIVE_OUTPUT_LINES[lines])}
      </pre>
    </div>
  );
}

function StepCopyButton({ text }: { text: string }) {
  const { t } = useTranslation();
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const tokenRef = useRef(0);

  useEffect(
    () => () => {
      tokenRef.current += 1;
      clearTimeout(timerRef.current);
    },
    []
  );

  const settle = (token: number, next: 'copied' | 'failed') => {
    if (tokenRef.current !== token) return;
    setCopyState(next);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (tokenRef.current === token) setCopyState('idle');
    }, COPY_FEEDBACK_MS);
  };

  const handleCopy = (event: MouseEvent<HTMLButtonElement>) => {
    const token = (tokenRef.current += 1);
    void copyToClipboard(text, event.currentTarget).then(
      (ok) => settle(token, ok ? 'copied' : 'failed'),
      () => settle(token, 'failed')
    );
  };

  const label =
    copyState === 'copied'
      ? t('messageCodeBlock.copied')
      : copyState === 'failed'
        ? t('featureUi.desktopAccess.browser.copyFailed')
        : t('featureUi.settings.account.matrixId.copy');

  return (
    <button type="button" className={css.CopyButton} data-live-step-copy="" onClick={handleCopy}>
      <span aria-live="polite">{label}</span>
    </button>
  );
}

function LiveStepRow({
  state,
  waitingStatus,
  toolName,
  arg,
  detailText,
  startedAt,
  endedAt,
  output,
  result,
  outputLines = 'subagent',
}: {
  state: StepState;
  waitingStatus?: ToolCallWaitingStatus;
  toolName: string;
  arg?: string;
  detailText?: string;
  startedAt?: number;
  endedAt?: number;
  output?: string;
  result?: string;
  outputLines?: TerminalLines;
}) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const [open, setOpen] = useState(false);
  const drawerId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const armReveal = useRevealOnOpen(open, toggleRef, drawerRef);
  const statusLabel = t(stepStatusLabelKey(state, waitingStatus));
  const stepNameClass = css.StepName[state === 'running' || state === 'waiting' ? 'active' : state];
  const detail = detailText ?? arg;
  const activeOutput = state === 'running' || state === 'waiting' ? output : undefined;
  const stepResult = state === 'done' || state === 'failed' ? result : undefined;
  const expandable = Boolean(detail || activeOutput || stepResult);

  const head = (
    <span className={css.StepHead}>
      <span className={css.StepIcon[state]} role="img" aria-label={statusLabel} title={statusLabel}>
        {state === 'running' ? (
          <Spinner size="50" variant="Secondary" aria-hidden />
        ) : (
          <Icon size="50" src={TOOL_STATE_ICON[state].src} aria-hidden />
        )}
      </span>
      <span className={stepNameClass}>{toolName}</span>
      <LiveStepElapsed state={state} startedAt={startedAt} endedAt={endedAt} language={language} />
      {expandable && (
        <Icon size="50" className={css.StepChevron} src={Icons.ChevronRight} aria-hidden />
      )}
    </span>
  );

  return (
    <div className={css.Step} data-live-step={state}>
      {expandable ? (
        <>
          <button
            ref={toggleRef}
            type="button"
            className={css.StepRowButton}
            aria-expanded={open}
            aria-controls={drawerId}
            onClick={() => {
              if (!open) armReveal();
              setOpen((value) => !value);
            }}
          >
            {head}
            {arg && !open && (
              <span className={css.StepArg} title={arg} {...ownDirectionLine}>
                {arg}
              </span>
            )}
          </button>
          {!open && activeOutput && <TerminalWell lines={outputLines} output={activeOutput} />}
          {open && (
            <div ref={drawerRef} id={drawerId} className={css.Drawer} data-live-step-drawer="">
              {detail && (
                <>
                  <div className={css.DrawerHead}>
                    <span className={css.DrawerLabel}>
                      {t(
                        isShellTool(toolName)
                          ? 'mindroomUi.messages.mindroomHtmlBlocks.stepCommand'
                          : 'mindroomUi.messages.approvalArguments.arguments'
                      )}
                    </span>
                    <StepCopyButton text={detail} />
                  </div>
                  <pre className={css.DrawerCode} data-live-step-command="" {...ownDirectionLine}>
                    {detail}
                  </pre>
                </>
              )}
              {detail && (activeOutput || stepResult) && (
                <div className={css.DrawerDivider} aria-hidden />
              )}
              {activeOutput ? (
                <pre className={css.DrawerOutput} data-live-output="">
                  {activeOutput}
                </pre>
              ) : (
                stepResult && (
                  <pre
                    className={css.DrawerResult[state === 'failed' ? 'failed' : 'done']}
                    data-live-step-result=""
                  >
                    {stepResult}
                  </pre>
                )
              )}
            </div>
          )}
        </>
      ) : (
        <div className={css.StepRow}>{head}</div>
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
              detailText={step.detailText}
              startedAt={step.startedAt}
              endedAt={step.endedAt}
              output={step.output}
              result={step.result}
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
export function LiveToolPreview({ running, roomId, threadId, sender }: LiveToolPreviewProps) {
  const waitingStatus = useContext(ToolCallWaitingStatusContext);
  const shellState: StepState = waitingStatus !== undefined ? 'waiting' : 'running';
  const needsSubagents =
    !!roomId &&
    !!sender &&
    running.some((tool) => !!tool.toolCallId && isSubagentTool(tool.toolName));
  const subagentRuns = useRoomSubagentRuns(needsSubagents ? roomId : undefined);
  const items = running.flatMap((tool) => {
    if (roomId && sender && isSubagentTool(tool.toolName)) {
      const run = findLinkedSubagentRun(subagentRuns, tool.toolCallId, threadId, sender);
      if (run)
        return [<SubagentPreviewCard key={`subagent-${tool.index}`} tool={tool} run={run} />];
    }
    if (isShellTool(tool.toolName)) {
      const arg = extractPrimaryArg(tool.argsPreview);
      return [
        <div key={`shell-${tool.index}`} className={css.Card} data-live-shell={tool.index}>
          <LiveStepRow
            state={shellState}
            waitingStatus={waitingStatus}
            toolName={tool.toolName}
            arg={arg}
            detailText={extractStepDetail(tool.toolName, tool.argsPreview, arg)}
            startedAt={tool.startedAt}
            output={normalizeToolOutput(tool.progress)}
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
