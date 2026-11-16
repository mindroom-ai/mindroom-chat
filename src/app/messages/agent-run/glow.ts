import { toRem } from 'folds';

/** A soft light around what it is on, in the given color: the tool-call cog's and its comet's. */
export const glow = (of: string) =>
  `drop-shadow(0 0 ${toRem(1.5)} color-mix(in srgb, ${of} 75%, transparent))`;
