/**
 * Thread tag types, parsers, and builders for com.mindroom.thread.tags state events.
 *
 * State event shape:
 *   type: "com.mindroom.thread.tags"
 *   state_key: thread root event ID
 *   content: { tags: Record<string, TagMetadata> }
 *
 * The reserved tag name "resolved" is used for thread resolution status.
 */

export const RESOLVED_TAG = 'resolved';
export const MAX_TAG_LENGTH = 50;

export type TagMetadata = {
  set_by: string;
  set_at: number;
};

export type ThreadTagsContent = {
  tags: Record<string, TagMetadata>;
};

/**
 * Parse raw state event content into a typed ThreadTagsContent.
 * Returns empty tags for invalid or missing content.
 */
export const parseThreadTagsContent = (content: unknown): ThreadTagsContent => {
  if (
    content != null &&
    typeof content === 'object' &&
    'tags' in content &&
    content.tags != null &&
    typeof content.tags === 'object'
  ) {
    return { tags: content.tags as Record<string, TagMetadata> };
  }
  return { tags: {} };
};

/**
 * Check whether thread tags content represents a tombstoned / empty state.
 */
export const isThreadTagsTombstone = (content: unknown): boolean => {
  const parsed = parseThreadTagsContent(content);
  return Object.keys(parsed.tags).length === 0;
};

/**
 * Build content that adds a tag while preserving existing tags.
 */
export const buildAddTagContent = (
  existing: ThreadTagsContent,
  tagName: string,
  userId: string
): ThreadTagsContent => ({
  tags: {
    ...existing.tags,
    [tagName]: { set_by: userId, set_at: Date.now() },
  },
});

/**
 * Build content that removes a tag while preserving others.
 */
export const buildRemoveTagContent = (
  existing: ThreadTagsContent,
  tagName: string
): ThreadTagsContent => {
  const next = { ...existing.tags };
  delete next[tagName];
  return { tags: next };
};

/**
 * Build content that sets the thread as resolved, preserving existing tags.
 */
export const buildResolvedTagsContent = (
  existing: ThreadTagsContent,
  userId: string
): ThreadTagsContent => buildAddTagContent(existing, RESOLVED_TAG, userId);

/**
 * Build content that removes the resolved tag, preserving other tags.
 */
export const buildUnresolvedTagsContent = (
  existing: ThreadTagsContent
): ThreadTagsContent => buildRemoveTagContent(existing, RESOLVED_TAG);

/**
 * Get display tags (all tags except the reserved "resolved" tag).
 */
export const getDisplayTags = (content: ThreadTagsContent): string[] =>
  Object.keys(content.tags).filter((name) => name !== RESOLVED_TAG);

/**
 * Check if a thread is resolved.
 */
export const isThreadResolved = (content: ThreadTagsContent): boolean =>
  RESOLVED_TAG in content.tags;

/**
 * Collect unique tag names from multiple thread tag events, excluding "resolved".
 */
export const collectAvailableTags = (
  allTagContents: ThreadTagsContent[],
  currentTags: Record<string, TagMetadata>
): string[] => {
  const seen = new Set<string>();
  allTagContents.forEach((content) => {
    Object.keys(content.tags).forEach((name) => {
      if (name !== RESOLVED_TAG && !(name in currentTags)) {
        seen.add(name);
      }
    });
  });
  return Array.from(seen).sort();
};

/**
 * Normalize a tag name: trim whitespace and lowercase.
 */
export const normalizeTagName = (input: string): string => input.trim().toLowerCase();

/**
 * Validate a tag name. Returns true if the name is valid for use.
 */
export const isValidTagName = (name: string): boolean => {
  const normalized = normalizeTagName(name);
  return normalized.length > 0 && normalized.length <= MAX_TAG_LENGTH && normalized !== RESOLVED_TAG;
};
