import type { TFunction } from 'i18next';
import { stripPreviewMath } from '../event-store/threads/previewMath';
import {
  getPreviewProseLines,
  stripPreviewMarkdown,
} from '../event-store/threads/threadMessagePreview';
import type { LiveDocs } from '../matrix/protocol/liveFrame';
import type { SubagentMeta } from '../matrix/protocol/subagentFrame';
import { revealDirectionControls } from '../ui/directional';
import { runLine, runToolCall, type ToolActivity } from './runActivity';

/**
 * A tool call in plain words ("Reading notes.md"), for readers who leave the usage details off:
 * a fixed table from the tool's name, filled from its arguments where it names a file, a query or
 * a page. No model is asked.
 */

/** The step phrases, under `mindroomUi.subagents.step`. */
type StepKey =
  | 'reading'
  | 'readingAny'
  | 'writing'
  | 'writingAny'
  | 'editing'
  | 'editingAny'
  | 'searchingFiles'
  | 'searchingFilesFor'
  | 'lookingThroughFiles'
  | 'runningCommand'
  | 'opening'
  | 'openingPage'
  | 'searchingWeb'
  | 'searchingWebFor'
  | 'askingHelper'
  | 'usingBrowser'
  | 'checkingMemory'
  | 'updatingMemory'
  | 'sendingMessage'
  | 'readingMessages'
  | 'editingMessage'
  | 'reactingToMessage'
  | 'usingMessages'
  | 'scheduling'
  | 'checkingSchedule'
  | 'updatingSchedule';

/** What a phrase names from the call's arguments. */
type StepArg = 'file' | 'query' | 'site';

/**
 * A row of the table: the phrase, and when it names something, which argument and the phrase
 * without it (`bare`), for a call that did not send it.
 */
type Step = { key: StepKey; arg?: undefined } | { key: StepKey; arg: StepArg; bare: StepKey };

const READING: Step = { key: 'reading', arg: 'file', bare: 'readingAny' };
const WRITING: Step = { key: 'writing', arg: 'file', bare: 'writingAny' };
const EDITING: Step = { key: 'editing', arg: 'file', bare: 'editingAny' };
const SEARCHING_FILES: Step = { key: 'searchingFilesFor', arg: 'query', bare: 'searchingFiles' };
const OPENING: Step = { key: 'opening', arg: 'site', bare: 'openingPage' };
const SEARCHING_WEB: Step = { key: 'searchingWebFor', arg: 'query', bare: 'searchingWeb' };

/** Each phrase and the tools (MindRoom's own and its bundled toolkits') that it stands for. */
const STEP_TABLE: readonly (readonly [Step, readonly string[]])[] = [
  [READING, ['read_file', 'read_file_chunk']],
  [WRITING, ['write_file', 'save_file']],
  [EDITING, ['edit_file', 'replace_file_chunk']],
  [SEARCHING_FILES, ['grep', 'search_content', 'search_files']],
  [{ key: 'lookingThroughFiles' }, ['find_files', 'ls', 'list_files']],
  [{ key: 'runningCommand' }, ['run_shell_command', 'shell', 'run_shell']],
  [OPENING, ['read_url', 'read', 'crawl', 'scrape_webpage']],
  [
    SEARCHING_WEB,
    [
      'search_google',
      'search_news',
      'google_search',
      'web_search',
      'duckduckgo_search',
      'search_web',
    ],
  ],
  [{ key: 'askingHelper' }, ['run_subagent', 'continue_subagent']],
  [{ key: 'checkingMemory' }, ['search_memories', 'list_memories', 'get_memory']],
  [{ key: 'updatingMemory' }, ['add_memory', 'update_memory', 'delete_memory']],
  [{ key: 'scheduling' }, ['schedule', 'schedule_tool_call']],
  [{ key: 'checkingSchedule' }, ['list_schedules']],
  [{ key: 'updatingSchedule' }, ['edit_schedule', 'cancel_schedule']],
];

const STEPS: ReadonlyMap<string, Step> = new Map(
  STEP_TABLE.flatMap(([step, tools]) => tools.map((tool) => [tool, step] as const))
);

/**
 * Tools whose `action` argument says what they do: each action's phrase, and a neutral one for
 * any other or none (a long preview may be cut before it).
 */
const ACTION_STEPS: ReadonlyMap<string, { actions: ReadonlyMap<string, StepKey>; other: StepKey }> =
  new Map([
    [
      'matrix_message',
      {
        actions: new Map<string, StepKey>([
          ['send', 'sendingMessage'],
          ['read', 'readingMessages'],
          ['edit', 'editingMessage'],
          ['react', 'reactingToMessage'],
        ]),
        other: 'usingMessages',
      },
    ],
  ]);

/** Every browser tool (`browser`, `browser_control`, …) uses the browser. */
const BROWSER: Step = { key: 'usingBrowser' };

/** The arguments each named thing is read from, the first one sent winning. */
const ARG_KEYS: Record<StepArg, readonly string[]> = {
  file: ['path', 'file_path', 'file_name', 'filename'],
  query: ['pattern', 'query'],
  site: ['url'],
};

/** How long a query may run in a phrase before it is cut. */
const QUERY_CHARS = 40;

/**
 * An argument from a call's preview (`key=value, key=value`, MindRoom's `_format_tool_args`).
 * A value may hold `, ` itself, so a key counts only at the start or after `, `, and its value
 * runs to the next `, <name>=` or the end. Quotes around it are dropped.
 */
export const toolArg = (preview: string | undefined, key: string): string | undefined => {
  if (!preview) return undefined;
  const match = new RegExp(`(?:^|, )${key}=(.*?)(?=, [A-Za-z_][A-Za-z0-9_]*=|$)`).exec(preview);
  const value = match?.[1]
    ?.trim()
    .replace(/^(["'])(.*)\1$/, '$2')
    .trim();
  return value || undefined;
};

/** The file's own name, without its folders. */
const baseName = (path: string): string => {
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
};

/** The page's host ("example.org"), or nothing for a value that is no web address. */
const hostName = (url: string): string | undefined => {
  try {
    const { hostname } = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`);
    return hostname.replace(/^www\./, '') || undefined;
  } catch {
    return undefined;
  }
};

/** The query, cut by whole characters (code points) past `QUERY_CHARS`, so no emoji is split. */
const shortQuery = (query: string): string => {
  const chars = Array.from(query);
  return chars.length > QUERY_CHARS
    ? `${chars
        .slice(0, QUERY_CHARS - 1)
        .join('')
        .trimEnd()}…`
    : query;
};

/** The named thing of a phrase, from the call's arguments; none when the call sent none. */
const stepValue = (arg: StepArg, preview: string | undefined): string | undefined => {
  const value = ARG_KEYS[arg].map((key) => toolArg(preview, key)).find(Boolean);
  if (!value) return undefined;
  let shown: string | undefined;
  if (arg === 'query') shown = shortQuery(value);
  if (arg === 'file') shown = baseName(value);
  if (arg === 'site') shown = hostName(value);
  // A name the call sent shows its direction controls, so none can reorder the phrase.
  return shown && revealDirectionControls(shown);
};

/**
 * The call as sent, its tool then its arguments, for the tooltip of its plain words; its direction
 * controls written out, so the tooltip reads in the order the call holds.
 */
export const toolCallTitle = ({ tool, preview }: ToolActivity): string =>
  revealDirectionControls(preview ? `${tool} ${preview}` : tool);

/** A tool call in plain words: its row of the table, else "Using" its name in words. */
export const toolStep = (activity: ToolActivity, t: TFunction): string => {
  const { tool, preview } = activity;
  const byAction = ACTION_STEPS.get(tool);
  if (byAction) {
    const action = toolArg(preview, 'action');
    const key = (action && byAction.actions.get(action)) || byAction.other;
    return t(`mindroomUi.subagents.step.${key}`);
  }
  const step = STEPS.get(tool) ?? (tool.startsWith('browser') ? BROWSER : undefined);
  if (!step) {
    const name = revealDirectionControls(tool.replace(/_+/g, ' ').trim());
    return t('mindroomUi.subagents.step.using', { tool: name });
  }
  if (!step.arg) return t(`mindroomUi.subagents.step.${step.key}`);
  const value = stepValue(step.arg, preview);
  if (value === undefined) return t(`mindroomUi.subagents.step.${step.bare}`);
  const values: Partial<Record<StepArg, string>> = { [step.arg]: value };
  return t(`mindroomUi.subagents.step.${step.key}`, values);
};

/**
 * How long a line may be, in UTF-16 units, for its Markdown to be read; a longer one is cut first,
 * without the half of a character the cut would split.
 */
const LINE_CHARS = 2000;

/**
 * The last line of what a run wrote, as plain text, for a run that thinks between calls; nothing
 * before it wrote a word. The lines are told apart from code blocks and tool markers as a thread
 * preview tells them (`getPreviewProseLines`); only the last ones, from the end, are cleaned of
 * their Markdown as a preview is, until one says something.
 */
export const lastWrittenLine = (md: string): string | undefined => {
  const lines = getPreviewProseLines(md);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? '';
    if (line.trim()) {
      const bounded =
        line.length > LINE_CHARS ? line.slice(0, LINE_CHARS).replace(/[\uD800-\uDBFF]$/, '') : line;
      const text = stripPreviewMath(bounded, stripPreviewMarkdown).replace(/\s+/g, ' ').trim();
      if (/[\p{L}\p{N}]/u.test(text)) return text;
    }
  }
  return undefined;
};

/** Each documents' last written line, read once however often a clock or a selector asks. */
const writtenLines = new WeakMap<LiveDocs, string | null>();

/**
 * The line a running run between calls shows (`lastWrittenLine`), its direction controls written
 * out; nothing for a run that makes a call, waits or ended. The jobs bar redraws when it changes.
 */
export const runWrittenLine = (run: { meta: SubagentMeta; docs: LiveDocs }): string | undefined => {
  if (run.meta.status !== 'running' || runToolCall(run)) return undefined;
  let line = writtenLines.get(run.docs);
  if (line === undefined) {
    const text = lastWrittenLine(run.docs.md);
    line = text === undefined ? null : revealDirectionControls(text);
    writtenLines.set(run.docs, line);
  }
  return line ?? undefined;
};

/**
 * What a run at work does now, in plain words: the call that waits for the reader's OK, the call
 * it makes, else the last line it wrote, else that it thinks. Nothing for a run that is not at it
 * (paused or ended), whose line stays as it was.
 */
export const runStepText = (
  run: { meta: SubagentMeta; docs: LiveDocs },
  t: TFunction
): string | undefined => {
  const line = runLine(run, undefined, undefined);
  if (line.kind === 'approval')
    return t('mindroomUi.subagents.step.waitingForOk', { step: toolStep(line.activity, t) });
  if (line.kind === 'now')
    return t('mindroomUi.subagents.step.doing', { step: toolStep(line.activity, t) });
  if (run.meta.status !== 'running') return undefined;
  return runWrittenLine(run) ?? t('mindroomUi.messages.mindroomThinkingPlaceholder.thinking');
};
