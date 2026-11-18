import { useContext, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import parse, { type HTMLReactParserOptions } from 'html-react-parser';
import { Icon, Icons } from 'folds';
import { renderLiveMarkdown, useLiveMarkdownReady } from '../live/liveMarkdown';
import { sanitizeCustomHtml } from '../../rich-text/sanitize';
import { revealDirectionControls } from '../../ui/directional';
import { CompactionSeam } from './CompactionSeam';
import { ReasoningSegmentsContext } from './toolCallStatus';
import * as css from './Reasoning.css';

// The seams and reasoning segments a reply's body shows at its tool calls, apart from the reply's
// reasoning line (Reasoning.tsx), which reads where the body's calls render.

export const thoughtSeconds = (durationMs: number): number =>
  Math.max(1, Math.ceil(durationMs / 1000));

type ReasoningTextProps = {
  text: string;
  htmlReactParserOptions: HTMLReactParserOptions;
};

/** Reasoning as Markdown once the renderer has loaded, as plain lines until then. */
function ReasoningText({ text, htmlReactParserOptions }: ReasoningTextProps) {
  const ready = useLiveMarkdownReady();
  const html = useMemo(() => (ready ? renderLiveMarkdown(text) : undefined), [ready, text]);
  const rendered = useMemo(
    () =>
      html === undefined ? undefined : parse(sanitizeCustomHtml(html), htmlReactParserOptions),
    [html, htmlReactParserOptions]
  );

  if (rendered === undefined) {
    // As the Markdown renderer's text does, plain lines show direction controls as code points.
    return <div style={{ whiteSpace: 'pre-wrap' }}>{revealDirectionControls(text)}</div>;
  }
  return <div style={{ whiteSpace: 'normal' }}>{rendered}</div>;
}

/**
 * The compactions placed at `anchor` (0 for the top of the reply, else the index of the tool
 * marker a run of calls ends at), each as its seam. They show whether or not the bulb or the cog
 * shows what is around them, and before the thinking at the same spot, which the next model
 * request wrote after the compaction.
 */
export function CompactionSeamsAt({ anchor }: { anchor: number }) {
  const reasoning = useContext(ReasoningSegmentsContext);
  if (!reasoning) return null;
  const { compactionsAt, replyEnded } = reasoning;
  return (
    <>
      {compactionsAt.get(anchor)?.map((compaction) => (
        <CompactionSeam key={compaction.id} compaction={compaction} interrupted={replyEnded} />
      ))}
    </>
  );
}

/**
 * The reasoning segments placed at `anchor` (0 for the top of the reply, else the index of the
 * tool marker a run of calls ends at) that show: all of them while the reply's bulb is open, else
 * only the one the model is writing. Each has a rail along it and a button at its end, which close
 * the bulb from where the reader is, however far above it is.
 */
export function ReasoningSegmentsAt({ anchor }: { anchor: number }) {
  const { t } = useTranslation();
  const reasoning = useContext(ReasoningSegmentsContext);
  if (!reasoning) return null;
  const { segments, placement, open, hide, liveIndex, htmlReactParserOptions } = reasoning;
  const hideLabel = t('mindroomUi.messages.mindroomReasoning.hide');
  return (
    <>
      {placement.get(anchor)?.map((index) => {
        const segment = segments[index];
        if (!segment || !(open || index === liveIndex)) return null;
        let label = t('mindroomUi.messages.mindroomReasoning.thought');
        if (index === liveIndex) label = t('mindroomUi.messages.mindroomReasoning.thinking');
        else if (segment.durationMs !== undefined) {
          label = t('mindroomUi.messages.mindroomReasoning.thoughtFor', {
            count: thoughtSeconds(segment.durationMs),
          });
        }
        return (
          <div key={index} className={css.Segment}>
            {/* Under a closed bulb the segment only shows while it is written: nothing to hide. */}
            <button
              type="button"
              className={css.Rail}
              aria-label={hideLabel}
              disabled={!open}
              onClick={hide}
            />
            <div className={css.Body}>
              <span className={css.Label}>{label}</span>
              <ReasoningText text={segment.text} htmlReactParserOptions={htmlReactParserOptions} />
              {open && (
                <button type="button" className={css.CollapseEnd} onClick={hide}>
                  <Icon size="50" src={Icons.ChevronTop} aria-hidden />
                  <span className={css.Label}>{hideLabel}</span>
                </button>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
