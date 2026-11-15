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

// The outer edge of folds' Setting icon, which the comet and the ripple follow.
const GEAR_OUTLINE =
  'M9.00001 2H15V4.58152C15.6948 4.86278 16.3411 5.23882 16.9229 5.69361L19.1603 4.40186L22.1603 9.59801L19.9235 10.8894C19.9739 11.2524 20 11.6231 20 12C20 12.3768 19.9739 12.7475 19.9235 13.1105L22.1603 14.4019L19.1603 19.598L16.923 18.3063C16.3412 18.7611 15.6949 19.1372 15 19.4185V22H9.00001V19.4185C8.30516 19.1372 7.65881 18.7612 7.07702 18.3063L4.83978 19.598L1.83978 14.4019L4.07646 13.1105C4.02605 12.7476 4 12.3768 4 12C4 11.6231 4.02606 11.2524 4.07647 10.8894L1.83978 9.59801L4.83978 4.40186L7.07712 5.69358C7.65889 5.2388 8.3052 4.86276 9.00001 4.58151V2Z';

// A dash of the outline that ends where the outline does, so dashes of any length share a head.
const cometDash = (length: number) => `0 ${100 - length} ${length} 0`;

/** The cog: the number of the reply's calls, named by what they did, as a run's line is. */
function Cog({ calls, open, onToggle }: CogProps) {
  const { t } = useTranslation();
  // Each click sheds a ripple: the count keys it, so a new one starts while the last one fades.
  const [ripples, setRipples] = useState(0);
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
  const running = summary.state === 'running';
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
        onClick={() => {
          setRipples((count) => count + 1);
          onToggle();
        }}
      >
        <span className={css.CogIcon} aria-hidden>
          <Icon size="Inherit" className={css.CogGear} src={Icons.Setting} />
          {running && (
            <span className={css.CogGlow}>
              <svg className={css.CogOutline} viewBox="0 0 24 24" fill="none">
                {/* Drawn at the middle of the icon's rim, which it is as wide as. */}
                <g
                  className={css.CogComet}
                  transform="translate(12 12) scale(0.925) translate(-12 -12)"
                >
                  <path
                    d={GEAR_OUTLINE}
                    pathLength={100}
                    strokeDasharray={cometDash(40)}
                    strokeOpacity={0.32}
                  />
                  <path
                    d={GEAR_OUTLINE}
                    pathLength={100}
                    strokeDasharray={cometDash(24)}
                    strokeOpacity={0.65}
                  />
                  <path
                    className={css.CogCometHead}
                    d={GEAR_OUTLINE}
                    pathLength={100}
                    strokeDasharray={cometDash(10)}
                  />
                </g>
              </svg>
            </span>
          )}
          {ripples > 0 && (
            <svg className={css.CogOutline} viewBox="0 0 24 24" fill="none">
              <path key={ripples} className={css.CogRipple} d={GEAR_OUTLINE} />
            </svg>
          )}
        </span>
        {calls.length}
      </button>
    </span>
  );
}

/**
 * An agent reply, with a small cog at its top while its thread or room hides tool calls: the cog
 * counts all of the reply's calls, and while one runs it turns and a comet laps its outline. It
 * shows each run of calls where it ran, as the line it has when tool calls show, and hides them
 * again. The reply's reasoning line shows the cog (withReasoning in Reasoning.tsx), so it keeps one
 * place while the reply streams.
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
