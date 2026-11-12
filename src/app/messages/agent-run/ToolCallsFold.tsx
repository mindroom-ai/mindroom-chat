import { ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Icons } from 'folds';
import { useToolCallsShown } from '../toolCallVisibility';
import {
  type FoldedToolCall,
  summarizeToolCalls,
  TOOL_STATE_TITLE,
  ToolCallMessageContext,
  ToolCallsFoldContext,
} from './toolCallStatus';
import * as css from './ToolCallsFold.css';

const sameCalls = (a: readonly FoldedToolCall[], b: readonly FoldedToolCall[]) =>
  a.length === b.length &&
  a.every((call, index) => call.toolName === b[index]?.toolName && call.state === b[index]?.state);

/**
 * An agent reply, with a small cog at its end while its thread or room hides tool calls: the cog
 * counts all of the reply's calls and turns while one runs. It shows each run of calls where it
 * ran, as the line it has when tool calls show, and hides them again.
 */
export function ToolCallsFold({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const message = useContext(ToolCallMessageContext);
  const [shown] = useToolCallsShown(message?.roomId, message?.threadId);
  const [open, setOpen] = useState(false);
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

  const calls = Object.values(runs).flat();
  const summary = summarizeToolCalls(
    calls,
    calls.map(({ state }) => state)
  );
  const title =
    summary.state === 'done'
      ? t('mindroomUi.messages.mindroomHtmlBlocks.usedToolCount', { count: calls.length })
      : t(TOOL_STATE_TITLE[summary.state], { count: summary.count });

  return (
    <ToolCallsFoldContext.Provider value={fold}>
      {children}
      {!shown && calls.length > 0 && (
        // Keeps the interface's direction in a message that reads the other way (index.css).
        <div
          className={css.Fold}
          data-message-disclosure=""
          data-tool-calls-fold=""
          data-state={summary.state}
        >
          <button
            type="button"
            className={css.Cog}
            aria-expanded={open}
            aria-label={title}
            title={title}
            onClick={() => setOpen((value) => !value)}
          >
            <Icon size="Inherit" className={css.CogIcon} src={Icons.Setting} aria-hidden />
            {calls.length}
          </button>
        </div>
      )}
    </ToolCallsFoldContext.Provider>
  );
}
