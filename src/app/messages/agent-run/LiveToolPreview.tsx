import { useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Icons } from 'folds';
import { useStore } from 'jotai';
import type { SubagentStatus } from '../../matrix/protocol/subagentFrame';
import { toolEndedAt, toolStartedAt } from '../../matrix/protocol/toolTrace';
import { openSubagentsPanel } from '../../navigation/subagentsPanel';
import { ownDirectionLine, revealDirectionControls } from '../../ui/directional';
import * as activityCss from '../../ui/ThreadActivity.css';
import {
  findLinkedSubagentRun,
  useRoomSubagentRuns,
  type SubagentRun,
} from '../live/subagentRunStore';
import { ToolCallWaitingStatusContext, type ToolCallWaitingStatus } from './toolCallStatus';
import {
  extractPrimaryArg,
  extractStepDetail,
  isShellTool,
  LiveStepRow,
  normalizeToolOutput,
  tailLines,
  TerminalWell,
  type StepState,
} from './LiveStepRow';
import * as css from './LiveToolPreview.css';

export { extractPrimaryArg, extractStepDetail, normalizeToolOutput } from './LiveStepRow';

export type LiveToolItem = {
  index: number;
  toolName: string;
  command: string;
  argsPreview?: string;
  toolCallId?: string;
  progress?: string;
  startedAt?: number;
};

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

const isSubagentTool = (name: string): boolean =>
  name === 'run_subagent' || name === 'continue_subagent';

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
        detailText: extractStepDetail(toolName, rawArgs),
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
      return [
        <div key={`shell-${tool.index}`} className={css.Card} data-live-shell={tool.index}>
          <LiveStepRow
            state={shellState}
            waitingStatus={waitingStatus}
            toolName={tool.toolName}
            arg={extractPrimaryArg(tool.argsPreview)}
            detailText={extractStepDetail(tool.toolName, tool.argsPreview)}
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
