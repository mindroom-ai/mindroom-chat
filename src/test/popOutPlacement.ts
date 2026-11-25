/**
 * Extracts the preferred pixel coordinate from folds' safe-area `clamp(...)` inline `top` / `left`
 * style (see `patches/folds+2.7.3.patch`).
 */
export const popOutPx = (value?: string): string | undefined =>
  value?.match(/^clamp\(.*, (-?\d+(?:\.\d+)?px), calc\(/)?.[1];
