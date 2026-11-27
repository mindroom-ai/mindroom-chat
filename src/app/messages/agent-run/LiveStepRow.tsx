import {
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Icons, Spinner } from 'folds';
import {
  toToolArgumentFields,
  valueText,
  type ArgumentFields,
} from '../../approvals/argumentFields';
import { useAppLanguageCode } from '../../i18n/useAppLanguageCode';
import { copyToClipboard } from '../../lib/dom';
import { useLiveClock } from '../../lib/hooks/useLiveClock';
import { isRecord } from '../../lib/isRecord';
import { formatWorkDuration } from '../../lib/time';
import { ownDirectionLine, revealDirectionControls } from '../../ui/directional';
import { useRevealOnOpen } from '../../ui/disclosureReveal';
import {
  TOOL_STATE_ICON,
  ToolCallClockContext,
  type ToolCallState,
  type ToolCallWaitingStatus,
} from './toolCallStatus';
import * as css from './LiveToolPreview.css';

export type StepState = Extract<ToolCallState, 'running' | 'waiting' | 'done' | 'failed'>;
export type TerminalLines = keyof typeof css.LIVE_OUTPUT_LINES;

const COPY_FEEDBACK_MS = 1_500;
const DRAWER_SCROLL_PIN_PX = 4;
const SHELL_ARG_KEY = /(?:^|, )([A-Za-z_][\w.-]*)=/g;

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

export const isShellTool = (name: string): boolean =>
  name === 'run_shell_command' || name === 'bash';

const isShellArgKey = (key: string): boolean => {
  const lower = key.toLowerCase();
  return lower === 'command' || lower === 'args';
};

// Output drops leading blank lines but keeps its first line's indentation, as in YAML or a tree listing.
export const normalizeToolOutput = (value: unknown): string | undefined =>
  typeof value === 'string'
    ? revealDirectionControls(value.replace(/^(?:[ \t\r]*\n)+/, '').trimEnd()) || undefined
    : undefined;

export const tailLines = (text: string, maxLines: number): string =>
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

const isJsonContainer = (text: string): boolean => {
  if (!text.startsWith('[') && !text.startsWith('{')) return false;
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) || isRecord(parsed);
  } catch {
    return false;
  }
};

/** Returns trimmed drawer/clipboard detail text for a live step without guessing or chopping. */
export const extractStepDetail = (
  toolName: string,
  argsPreview: string | undefined
): string | undefined => {
  const trimmed = argsPreview?.trim();
  if (!trimmed) return undefined;
  if (isShellTool(toolName)) {
    if (trimmed.startsWith('{')) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (isRecord(parsed)) {
          const entries = Object.entries(parsed);
          const single = entries.length === 1 ? entries[0] : undefined;
          if (single && isShellArgKey(single[0]) && typeof single[1] === 'string') {
            if (single[1].trim()) return revealDirectionControls(single[1]);
          }
        }
      } catch {
        // Fall through to key=value or verbatim handling.
      }
    }
    const matches = [...trimmed.matchAll(SHELL_ARG_KEY)];
    const only = matches.length === 1 ? matches[0] : undefined;
    if (only?.index === 0 && only[1] !== undefined && isShellArgKey(only[1])) {
      const value = trimmed.slice(only[0].length).trimStart();
      if (value && !isJsonContainer(value)) return revealDirectionControls(value);
    }
  }
  return revealDirectionControls(trimmed);
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

export function TerminalWell({ lines, output }: { lines: TerminalLines; output: string }) {
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
      ? t('mindroomUi.messages.mindroomHtmlBlocks.stepCopied')
      : copyState === 'failed'
        ? t('mindroomUi.messages.mindroomHtmlBlocks.stepCopyFailed')
        : t('mindroomUi.messages.mindroomHtmlBlocks.stepCopy');

  return (
    <button type="button" className={css.CopyButton} data-live-step-copy="" onClick={handleCopy}>
      <span aria-live="polite">{label}</span>
    </button>
  );
}

function DrawerLiveOutput({ output }: { output: string }) {
  const preRef = useRef<HTMLPreElement>(null);
  const pinnedRef = useRef(true);

  useLayoutEffect(() => {
    const el = preRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [output]);

  const handleScroll = () => {
    const el = preRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= DRAWER_SCROLL_PIN_PX;
  };

  return (
    <pre ref={preRef} className={css.DrawerOutput} data-live-output="" onScroll={handleScroll}>
      {output}
    </pre>
  );
}

export function LiveStepRow({
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

  const rowContent = (
    <>
      <span className={css.StepIcon[state]} role="img" aria-label={statusLabel} title={statusLabel}>
        {state === 'running' ? (
          <Spinner size="50" variant="Secondary" aria-hidden />
        ) : (
          <Icon size="50" src={TOOL_STATE_ICON[state].src} aria-hidden />
        )}
      </span>
      <span className={stepNameClass}>{toolName}</span>
      {arg && !open && (
        <span className={css.StepArg} title={arg} {...ownDirectionLine}>
          {arg}
        </span>
      )}
      <span className={css.StepTrail}>
        <LiveStepElapsed
          state={state}
          startedAt={startedAt}
          endedAt={endedAt}
          language={language}
        />
        {expandable && (
          <Icon size="50" className={css.StepChevron} src={Icons.ChevronRight} aria-hidden />
        )}
      </span>
    </>
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
            aria-controls={open ? drawerId : undefined}
            onClick={() => {
              if (!open) armReveal();
              setOpen((value) => !value);
            }}
          >
            {rowContent}
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
                <DrawerLiveOutput output={activeOutput} />
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
        <div className={css.StepRow}>{rowContent}</div>
      )}
    </div>
  );
}
