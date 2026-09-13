export type TagMetadata = {
  set_by: string;
  set_at: string;
  note?: string;
  data?: Record<string, unknown>;
};

export type ThreadTagsContent = {
  tags: Record<string, TagMetadata>;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isThreadTagsTombstone = (content: unknown): boolean =>
  isObject(content) && Object.keys(content).length === 0;

export const parseThreadTagsContent = (
  content: unknown
): Record<string, TagMetadata> | null => {
  if (!isObject(content) || isThreadTagsTombstone(content)) return null;

  const { tags } = content;
  if (!isObject(tags)) return null;

  const result: Record<string, TagMetadata> = {};

  for (const [key, value] of Object.entries(tags)) {
    if (!isObject(value)) continue;
    const { set_by, set_at } = value;
    if (typeof set_by !== 'string' || typeof set_at !== 'string') continue;

    result[key] = {
      set_by,
      set_at,
      note: typeof value.note === 'string' ? value.note : undefined,
      data: isObject(value.data) ? (value.data as Record<string, unknown>) : undefined,
    };
  }

  return Object.keys(result).length > 0 ? result : null;
};

export const getTagNames = (tags: Record<string, TagMetadata> | null): string[] =>
  tags ? Object.keys(tags) : [];

export const isThreadResolvedFromContent = (content: unknown): boolean => {
  const tags = parseThreadTagsContent(content);
  return tags !== null && 'resolved' in tags;
};

export const buildResolvedTagsContent = (
  resolvedBy: string,
  existingTags?: Record<string, TagMetadata> | null,
  now = new Date().toISOString()
): ThreadTagsContent => ({
  tags: {
    ...(existingTags ?? {}),
    resolved: {
      set_by: resolvedBy,
      set_at: now,
    },
  },
});

export const buildUnresolvedTagsContent = (
  existingTags?: Record<string, TagMetadata> | null
): ThreadTagsContent => {
  if (!existingTags) return { tags: {} };

  const { resolved: _, ...rest } = existingTags;
  return { tags: rest };
};
