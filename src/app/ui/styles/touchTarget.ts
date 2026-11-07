import { globalStyle, type StyleRule } from '@vanilla-extract/css';

/** The smallest hit area a finger gets, as the platform guidelines put it. */
const MIN_TARGET = '44px';

/**
 * How far the layer reaches out on one axis: until the area is 44 px, `reach` at most. `reach` may
 * be a length or a theme variable; a minus sign before `var()` is not CSS, so `calc` negates it.
 */
const grow = (reach: string) =>
  `min(0px, max(calc((100% - ${MIN_TARGET}) / 2), calc(-1 * ${reach})))`;

type TouchTargetOptions = {
  /** How far the layer may reach out along the block axis, for controls stacked closer. */
  blockReach?: string;
  /** The pseudo-element that is the layer, for controls that draw with `::after`. */
  layer?: '::after' | '::before';
  /**
   * Lifts the control and its layer over the content that follows it, where that content is
   * positioned and would otherwise cover the layer.
   */
  raise?: boolean;
};

/**
 * Grows a small control's hit area to 44 px on a touch screen without changing how it looks: an
 * invisible layer over the control reaches out until the area is 44 px tall and 44 px wide. Along
 * the inline axis it reaches out at most `inlineReach` on each side, half the gap to the next
 * control, so two neighbours never share a point; `blockReach` limits the block axis the same way
 * for controls stacked closer than that. A control that is already larger keeps its own size.
 * `within` limits it to controls inside an ancestor matching that selector.
 */
export const touchTarget = (
  inlineReach: string,
  within = '',
  { blockReach = MIN_TARGET, layer = '::after', raise = false }: TouchTargetOptions = {}
): StyleRule => ({
  '@media': {
    '(pointer: coarse)': {
      selectors: {
        [`${within}&&`]: { position: 'relative', ...(raise ? { zIndex: 1 } : {}) },
        [`${within}&&${layer}`]: {
          content: '""',
          position: 'absolute',
          insetBlock: grow(blockReach),
          insetInline: grow(inlineReach),
        },
      },
    },
  },
});

/**
 * `touchTarget` for controls a selector picks out rather than their own class, such as the
 * buttons of a row. One selector, not a list.
 */
export const globalTouchTarget = (
  selector: string,
  inlineReach: string,
  { blockReach = MIN_TARGET, layer = '::after', raise = false }: TouchTargetOptions = {}
): void => {
  globalStyle(selector, {
    '@media': {
      '(pointer: coarse)': { position: 'relative', ...(raise ? { zIndex: 1 } : {}) },
    },
  });
  globalStyle(`${selector}${layer}`, {
    '@media': {
      '(pointer: coarse)': {
        content: '""',
        position: 'absolute',
        insetBlock: grow(blockReach),
        insetInline: grow(inlineReach),
      },
    },
  });
};
