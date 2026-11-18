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
import { type HTMLReactParserOptions } from 'html-react-parser';
import type { Opts as LinkifyOpts } from 'linkifyjs';
import { Icon, Icons } from 'folds';
import {
  LIVE_ACTIVITY_KEY,
  LIVE_COMPACTIONS_KEY,
  LIVE_REASONING_KEY,
  LIVE_REASONING_SEGMENTS_KEY,
} from '../live/useLiveReplyContent';
import { sanitizeCustomHtml } from '../../rich-text/sanitize';
import {
  ACTIVE_STREAM_STATUSES,
  getStreamStatusFromContent,
  hasTerminalStreamMetadata,
} from '../../matrix/protocol/aiRun';
import {
  COMPACTIONS_CONTENT_KEY,
  readReplyCompactions,
  type ReplyCompaction,
} from '../../matrix/protocol/compactions';
import { revealDirectionControls } from '../../ui/directional';
import { OutlineComet } from './OutlineComet';
import { Outline } from './OutlineComet.css';
import {
  lastRecordedReasoningSegment,
  placeReasoningSegments,
  readReasoningSegments,
} from './reasoningSegments';
import { ReasoningSegmentsContext, ToolCallsCogContext } from './toolCallStatus';
import { CogRipple } from './ToolCallsFold.css';
import { MINDROOM_TOOL_REF_ICON } from '../html/blocks';
import { readRenderedToolCalls } from '../html/HtmlBlocks';
import * as css from './Reasoning.css';
import { CompactionSeamsAt, ReasoningSegmentsAt, thoughtSeconds } from './ReasoningAnchors';

const NO_MARKERS: readonly number[] = [];

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

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined;

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
      <CompactionSeamsAt anchor={0} />
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
  // The comet laps while the live reasoning comes or grows, and a little after: not when a reply
  // that has some already comes into view.
  const thinking = useChangedRecently(live, THINKING_GLOW_MS) && live !== undefined;
  const recorded = live === undefined ? final?.segments : content[LIVE_REASONING_SEGMENTS_KEY];
  const last = live === undefined ? undefined : lastRecordedReasoningSegment(live, recorded);
  // The body as it was when the segment the model writes was first seen to come or grow on screen.
  // More of the same segment keeps that body, so answer text in the frame of the segment's last
  // piece is the reply moving on. A new segment takes the body of its own frame, which holds what
  // came before it there: the tool call it followed, or text. So does every growth of reasoning
  // whose segments are not recorded, which is one segment that never ends.
  const { body } = content;
  const [grew, setGrew] = useState({ live, start: last?.start, html, body, seen: false });
  if (grew.live !== live) {
    const same = last !== undefined && last.start === grew.start;
    setGrew({
      live,
      start: last?.start,
      html: same ? grew.html : html,
      body: same ? grew.body : body,
      seen: live !== undefined,
    });
  }

  // The bulb starts closed on every reply, as the cog does, and stays as the reader left it when
  // the reply finishes. Until the reader first closes it, the segment the model writes shows under
  // it; once they have, nothing does.
  const [bulb, setBulb] = useState<'untouched' | 'open' | 'closed'>('untouched');
  const open = bulb === 'open';
  const bulbRef = useRef<HTMLButtonElement>(null);
  // Long replies put the bulb far above: a segment's rail and end button hide the thinking from
  // where the reader is, and give the focus to the bulb, which scrolls into view if it is off
  // screen.
  const hide = useCallback(() => {
    bulbRef.current?.focus();
    setBulb('closed');
  }, []);

  const text = live ?? final?.text;
  const segments = useMemo(
    () => (text === undefined ? [] : readReasoningSegments(text, recorded)),
    [text, recorded]
  );
  // While the reply streams its live frames say which compactions ran, ahead of its durable edits.
  const recordedCompactions = content[LIVE_COMPACTIONS_KEY] ?? content[COMPACTIONS_CONTENT_KEY];
  const compactions = useMemo(
    () => readReplyCompactions(recordedCompactions),
    [recordedCompactions]
  );
  const replyEnded = hasTerminalStreamMetadata(content);
  // The calls the body draws as tool blocks, read from the renderer's own parse of the HTML it
  // renders. They place the segments an open bulb shows after calls and the compactions after
  // calls, and end the segment the model writes; the body is read for them only then.
  const readsCalls =
    (open && segments.some(({ afterTool }) => afterTool > 0)) ||
    compactions.some(({ afterTool }) => afterTool > 0) ||
    (grew.seen && !!last);
  const markers = useMemo(
    () =>
      readsCalls && html?.includes(MINDROOM_TOOL_REF_ICON)
        ? readRenderedToolCalls(sanitizeCustomHtml(html), htmlReactParserOptions).indexes
        : NO_MARKERS,
    [readsCalls, html, htmlReactParserOptions]
  );
  // The model is writing its last segment from when the live reasoning comes or grows on screen
  // until the reply moves past it. A tool call that began after the segment did ends it, also when
  // its marker came in the frame of the segment's last piece, and so does a segment that has begun
  // without text yet. Answer text ends it too: the body is then other text and other HTML than when
  // the segment began. One of the two alone is a durable write of the same body (a checkpoint
  // names a code block's language, and spells a mention out), and a pause changes neither.
  const movedOn = grew.body !== body && (grew.html !== html || html === undefined);
  const ended = !!last && (last.blank || markers.some((marker) => marker > last.afterTool));
  const writing = live !== undefined && grew.seen && !movedOn && !ended;
  const liveIndex = writing && bulb !== 'closed' ? segments.length - 1 : undefined;
  const placement = useMemo(() => placeReasoningSegments(segments, markers), [segments, markers]);
  const compactionsAt = useMemo(() => {
    const at = new Map<number, ReplyCompaction[]>();
    placeReasoningSegments(compactions, markers).forEach((indices, anchor) =>
      at.set(
        anchor,
        indices.flatMap((index) => compactions[index] ?? [])
      )
    );
    return at;
  }, [compactions, markers]);
  const reasoning = useMemo(
    () => ({
      segments,
      placement,
      open,
      hide,
      liveIndex,
      htmlReactParserOptions,
      compactionsAt,
      replyEnded,
    }),
    [segments, placement, open, hide, liveIndex, htmlReactParserOptions, compactionsAt, replyEnded]
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
        <>
          <ToolCallsCogRow />
          <CompactionSeamsAt anchor={0} />
        </>
      ) : (
        <ReasoningHeader
          label={label}
          open={open}
          thinking={thinking}
          onToggle={() => setBulb(open ? 'closed' : 'open')}
          bulbRef={bulbRef}
        />
      )}
      {children}
      {activity !== undefined && <LiveActivity text={activity} />}
    </ReasoningSegmentsContext.Provider>
  );
}

/**
 * Wrap a reply body with the model's reasoning, its history compactions and the runtime's live
 * activity. Each compaction (`io.mindroom.compactions`, or `io.mindroom.live_compactions` while
 * the reply streams) shows as a seam where it ran, placed as the reasoning segments are. The
 * reasoning line above the body says how long the model thought, or that it thinks
 * (`io.mindroom.live_reasoning`, `io.mindroom.reasoning`); its bulb shows each reasoning segment
 * where it happened, at the top or after the tool calls of `html` it followed, and while the
 * reply streams the segment being written shows there under a closed bulb too, until the body
 * goes on or the reader closes the bulb. The live activity line (`io.mindroom.live_activity`)
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
