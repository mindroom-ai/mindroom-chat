import {
  COMPACT_THREAD_SECTION_ORDER,
  normalizeCompactSectionOrder,
  type CompactThreadSection,
  type CompactThreadSectionId,
} from './compactThreadSections';

/** Minimum readable width of an expanded workflow column (`20rem`). */
export const COMPACT_COLUMN_MIN_WIDTH_PX = 320;
/** Width of a 90°-angled collapsed workflow rail (`2.5rem`). */
export const COMPACT_COLLAPSED_RAIL_WIDTH_PX = 40;
/** Horizontal gap between adjacent workflow columns and rails. */
export const COMPACT_COLUMN_GAP_PX = 10;
/** Combined inline padding around the columns board (`2 * S300`). */
export const COMPACT_BOARD_INLINE_PADDING_PX = 24;
/** Minimum width an expanded column shrinks to before horizontal scrolling begins. */
export const COMPACT_OPEN_COLUMN_MIN_WIDTH_PX = 280;
/** Flex basis for each expanded column. */
export const COMPACT_OPEN_COLUMN_BASIS_PX = 300;
/** Maximum width when a single column is open, preventing ultra-wide stretched cards. */
export const COMPACT_SINGLE_OPEN_COLUMN_MAX_WIDTH_PX = 780;

const MIN_OPEN_COLUMNS_FOR_BOARD = 2;
const REMAINING_COLLAPSED_RAILS = COMPACT_THREAD_SECTION_ORDER.length - MIN_OPEN_COLUMNS_FOR_BOARD;
const COLUMN_GAP_COUNT = COMPACT_THREAD_SECTION_ORDER.length - 1;

/**
 * Structural width threshold for enabling Columns mode:
 * room for 2 readable open columns + 3 collapsed rails + 4 inter-column gaps + board inline padding.
 */
export const COMPACT_COLUMNS_MIN_WIDTH_PX =
  MIN_OPEN_COLUMNS_FOR_BOARD * COMPACT_COLUMN_MIN_WIDTH_PX +
  REMAINING_COLLAPSED_RAILS * COMPACT_COLLAPSED_RAIL_WIDTH_PX +
  COLUMN_GAP_COUNT * COMPACT_COLUMN_GAP_PX +
  COMPACT_BOARD_INLINE_PADDING_PX;

/** Initial card cap mounted per open column before progressive reveal. */
export const COMPACT_COLUMN_INITIAL_CARDS = 40;
/** Additional cards revealed per "Show more" step in an open column. */
export const COMPACT_COLUMN_CARDS_STEP = 40;

/**
 * Visible card IDs across open workflow columns (collapsed columns mount 0 cards, and open columns
 * respect their progressive cap so huge Done/Quiet buckets stay snappy).
 */
export const getVisibleColumnCardIds = (
  sections: readonly CompactThreadSection[],
  folded: readonly CompactThreadSectionId[],
  limits?: ReadonlyMap<CompactThreadSectionId, number>
): string[] => {
  const foldedSet = new Set(folded);
  const ids: string[] = [];
  for (const section of sections) {
    if (foldedSet.has(section.id)) continue;
    const limit = limits?.get(section.id) ?? COMPACT_COLUMN_INITIAL_CARDS;
    const end = Math.min(section.rootIds.length, limit);
    for (let index = 0; index < end; index += 1) {
      const rootId = section.rootIds[index];
      if (rootId !== undefined) ids.push(rootId);
    }
  }
  return ids;
};

/**
 * Merges a reordered subset of visible (non-empty) sections back into the full persisted order,
 * preserving the relative slots of currently hidden empty sections.
 */
export const mergeVisibleSectionOrder = (
  fullOrder: readonly CompactThreadSectionId[],
  nextVisibleOrder: readonly CompactThreadSectionId[]
): CompactThreadSectionId[] => {
  const visibleSet = new Set(nextVisibleOrder);
  let cursor = 0;
  const merged = fullOrder.map((id) => {
    if (!visibleSet.has(id)) return id;
    const replacement = nextVisibleOrder[cursor];
    cursor += 1;
    return replacement ?? id;
  });
  return normalizeCompactSectionOrder([...merged, ...nextVisibleOrder]);
};
