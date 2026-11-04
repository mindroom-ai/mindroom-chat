import { createInsideUrlTest } from '../../../utils/regex';

// Inline code is cut out of the text before any other rule runs, so Markdown inside it stays
// literal and a rule can never end inside it: `**a `**` b**` is bold around the code `**`.
// Each code span becomes one placeholder character taken from the Unicode private use areas,
// one the text does not contain, so placeholders cannot be confused with what the sender wrote.
// After the rules ran, a placeholder in element text becomes the `<code>` element, and one inside
// a tag (an `href`, for example) becomes the code's source again.

type CodeSpan = {
  /** The span as written, backticks included. */
  source: string;
  html: string;
};

const PRIVATE_USE_CHARACTER = /[-]|[\uDB80-\uDBFF][\uDC00-\uDFFF]/g;
const PRIVATE_USE_RANGES: Array<[number, number]> = [
  [0xe000, 0xf8ff],
  [0xf0000, 0xffffd],
  [0x100000, 0x10fffd],
];

/** Code spans of the parses running now, innermost last; placeholders resolve through all. */
const activeSpans: Map<string, CodeSpan>[] = [];

function* unusedPrivateCharacters(text: string): Generator<string> {
  const used = new Set(text.match(PRIVATE_USE_CHARACTER) ?? []);
  activeSpans.forEach((spans) => spans.forEach((_, placeholder) => used.add(placeholder)));
  for (const [first, last] of PRIVATE_USE_RANGES) {
    for (let codePoint = first; codePoint <= last; codePoint += 1) {
      const character = String.fromCodePoint(codePoint);
      if (!used.has(character)) yield character;
    }
  }
}

const isEscaped = (text: string, index: number): boolean => {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
};

type BacktickRun = { start: number; length: number };

const findBacktickRuns = (text: string): BacktickRun[] => {
  const runs: BacktickRun[] = [];
  for (let start = text.indexOf('`'); start >= 0; start = text.indexOf('`', start)) {
    let end = start;
    while (text[end] === '`') end += 1;
    runs.push({ start, length: end - start });
    start = end;
  }
  return runs;
};

type FoundSpan = { start: number; end: number; ticks: string; content: string };

/**
 * The code spans of `text`: a run of backticks up to the next run of exactly the same length,
 * with something in between. An escaped first backtick is literal, so its run opens one later;
 * a run that starts inside a URL opens nothing, so `https://a.b/`c`` stays one URL. Closing runs
 * are taken as written, since a backslash inside code is code.
 */
const findCodeSpans = (text: string): FoundSpan[] => {
  const runs = findBacktickRuns(text);
  if (runs.length < 2) return [];
  const insideUrl = createInsideUrlTest(text);
  // The runs of each length in order, and how far the scan has passed through each list.
  const runsOfLength = new Map<number, BacktickRun[]>();
  runs.forEach((run) => {
    const list = runsOfLength.get(run.length) ?? [];
    list.push(run);
    runsOfLength.set(run.length, list);
  });
  const passed = new Map<number, number>();
  const findCloser = (length: number, from: number): BacktickRun | undefined => {
    const list = runsOfLength.get(length) ?? [];
    let position = passed.get(length) ?? 0;
    // Past the end of the list, `start` reads as `from` and the loop stops.
    while ((list[position]?.start ?? from) < from) position += 1;
    passed.set(length, position);
    return list[position];
  };

  const spans: FoundSpan[] = [];
  let scanned = 0;
  runs.forEach((run) => {
    if (run.start < scanned) return;
    const escaped = isEscaped(text, run.start);
    const start = escaped ? run.start + 1 : run.start;
    const length = escaped ? run.length - 1 : run.length;
    if (length === 0 || insideUrl(start)) return;
    const closer = findCloser(length, start + length + 1);
    if (!closer) return;
    const end = closer.start + closer.length;
    spans.push({
      start,
      end,
      ticks: text.slice(start, start + length),
      content: text.slice(start + length, closer.start),
    });
    scanned = end;
  });
  return spans;
};

/**
 * Renders `text` with its code spans protected: `render` gets the text with each span replaced
 * by a placeholder and returns HTML, in which the placeholders are then filled in.
 */
export const withProtectedCode = (text: string, render: (masked: string) => string): string => {
  const found = findCodeSpans(text);
  const spans = new Map<string, CodeSpan>();
  let masked = text;
  if (found.length > 0) {
    const placeholders = unusedPrivateCharacters(text);
    let cursor = 0;
    masked = '';
    found.forEach((span) => {
      const next = placeholders.next();
      if (next.done) return;
      masked += text.slice(cursor, span.start) + next.value;
      spans.set(next.value, {
        source: text.slice(span.start, span.end),
        html: `<code data-md="${span.ticks}">${span.content}</code>`,
      });
      cursor = span.end;
    });
    masked += text.slice(cursor);
  }

  activeSpans.push(spans);
  try {
    const html = render(masked);
    return spans.size > 0 ? fillPlaceholders(html, spans) : html;
  } finally {
    activeSpans.pop();
  }
};

const lookUp = (placeholder: string): CodeSpan | undefined =>
  activeSpans.findLast((spans) => spans.has(placeholder))?.get(placeholder);

/** `text` with the placeholders of the running parses turned back into the code as written. */
export const restoreCodeSource = (text: string): string =>
  text.replace(PRIVATE_USE_CHARACTER, (character) => lookUp(character)?.source ?? character);

const fillPlaceholders = (html: string, spans: Map<string, CodeSpan>): string => {
  let output = '';
  let inTag = false;
  let cursor = 0;
  for (const found of html.matchAll(PRIVATE_USE_CHARACTER)) {
    const offset = found.index ?? 0;
    const between = html.slice(cursor, offset);
    const open = between.lastIndexOf('<');
    const close = between.lastIndexOf('>');
    if (open > close) inTag = true;
    else if (close > open) inTag = false;
    const span = spans.get(found[0]);
    output += between;
    if (!span) output += found[0];
    else output += inTag ? span.source : span.html;
    cursor = offset + found[0].length;
  }
  return output + html.slice(cursor);
};
