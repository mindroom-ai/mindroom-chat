/** An emoji, or the `mxc://` URL of an image. */











const readTag = (value: unknown): PowerLevelTag | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const { name, color, icon } = value as Record<string, unknown>;
  if (typeof name !== 'string' || name.trim().length === 0) return undefined;
  const tag: PowerLevelTag = { name };
  if (typeof color === 'string') tag.color = color;
  if (icon && typeof icon === 'object' && typeof (icon as { key?: unknown }).key === 'string') {
    tag.icon = { key: (icon as { key: string }).key };
  }
  return tag;
};

/** The valid tags of a power level tags state event's content; anyone may write it. */
export const readPowerLevelTags = (content: unknown): PowerLevelTags => {
  const tags: PowerLevelTags = {};
  if (!content || typeof content !== 'object') return tags;
  Object.entries(content as Record<string, unknown>).forEach(([level, value]) => {
    const powerLevel = Number(level);
    const tag = readTag(value);
    if (Number.isFinite(powerLevel) && tag) tags[powerLevel] = tag;
  });
  return tags;
};
