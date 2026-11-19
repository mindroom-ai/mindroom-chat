import { toRem } from 'folds';
import type { ReasoningLevel } from './modelProtocol';

/** The glyph's height, the composer icon's less its padding; every bar fits it in whole pixels. */
const GLYPH_HEIGHT = 12;
const BAR_WIDTH = 2;
/** A bar and the gap after it. */
const BAR_STEP = 4;

/**
 * The bars for a model's `levels` at `level`: one per level besides `off`, filled up to `level`,
 * none filled at `off`.
 */
export const effortBars = (
  levels: readonly ReasoningLevel[],
  level: ReasoningLevel
): { count: number; filled: number } => {
  const bars = levels.filter((candidate) => candidate !== 'off');
  return { count: bars.length, filled: bars.indexOf(level) + 1 };
};

/** Bar heights that rise by one whole-pixel step, from about half height up to `maxBar`. */
export const effortBarHeights = (count: number, maxBar: number): number[] => {
  // Rounding each bar on its own mixes 1 px and 2 px steps, so the step is rounded once.
  const step = Math.max(1, Math.round(maxBar / 2 / Math.max(count - 1, 1)));
  return Array.from({ length: count }, (_, index) =>
    Math.max(1, maxBar - (count - 1 - index) * step)
  );
};

/**
 * Rising bars on whole pixels, sharp on 1x displays at 100 % Page Zoom; drawn in rem, so they scale
 * with the zoom like the logo before them. Their color follows the text.
 */
export function EffortGlyph({
  count,
  filled,
  className,
}: {
  count: number;
  filled: number;
  className?: string;
}) {
  const width = BAR_STEP * count - (BAR_STEP - BAR_WIDTH);
  return (
    <svg
      aria-hidden="true"
      width={width}
      height={GLYPH_HEIGHT}
      style={{ width: toRem(width), height: toRem(GLYPH_HEIGHT) }}
      viewBox={`0 0 ${width} ${GLYPH_HEIGHT}`}
      className={className}
      data-effort-glyph=""
    >
      {effortBarHeights(count, GLYPH_HEIGHT).map((height, index) => (
        <rect
          // The bars are positions; they never reorder.
          // eslint-disable-next-line react/no-array-index-key
          key={index}
          x={index * BAR_STEP}
          y={GLYPH_HEIGHT - height}
          width={BAR_WIDTH}
          height={height}
          fill="currentColor"
          opacity={index < filled ? 1 : 0.4}
          data-filled={index < filled}
        />
      ))}
    </svg>
  );
}
