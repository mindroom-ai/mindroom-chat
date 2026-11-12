import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ThinkingIndicator } from './ThinkingPlaceholder';
import * as css from './ToolWorkLine.css';

/** How long the line takes to fade out once the tool calls finish; ToolWorkLine.css fades as long. */
export const TOOL_WORK_FADE_MS = 240;

/**
 * Stands in for a run of hidden tool calls: "Working…", with the thinking placeholder's turning
 * mark and shimmer, while any of them runs. It fades in, and fades out once they all finish; calls
 * that had finished before the reply showed leave nothing.
 */
export function ToolWorkLine({ working }: { working: boolean }) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(working);
  // Shown from the render the work starts in, so the line never misses a frame.
  if (working && !visible) setVisible(true);
  useEffect(() => {
    if (working || !visible) return undefined;
    const timeout = globalThis.setTimeout(() => setVisible(false), TOOL_WORK_FADE_MS);
    return () => globalThis.clearTimeout(timeout);
  }, [working, visible]);

  if (!visible) return null;
  const label = t('mindroomUi.messages.toolCallsWorking');
  return (
    <div className={css.Line} data-leaving={working ? undefined : ''} data-tool-work-line="">
      <ThinkingIndicator text={label} label={label} />
    </div>
  );
}
