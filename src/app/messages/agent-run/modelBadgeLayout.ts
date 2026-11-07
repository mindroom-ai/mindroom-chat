export const getModelBadgeMaxWidth = (avatarWidth: string, overhang: string): string =>
  `calc(${avatarWidth} + 2 * ${overhang})`;
