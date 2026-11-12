import { ReactNode, useId, useState } from 'react';
import { Icon, Icons } from 'folds';
import { Panel } from '../../ui/ThreadActivity.css';
import { IsolatedText } from '../../ui/directional';
import type { ToolCallState } from './toolCallStatus';
import { toolIconName } from './toolIcon';
import * as css from './ToolCallsChip.css';

// The chip shows the icons of the last calls only, and counts the ones before them.
const MAX_ICONS = 4;

export type ToolCallsChipCall = { key: string; toolName: string; state: ToolCallState };

/**
 * Stands in for a run of tool calls while the reply's tool calls are hidden: one small icon per
 * call and a short label, tinted while a call runs or waits for approval and grey once they are
 * done. It sits where the run sits in the reply, and opens the calls right there.
 */
export function ToolCallsChip({
  calls,
  state,
  label,
  names,
  preview,
  children,
}: {
  calls: readonly ToolCallsChipCall[];
  state: ToolCallState;
  label: string;
  // The tools' names, shown as the chip's tooltip.
  names: string;
  // Shown under the chip while it is open, above the calls.
  preview?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  // The calls the chip first showed appear at once; calls that start later pop in.
  const [initialKeys] = useState(() => new Set(calls.map(({ key }) => key)));
  const [live] = useState(state === 'running');
  const shownCalls = calls.slice(-MAX_ICONS);
  const earlier = calls.length - shownCalls.length;

  return (
    // Keeps the interface's direction in a message that reads the other way (index.css).
    <div
      className={css.Chip}
      data-message-disclosure=""
      data-tool-calls-chip=""
      data-state={state}
      data-live={live ? '' : undefined}
    >
      <button
        type="button"
        className={css.Button}
        aria-expanded={open}
        aria-controls={panelId}
        title={names}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={css.Icons} aria-hidden>
          {earlier > 0 && <span className={css.More}>+{earlier}</span>}
          {shownCalls.map((call) => {
            const icon = toolIconName(call.toolName);
            return (
              <span
                key={call.key}
                className={css.Tile}
                data-tool-icon={icon}
                data-state={call.state}
                data-new={initialKeys.has(call.key) ? undefined : ''}
              >
                <Icon size="Inherit" src={Icons[icon]} />
              </span>
            );
          })}
        </span>
        <span className={css.Label}>
          <IsolatedText text={label} />
        </span>
        <Icon size="50" className={css.Chevron} src={Icons.ChevronRight} aria-hidden />
      </button>
      {open && preview}
      {open && (
        <div id={panelId} className={Panel}>
          {children}
        </div>
      )}
    </div>
  );
}
