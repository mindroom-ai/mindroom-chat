export const getModelBadgeMaxWidth = (
  avatarWidth: string,
  messageLayoutGap: string
): string => `calc(${avatarWidth} + ${messageLayoutGap} + ${messageLayoutGap})`;
