import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { useTranslation } from 'react-i18next';
import parse, { type HTMLReactParserOptions } from 'html-react-parser';
import type { Opts as LinkifyOpts } from 'linkifyjs';
import { Icon, Icons } from 'folds';
import { renderLiveMarkdown, useLiveMarkdownReady } from '../live/liveMarkdown';
import {
  LIVE_ACTIVITY_KEY,
  LIVE_REASONING_KEY,
  LIVE_REASONING_SEGMENTS_KEY,
} from '../live/useLiveReplyContent';
import { sanitizeCustomHtml } from '../../rich-text/sanitize';
import { ACTIVE_STREAM_STATUSES, getStreamStatusFromContent } from '../../matrix/protocol/aiRun';
import { revealDirectionControls } from '../../ui/directional';
import { OutlineComet } from './OutlineComet';
import { Outline } from './OutlineComet.css';
import { placeReasoningSegments, readReasoningSegments } from './reasoningSegments';
import { ReasoningSegmentsContext, ToolCallsCogContext } from './toolCallStatus';
import { CogRipple } from './ToolCallsFold.css';
import { getRenderedToolRefs } from './toolRefDom';
import * as css from './Reasoning.css';

/** Final reasoning the runtime stores on a finished reply. */
const MINDROOM_REASONING_KEY = 'io.mindroom.reasoning';

type FinalReasoning = {
  text: string;
  durationMs?: number;
  /** Where each segment of the text began, as the runtime wrote it (reasoningSegments.ts). */
  segments: unknown;
};

/** How long the bulb's comet keeps lapping after the live reasoning last grew. */
export const THINKING_GLOW_MS = 2000;

// The middle of the bulb's rim (folds' Bulb icon), which is 1.5 wide: a circle of radius 7.25 with
// the stem under it, drawn clockwise from where the stem's left side meets the circle.
const BULB_OUTLINE = 'M8.75 16.4807A7.25 7.25 0 1 1 15.25 16.4807V21.25H8.75Z';

/** Whether `value` changed in the last `holdMs`: false at first, true from a change to `holdMs`
 * after the last one. */
const useChangedRecently = (value: unknown, holdMs: number): boolean => {
  const [changed, setChanged] = useState(false);
  const last = useRef(value);
  useEffect(() => {
    if (Object.is(last.current, value)) return undefined;
    last.current = value;
    setChanged(true);
    const timer = setTimeout(setChanged, holdMs, false);
    return () => clearTimeout(timer);
  }, [value, holdMs]);
  return changed;
};

const parseFinalReasoning = (value: unknown): FinalReasoning | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const { text, duration_ms: durationMs, segments } = value as Record<string, unknown>;
  if (typeof text !== 'string' || text.trim() === '') return undefined;
  return {
    text,
    durationMs:
      typeof durationMs === 'number' && Number.isFinite(durationMs) ? durationMs : undefined,
    segments,
  };
};

/** The whole seconds a thought took, one at least. */
const thoughtSeconds = (durationMs: number): number => Math.max(1, Math.ceil(durationMs / 1000));

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined;

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

type ReasoningHeaderProps = {
  label: string;
  open: boolean;
  /** A comet laps the bulb, as it laps the cog while a call runs. */
  thinking: boolean;
  onToggle: () => void;
  bulbRef: RefObject<HTMLButtonElement>;
};

/**
 * The reply's reasoning line: the bulb, which shows every reasoning segment where it happened and
 * hides them again, as the cog after it does the runs of tool calls, and the segments at the top.
 */
function ReasoningHeader({ label, open, thinking, onToggle, bulbRef }: ReasoningHeaderProps) {
  const cog = useContext(ToolCallsCogContext);
  // Each click sheds a ripple, as the cog's does: the count keys it, so a new one starts while the
  // last one fades.
  const [ripples, setRipples] = useState(0);
  return (
    <div className={css.Reasoning}>
      <div className={css.Line}>
        <button
          ref={bulbRef}
          type="button"
          className={css.Toggle}
          aria-expanded={open}
          onClick={() => {
            setRipples((count) => count + 1);
            onToggle();
          }}
        >
          <span className={css.BulbIcon} data-thinking={thinking || undefined} aria-hidden>
            <Icon size="50" src={Icons.Bulb} className={css.Bulb} />
            {thinking && <OutlineComet outline={BULB_OUTLINE} width={1.5} />}
            {ripples > 0 && (
              <svg className={Outline} viewBox="0 0 24 24" fill="none">
                <path key={ripples} className={CogRipple} d={BULB_OUTLINE} />
              </svg>
            )}
          </span>
          <span className={css.Label}>{label}</span>
          <Icon size="50" src={Icons.ChevronRight} className={css.Chevron} aria-hidden />
        </button>
        {cog}
      </div>
      <ReasoningSegmentsAt anchor={0} />
    </div>
  );
}

// Tool names in the activity line are backticked identifiers; other backticks stay as sent.
const ACTIVITY_CODE = /`([^`\s<>]+)`/g;

const renderActivityLine = (line: string): ReactNode[] => {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  line.replace(ACTIVITY_CODE, (match, name: string, offset: number) => {
    if (offset > lastIndex) parts.push(revealDirectionControls(line.slice(lastIndex, offset)));
    parts.push(
      <code key={offset} className={css.ActivityCode}>
        {revealDirectionControls(name)}
      </code>
    );
    lastIndex = offset + match.length;
    return match;
  });
  if (lastIndex < line.length) parts.push(revealDirectionControls(line.slice(lastIndex)));
  return parts;
};

function LiveActivity({ text }: { text: string }) {
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  return (
    <div style={{ marginTop: '0.25rem', opacity: 0.75, fontSize: '0.8125rem' }}>
      {lines.map((line, index) => (
        // Lines have no identity beyond their position in the status text.
        // eslint-disable-next-line react/no-array-index-key
        <div key={index}>{renderActivityLine(line)}</div>
      ))}
    </div>
  );
}

/** The reply's cog in a row of its own, for a reply without reasoning; nothing without a cog. */
function ToolCallsCogRow() {
  const cog = useContext(ToolCallsCogContext);
  return cog ? <div className={css.CogRow}>{cog}</div> : null;
}

type ReplyReasoningProps = {
  content: Record<string, unknown>;
  /** The HTML the body renders, whose tool markers place the segments. */
  html: string | undefined;
  htmlReactParserOptions: HTMLReactParserOptions;
  /** The reply's body. */
  children: ReactNode;
};

function ReplyReasoning({ content, html, htmlReactParserOptions, children }: ReplyReasoningProps) {
  const { t } = useTranslation();
  const final = parseFinalReasoning(content[MINDROOM_REASONING_KEY]);
  const liveText = nonEmptyString(content[LIVE_REASONING_KEY]);
  const status = getStreamStatusFromContent(content);
  const streaming = status === undefined || ACTIVE_STREAM_STATUSES.has(status);
  const live = liveText !== undefined && (!final || streaming) ? liveText : undefined;
  const activity = nonEmptyString(content[LIVE_ACTIVITY_KEY]);
  // The model thinks while its live reasoning comes or grows, and a little after: not when a reply
  // that has some already comes into view.
  const thinking = useChangedRecently(live, THINKING_GLOW_MS) && live !== undefined;

  // The bulb starts closed on every reply, as the cog does, and stays as the reader left it when
  // the reply finishes.
  const [open, setOpen] = useState(false);
  const bulbRef = useRef<HTMLButtonElement>(null);
  // Long replies put the bulb far above: a segment's rail and end button hide the thinking from
  // where the reader is, and give the focus to the bulb, which scrolls into view if it is off screen.
  const hide = useCallback(() => {
    bulbRef.current?.focus();
    setOpen(false);
  }, []);

  const text = live ?? final?.text;
  const recorded = live === undefined ? final?.segments : content[LIVE_REASONING_SEGMENTS_KEY];
  const segments = useMemo(
    () => (text === undefined ? [] : readReasoningSegments(text, recorded)),
    [text, recorded]
  );
  // The segment being written is the last one with text, and shows as long as the comet laps.
  const liveIndex = thinking ? segments.length - 1 : undefined;
  // The markers that render as runs of calls, as the body shows them; read only once a segment
  // that happened after a call shows.
  const placed = (open || thinking) && segments.some(({ afterTool }) => afterTool > 0);
  const markers = useMemo(
    () =>
      placed && html !== undefined
        ? getRenderedToolRefs(sanitizeCustomHtml(html)).toolBlocks.map(({ index }) => index)
        : [],
    [placed, html]
  );
  const placement = useMemo(() => placeReasoningSegments(segments, markers), [segments, markers]);
  const reasoning = useMemo(
    () => ({ segments, placement, open, hide, liveIndex, htmlReactParserOptions }),
    [segments, placement, open, hide, liveIndex, htmlReactParserOptions]
  );

  let label: string | undefined;
  if (live !== undefined) label = t('mindroomUi.messages.mindroomReasoning.thinking');
  else if (final) {
    label =
      final.durationMs === undefined
        ? t('mindroomUi.messages.mindroomReasoning.thought')
        : t('mindroomUi.messages.mindroomReasoning.thoughtFor', {
            count: thoughtSeconds(final.durationMs),
          });
  }

  // One shape with or without reasoning, the cog and activity, so the body keeps its place, and the
  // state inside it such as an open tool-call list, when warm-up lines or reasoning come and go.
  return (
    <ReasoningSegmentsContext.Provider value={reasoning}>
      {label === undefined ? (
        <ToolCallsCogRow />
      ) : (
        <ReasoningHeader
          label={label}
          open={open}
          thinking={thinking}
          onToggle={() => setOpen((value) => !value)}
          bulbRef={bulbRef}
        />
      )}
      {children}
      {activity !== undefined && <LiveActivity text={activity} />}
    </ReasoningSegmentsContext.Provider>
  );
}

/**
 * Wrap a reply body with the model's reasoning and the runtime's live activity. The reasoning line
 * above the body says how long the model thought, or that it thinks (`io.mindroom.live_reasoning`,
 * `io.mindroom.reasoning`); its bulb shows each reasoning segment where it happened, at the top or
 * after the tool calls of `html` it followed, and while the reply streams the segment being
 * written shows there under a closed bulb too. The live activity line (`io.mindroom.live_activity`)
 * goes below the body. While the reply's tool calls are hidden, their cog sits on the reasoning's
 * line, or in its place above the body.
 */
export const withReasoning = (
  content: Record<string, unknown>,
  body: ReactNode,
  htmlReactParserOptions: HTMLReactParserOptions,
  // The body renderers pass their linkify options too; reasoning renders from Markdown.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _linkifyOpts?: LinkifyOpts,
  /** The HTML `body` renders; without it every segment shows at the top. */
  html?: string
): ReactNode => (
  <ReplyReasoning content={content} html={html} htmlReactParserOptions={htmlReactParserOptions}>
    {body}
  </ReplyReasoning>
);
