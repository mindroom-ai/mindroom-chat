import { ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Icons } from 'folds';
import { useToolCallsShown } from '../toolCallVisibility';
import {
  type FoldedToolCall,
  summarizeToolCalls,
  TOOL_STATE_TITLE,
  ToolCallMessageContext,
  ToolCallsCogContext,
  ToolCallsFoldContext,
} from './toolCallStatus';
import * as css from './ToolCallsFold.css';

const sameCalls = (a: readonly FoldedToolCall[], b: readonly FoldedToolCall[]) =>
  a.length === b.length &&
  a.every((call, index) => call.toolName === b[index]?.toolName && call.state === b[index]?.state);

type CogProps = { calls: readonly FoldedToolCall[]; open: boolean; onToggle: () => void };

/** The cog: the number of the reply's calls, named by what they did, as a run's line is. */
function Cog({ calls, open, onToggle }: CogProps) {
  const { t } = useTranslation();
  const summary = summarizeToolCalls(
    calls,
    calls.map(({ state }) => state)
  );
  const title = t(
    summary.state === 'done'
      ? 'mindroomUi.messages.mindroomHtmlBlocks.usedToolCount'
      : TOOL_STATE_TITLE[summary.state],
    { count: summary.count }
  );
  // Where that names fewer calls than the cog shows, its name starts with the number it shows.
  const name =
    summary.count === calls.length
      ? title
      : `${t('mindroomUi.messages.mindroomHtmlBlocks.toolCallCount', {
          count: calls.length,
        })}: ${title}`;
  return (
    // Keeps the interface's direction in a message that reads the other way (index.css).
    <span
      className={css.Fold}
      data-message-disclosure=""
      data-tool-calls-fold=""
      data-state={summary.state}
    >
      <button
        type="button"
        className={css.Cog}
        aria-expanded={open}
        aria-label={name}
        title={name}
        onClick={onToggle}
      >
        <Icon size="Inherit" className={css.CogIcon} src={Icons.Setting} aria-hidden />
        {calls.length}
      </button>
    </span>
  );
}

/**
 * An agent reply, with a small cog at its top while its thread or room hides tool calls: the cog
 * counts all of the reply's calls and turns while one runs. It shows each run of calls where it
 * ran, as the line it has when tool calls show, and hides them again. The reply's reasoning line
 * shows the cog (withReasoning in Reasoning.tsx), so it keeps one place while the reply streams.
 */
export function ToolCallsFold({ children }: { children: ReactNode }) {
  const message = useContext(ToolCallMessageContext);
  const [shown] = useToolCallsShown(message?.roomId, message?.threadId);
  const [open, setOpen] = useState(false);
  // Showing the tool calls closes the cog, so hiding them again hides the runs too.
  if (shown && open) setOpen(false);
  const [runs, setRuns] = useState<Readonly<Record<string, readonly FoldedToolCall[]>>>({});
  const report = useCallback((key: string, calls?: readonly FoldedToolCall[]) => {
    setRuns((current) => {
      const before = current[key];
      if (calls === undefined) {
        return before === undefined
          ? current
          : Object.fromEntries(Object.entries(current).filter(([other]) => other !== key));
      }
      return before !== undefined && sameCalls(before, calls)
        ? current
        : { ...current, [key]: calls };
    });
  }, []);
  const fold = useMemo(() => ({ open, report }), [open, report]);
  const toggle = useCallback(() => setOpen((value) => !value), []);

  const calls = Object.values(runs).flat();
  const cog =
    !shown && calls.length > 0 ? <Cog calls={calls} open={open} onToggle={toggle} /> : null;

  return (
    <ToolCallsFoldContext.Provider value={fold}>
      <ToolCallsCogContext.Provider value={cog}>{children}</ToolCallsCogContext.Provider>
    </ToolCallsFoldContext.Provider>
  );
}
