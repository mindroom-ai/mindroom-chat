import { isRecord } from '../../lib/isRecord';

/** On an agent reply: the widgets its body shows as `mindroom-ui-<id>` fallback blocks. */
export const UI_WIDGETS_KEY = 'io.mindroom.ui';
/** On a user's answer to a form widget (Stage 2); never inherited from another edit. */
export const UI_RESPONSE_KEY = 'io.mindroom.ui_response';

export type UiWidgetsContent = { widgets: { id: string; json: string }[] };

const MAX_WIDGETS = 8;
const MAX_JSON_BYTES = 16384;
const ID_PATTERN = /^[0-9a-f]{10}$/;
const MARKER_CLASS_PATTERN = /^language-mindroom-ui-([0-9a-f]{10})$/;
const MARKER_OPENING = /^(`{3,}|~{3,})mindroom-ui-[0-9a-f]{10}[ \t]*$/;

const utf8Length = (text: string): number => new TextEncoder().encode(text).length;

/**
 * The `io.mindroom.ui` value of `content`, or undefined unless it is a version 1 value with one to
 * eight entries, each id once, and at most 16,384 UTF-8 bytes over all `json` strings. The JSON
 * itself is checked by the widget's own validator.
 */
export const readUiWidgets = (content: Record<string, unknown>): UiWidgetsContent | undefined => {
  const value = content[UI_WIDGETS_KEY];
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.widgets)) return undefined;
  const entries: unknown[] = value.widgets;
  if (entries.length === 0 || entries.length > MAX_WIDGETS) return undefined;
  const widgets: UiWidgetsContent['widgets'] = [];
  const ids = new Set<string>();
  let bytes = 0;
  for (const entry of entries) {
    if (!isRecord(entry)) return undefined;
    const { id, json } = entry;
    if (typeof id !== 'string' || !ID_PATTERN.test(id) || ids.has(id)) return undefined;
    if (typeof json !== 'string') return undefined;
    bytes += utf8Length(json);
    if (bytes > MAX_JSON_BYTES) return undefined;
    ids.add(id);
    widgets.push({ id, json });
  }
  return { widgets };
};

/** The widget id of a fallback block's `<code>` class, only when the class is exactly the marker. */
export const readUiMarkerId = (codeClassName: string | undefined): string | undefined =>
  codeClassName ? MARKER_CLASS_PATTERN.exec(codeClassName)?.[1] : undefined;

/**
 * `body` without its `mindroom-ui-` fenced blocks, so their labels never become link previews. A
 * marker fence in column 0 always starts one, even where another fence looks open: cutting too much
 * only loses a preview, and a label never becomes one.
 */
export const stripUiFallbackBlocks = (body: string): string => {
  if (!body.includes('mindroom-ui-')) return body;
  const kept: string[] = [];
  let fence: string | undefined;
  body.split('\n').forEach((line) => {
    if (fence === undefined) {
      fence = MARKER_OPENING.exec(line)?.[1];
      if (fence === undefined) kept.push(line);
      return;
    }
    // A closing fence: the same character, at least as long, indented at most three spaces.
    const closing = line.trim();
    const closes = closing.length >= fence.length && closing === fence[0]!.repeat(closing.length);
    if (closes && /^ {0,3}\S/.test(line)) fence = undefined;
  });
  return kept.join('\n');
};
