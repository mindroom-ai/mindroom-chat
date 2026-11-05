type Direction = 'ltr' | 'rtl';

export type CommandPaletteTabKey = {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  /** The text in the search field. */
  query: string;
  selectionStart: number | null;
  selectionEnd: number | null;
  /** The person is moving through results: their last key was the up or down arrow. */
  navigating: boolean;
  /** Which way the typed text runs, which decides where its start and end are. */
  textDirection: Direction;
  /** Which way the tab row runs, which decides which tab sits to the right. */
  tabDirection: Direction;
};

/**
 * How many tabs a key in the search field moves: 1 to the next tab, -1 to the previous one, 0
 * when the key belongs to the field. Tab and Shift+Tab always switch. Left and right switch while
 * the field is empty or the person is moving through results; while they type, an arrow switches
 * only from the edge of the text it points past, so it still moves the caret everywhere else.
 */
export const getCommandPaletteTabStep = ({
  key,
  shiftKey,
  altKey,
  ctrlKey,
  metaKey,
  query,
  selectionStart,
  selectionEnd,
  navigating,
  textDirection,
  tabDirection,
}: CommandPaletteTabKey): -1 | 0 | 1 => {
  // With a modifier, an arrow selects text or jumps by word, and Tab belongs to the system.
  if (altKey || ctrlKey || metaKey) return 0;
  if (key === 'Tab') return shiftKey ? -1 : 1;
  if ((key !== 'ArrowLeft' && key !== 'ArrowRight') || shiftKey) return 0;

  const pointsRight = key === 'ArrowRight';
  const step = pointsRight === (tabDirection === 'ltr') ? 1 : -1;
  if (query.length === 0 || navigating) return step;

  // A selection collapses before the caret moves, so the arrow belongs to the field.
  if (selectionStart === null || selectionStart !== selectionEnd) return 0;
  const pointsPastEnd = pointsRight === (textDirection === 'ltr');
  const atEdge = pointsPastEnd ? selectionStart === query.length : selectionStart === 0;
  return atEdge ? step : 0;
};

/** The tab `step` places from `current`, wrapping around at either end of the row. */
export const getNextCommandPaletteTab = <T>(tabs: readonly T[], current: T, step: number): T => {
  const index = tabs.indexOf(current);
  const next = (index + step + tabs.length) % tabs.length;
  return tabs[next] ?? current;
};

/**
 * Where the highlight goes when the rows change: it stays on the row it was on, wherever that
 * row now is. A row that left hands the highlight to the row now at its place.
 */
export const getCommandPaletteHighlightIndex = (
  rowIds: readonly string[],
  highlightedId: string | undefined,
  previousIndex: number
): number => {
  if (rowIds.length === 0) return -1;
  const index = highlightedId === undefined ? -1 : rowIds.indexOf(highlightedId);
  if (index >= 0) return index;
  return Math.min(Math.max(previousIndex, 0), rowIds.length - 1);
};
