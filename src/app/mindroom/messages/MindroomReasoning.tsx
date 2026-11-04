import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import parse, { type HTMLReactParserOptions } from 'html-react-parser';
import type { Opts as LinkifyOpts } from 'linkifyjs';
import { Icon, Icons } from 'folds';
import { renderLiveMarkdown, useLiveMarkdownReady } from '../live/liveMarkdown';
import { LIVE_ACTIVITY_KEY, LIVE_REASONING_KEY } from '../live/useLiveReplyContent';
import { sanitizeCustomHtml } from '../../utils/sanitize';
import { ACTIVE_STREAM_STATUSES, getStreamStatusFromContent } from './aiRun';
import * as css from './MindroomReasoning.css';

/** Final reasoning the runtime stores on a finished reply. */
export const MINDROOM_REASONING_KEY = 'io.mindroom.reasoning';

type FinalReasoning = { text: string; durationMs?: number };

const parseFinalReasoning = (value: unknown): FinalReasoning | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const { text, duration_ms: durationMs } = value as Record<string, unknown>;
  if (typeof text !== 'string' || text.trim() === '') return undefined;
  return {
    text,
    durationMs:
      typeof durationMs === 'number' && Number.isFinite(durationMs) ? durationMs : undefined,
  };
};

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
    return <div style={{ whiteSpace: 'pre-wrap' }}>{text}</div>;
  }
  return <div style={{ whiteSpace: 'normal' }}>{rendered}</div>;
}

type ReasoningBlockProps = {
  label: string;
  text: string;
  defaultExpanded: boolean;
  htmlReactParserOptions: HTMLReactParserOptions;
};

function ReasoningBlock({
  label,
  text,
  defaultExpanded,
  htmlReactParserOptions,
}: ReasoningBlockProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <div className={css.Reasoning}>
      <button
        type="button"
        className={css.Toggle}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className={css.Label}>{label}</span>
        <Icon size="50" src={expanded ? Icons.ChevronTop : Icons.ChevronBottom} aria-hidden />
      </button>
      {expanded && (
        <div className={css.Body}>
          <ReasoningText text={text} htmlReactParserOptions={htmlReactParserOptions} />
        </div>
      )}
    </div>
  );
}

// Tool names in the activity line are backticked identifiers; other backticks stay as sent.
const ACTIVITY_CODE = /`([^`\s<>]+)`/g;

const renderActivityLine = (line: string): ReactNode[] => {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  line.replace(ACTIVITY_CODE, (match, name: string, offset: number) => {
    if (offset > lastIndex) parts.push(line.slice(lastIndex, offset));
    parts.push(
      <code key={offset} className={css.ActivityCode}>
        {name}
      </code>
    );
    lastIndex = offset + match.length;
    return match;
  });
  if (lastIndex < line.length) parts.push(line.slice(lastIndex));
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

function ReasoningHeader({
  live,
  final,
  htmlReactParserOptions,
}: {
  live?: string;
  final?: FinalReasoning;
  htmlReactParserOptions: HTMLReactParserOptions;
}) {
  const { t } = useTranslation();
  if (live !== undefined) {
    return (
      <ReasoningBlock
        key="live"
        label={t('mindroomUi.messages.mindroomReasoning.thinking')}
        text={live}
        defaultExpanded
        htmlReactParserOptions={htmlReactParserOptions}
      />
    );
  }
  if (!final) return null;
  const seconds =
    final.durationMs === undefined ? undefined : Math.max(1, Math.ceil(final.durationMs / 1000));
  return (
    <ReasoningBlock
      key="final"
      label={
        seconds === undefined
          ? t('mindroomUi.messages.mindroomReasoning.thought')
          : t('mindroomUi.messages.mindroomReasoning.thoughtFor', { count: seconds })
      }
      text={final.text}
      defaultExpanded={false}
      htmlReactParserOptions={htmlReactParserOptions}
    />
  );
}

/**
 * Wrap a reply body with the model's reasoning and the runtime's live activity. While the reply
 * streams, the live reasoning (`io.mindroom.live_reasoning`) shows open above the body; a finished
 * reply shows its stored reasoning (`io.mindroom.reasoning`) collapsed with how long it took. The
 * live activity line (`io.mindroom.live_activity`) goes below the body.
 */
export const withMindroomReasoning = (
  content: Record<string, unknown>,
  body: ReactNode,
  htmlReactParserOptions: HTMLReactParserOptions,
  // The body renderers pass their linkify options too; reasoning renders from Markdown.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _linkifyOpts?: LinkifyOpts
): ReactNode => {
  const final = parseFinalReasoning(content[MINDROOM_REASONING_KEY]);
  const liveText = nonEmptyString(content[LIVE_REASONING_KEY]);
  const status = getStreamStatusFromContent(content);
  const streaming = status === undefined || ACTIVE_STREAM_STATUSES.has(status);
  const live = liveText !== undefined && (!final || streaming) ? liveText : undefined;
  const activity = nonEmptyString(content[LIVE_ACTIVITY_KEY]);

  if (live === undefined && !final && activity === undefined) return body;

  return (
    <>
      <ReasoningHeader live={live} final={final} htmlReactParserOptions={htmlReactParserOptions} />
      {body}
      {activity !== undefined && <LiveActivity text={activity} />}
    </>
  );
};
