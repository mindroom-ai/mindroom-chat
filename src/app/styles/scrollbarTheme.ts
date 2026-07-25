import { butterNeutralOn, darkNeutralOn, lightNeutralOn } from '../theme/neutralColors';

export const SCROLLBAR_THUMB_OPACITY = 0.55;

const withScrollbarOpacity = (hex: string): string => {
  const alpha = Math.round(SCROLLBAR_THUMB_OPACITY * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();

  return `${hex}${alpha}`;
};

export const scrollbarThumbColors = {
  light: withScrollbarOpacity(lightNeutralOn),
  dark: withScrollbarOpacity(darkNeutralOn),
  butter: withScrollbarOpacity(butterNeutralOn),
} as const;
