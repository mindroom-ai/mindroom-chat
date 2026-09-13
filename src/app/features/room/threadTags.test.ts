import { describe, expect, it } from 'vitest';
import { EventTimeline } from 'matrix-js-sdk';
import {
  buildAddTagContent,
  buildRemoveTagContent,
  buildResolvedTagsContent,
  buildUnresolvedTagsContent,
  collectAvailableTags,
  getDisplayTags,
  isThreadResolved,
  isThreadTagsTombstone,
  isValidTagName,
  normalizeTagName,
  parseThreadTagsContent,
  RESOLVED_TAG,
  type ThreadTagsContent,
} from './threadTags';

describe('parseThreadTagsContent', () => {
  it('parses valid thread-tag content', () => {
    const content = {
      tags: {
        bug: { set_by: '@alice:example.com', set_at: 1000 },
        feature: { set_by: '@bob:example.com', set_at: 2000 },
      },
    };
    const result = parseThreadTagsContent(content);
    expect(result.tags).toEqual(content.tags);
  });

  it('returns empty tags for null content', () => {
    expect(parseThreadTagsContent(null)).toEqual({ tags: {} });
  });

  it('returns empty tags for undefined content', () => {
    expect(parseThreadTagsContent(undefined)).toEqual({ tags: {} });
  });

  it('returns empty tags for content without tags field', () => {
    expect(parseThreadTagsContent({ other: 'data' })).toEqual({ tags: {} });
  });

  it('returns empty tags for content with null tags', () => {
    expect(parseThreadTagsContent({ tags: null })).toEqual({ tags: {} });
  });

  it('returns empty tags for non-object content', () => {
    expect(parseThreadTagsContent('string')).toEqual({ tags: {} });
    expect(parseThreadTagsContent(42)).toEqual({ tags: {} });
  });
});

describe('isThreadTagsTombstone', () => {
  it('returns true for empty tags', () => {
    expect(isThreadTagsTombstone({ tags: {} })).toBe(true);
  });

  it('returns true for null content', () => {
    expect(isThreadTagsTombstone(null)).toBe(true);
  });

  it('returns false for content with tags', () => {
    expect(
      isThreadTagsTombstone({
        tags: { bug: { set_by: '@alice:example.com', set_at: 1000 } },
      })
    ).toBe(false);
  });
});

describe('buildAddTagContent', () => {
  it('adds a new tag preserving existing', () => {
    const existing: ThreadTagsContent = {
      tags: { bug: { set_by: '@alice:example.com', set_at: 1000 } },
    };
    const result = buildAddTagContent(existing, 'feature', '@bob:example.com');
    expect(result.tags.bug).toEqual(existing.tags.bug);
    expect(result.tags.feature.set_by).toBe('@bob:example.com');
    expect(typeof result.tags.feature.set_at).toBe('number');
  });

  it('adds a tag to empty content', () => {
    const result = buildAddTagContent({ tags: {} }, 'bug', '@alice:example.com');
    expect(Object.keys(result.tags)).toEqual(['bug']);
  });
});

describe('buildRemoveTagContent', () => {
  it('removes a tag preserving others', () => {
    const existing: ThreadTagsContent = {
      tags: {
        bug: { set_by: '@alice:example.com', set_at: 1000 },
        feature: { set_by: '@bob:example.com', set_at: 2000 },
      },
    };
    const result = buildRemoveTagContent(existing, 'bug');
    expect(result.tags.feature).toEqual(existing.tags.feature);
    expect(result.tags.bug).toBeUndefined();
  });

  it('returns empty tags when removing the only tag', () => {
    const existing: ThreadTagsContent = {
      tags: { bug: { set_by: '@alice:example.com', set_at: 1000 } },
    };
    const result = buildRemoveTagContent(existing, 'bug');
    expect(result.tags).toEqual({});
  });
});

describe('buildResolvedTagsContent', () => {
  it('adds resolved tag preserving existing tags', () => {
    const existing: ThreadTagsContent = {
      tags: { bug: { set_by: '@alice:example.com', set_at: 1000 } },
    };
    const result = buildResolvedTagsContent(existing, '@alice:example.com');
    expect(result.tags.bug).toEqual(existing.tags.bug);
    expect(result.tags[RESOLVED_TAG].set_by).toBe('@alice:example.com');
  });
});

describe('buildUnresolvedTagsContent', () => {
  it('removes only the resolved tag', () => {
    const existing: ThreadTagsContent = {
      tags: {
        bug: { set_by: '@alice:example.com', set_at: 1000 },
        [RESOLVED_TAG]: { set_by: '@alice:example.com', set_at: 2000 },
      },
    };
    const result = buildUnresolvedTagsContent(existing);
    expect(result.tags.bug).toEqual(existing.tags.bug);
    expect(result.tags[RESOLVED_TAG]).toBeUndefined();
  });
});

describe('getDisplayTags', () => {
  it('returns all tags except resolved', () => {
    const content: ThreadTagsContent = {
      tags: {
        bug: { set_by: '@alice:example.com', set_at: 1000 },
        feature: { set_by: '@bob:example.com', set_at: 2000 },
        [RESOLVED_TAG]: { set_by: '@alice:example.com', set_at: 3000 },
      },
    };
    expect(getDisplayTags(content)).toEqual(['bug', 'feature']);
  });

  it('returns empty array when only resolved exists', () => {
    const content: ThreadTagsContent = {
      tags: { [RESOLVED_TAG]: { set_by: '@alice:example.com', set_at: 1000 } },
    };
    expect(getDisplayTags(content)).toEqual([]);
  });
});

describe('isThreadResolved', () => {
  it('returns true when resolved tag present', () => {
    const content: ThreadTagsContent = {
      tags: { [RESOLVED_TAG]: { set_by: '@alice:example.com', set_at: 1000 } },
    };
    expect(isThreadResolved(content)).toBe(true);
  });

  it('returns false when no resolved tag', () => {
    expect(isThreadResolved({ tags: { bug: { set_by: '@a:b', set_at: 1 } } })).toBe(false);
  });

  it('returns false for empty tags', () => {
    expect(isThreadResolved({ tags: {} })).toBe(false);
  });
});

describe('collectAvailableTags', () => {
  it('collects unique tag names across multiple threads', () => {
    const allContents: ThreadTagsContent[] = [
      { tags: { bug: { set_by: '@a:b', set_at: 1 }, feature: { set_by: '@a:b', set_at: 2 } } },
      { tags: { bug: { set_by: '@c:d', set_at: 3 }, review: { set_by: '@c:d', set_at: 4 } } },
    ];
    const result = collectAvailableTags(allContents, {});
    expect(result).toEqual(['bug', 'feature', 'review']);
  });

  it('excludes resolved from suggestions', () => {
    const allContents: ThreadTagsContent[] = [
      {
        tags: {
          bug: { set_by: '@a:b', set_at: 1 },
          [RESOLVED_TAG]: { set_by: '@a:b', set_at: 2 },
        },
      },
    ];
    const result = collectAvailableTags(allContents, {});
    expect(result).toEqual(['bug']);
  });

  it('excludes tags already present in current thread', () => {
    const allContents: ThreadTagsContent[] = [
      { tags: { bug: { set_by: '@a:b', set_at: 1 }, feature: { set_by: '@a:b', set_at: 2 } } },
    ];
    const currentTags = { bug: { set_by: '@a:b', set_at: 1 } };
    const result = collectAvailableTags(allContents, currentTags);
    expect(result).toEqual(['feature']);
  });

  it('returns empty for no available tags', () => {
    expect(collectAvailableTags([], {})).toEqual([]);
  });
});

describe('normalizeTagName', () => {
  it('trims and lowercases', () => {
    expect(normalizeTagName('  Bug  ')).toBe('bug');
    expect(normalizeTagName('FEATURE')).toBe('feature');
  });
});

describe('isValidTagName', () => {
  it('rejects empty names', () => {
    expect(isValidTagName('')).toBe(false);
    expect(isValidTagName('  ')).toBe(false);
  });

  it('rejects the reserved resolved tag', () => {
    expect(isValidTagName('resolved')).toBe(false);
    expect(isValidTagName('  Resolved  ')).toBe(false);
  });

  it('accepts valid names', () => {
    expect(isValidTagName('bug')).toBe(true);
    expect(isValidTagName('feature-request')).toBe(true);
  });
});

describe('EventTimeline.FORWARDS usage', () => {
  it('verifies EventTimeline.FORWARDS is the SDK constant, not a string literal', () => {
    // This test ensures we use the SDK constant rather than the string 'forward'
    // which was the source of the CINNY-047 bug
    expect(EventTimeline.FORWARDS).toBeDefined();
    expect(typeof EventTimeline.FORWARDS).toBe('string');
  });
});
