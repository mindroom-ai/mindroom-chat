import { describe, expect, it } from 'vitest';
import {
  getTagNames,
  isThreadTagsTombstone,
  isThreadResolvedFromContent,
  parseThreadTagsContent,
  buildResolvedTagsContent,
  buildUnresolvedTagsContent,
} from './threadTags';
import { parseLegacyResolutionContent } from './useRoomThreadTags';

describe('parseThreadTagsContent', () => {
  it('parses valid tags payload with TagMetadata', () => {
    const content = {
      tags: {
        resolved: { set_by: '@user:x', set_at: '2024-01-01T00:00:00Z' },
        blocked: { set_by: '@admin:x', set_at: '2024-01-02T00:00:00Z' },
      },
    };
    const result = parseThreadTagsContent(content);
    expect(result).not.toBeNull();
    expect(Object.keys(result!)).toEqual(['resolved', 'blocked']);
    expect(result!.resolved.set_by).toBe('@user:x');
  });

  it('returns null for tombstone (empty object)', () => {
    expect(parseThreadTagsContent({})).toBeNull();
    expect(isThreadTagsTombstone({})).toBe(true);
  });

  it('returns null for non-object values', () => {
    expect(parseThreadTagsContent(null)).toBeNull();
    expect(parseThreadTagsContent(undefined)).toBeNull();
    expect(parseThreadTagsContent('string')).toBeNull();
    expect(parseThreadTagsContent(42)).toBeNull();
  });

  it('returns null when tags is not an object', () => {
    expect(parseThreadTagsContent({ tags: 'resolved' })).toBeNull();
    expect(parseThreadTagsContent({ tags: ['resolved'] })).toBeNull();
  });

  it('skips entries without required set_by/set_at', () => {
    const content = {
      tags: {
        valid: { set_by: '@user:x', set_at: '2024-01-01T00:00:00Z' },
        invalid: { note: 'missing required fields' },
      },
    };
    const result = parseThreadTagsContent(content);
    expect(result).not.toBeNull();
    expect(Object.keys(result!)).toEqual(['valid']);
  });

  it('returns null when all entries are invalid', () => {
    expect(parseThreadTagsContent({ tags: { bad: 42 } })).toBeNull();
  });
});

describe('getTagNames', () => {
  it('returns tag names from record', () => {
    const tags = {
      resolved: { set_by: '@user:x', set_at: '2024-01-01T00:00:00Z' },
      priority: { set_by: '@user:x', set_at: '2024-01-01T00:00:00Z' },
    };
    expect(getTagNames(tags)).toEqual(['resolved', 'priority']);
  });

  it('returns empty array for null', () => {
    expect(getTagNames(null)).toEqual([]);
  });
});

describe('isThreadResolvedFromContent', () => {
  it('returns true when resolved tag exists', () => {
    expect(
      isThreadResolvedFromContent({
        tags: { resolved: { set_by: '@user:x', set_at: '2024-01-01T00:00:00Z' } },
      })
    ).toBe(true);
  });

  it('returns false when no resolved tag', () => {
    expect(
      isThreadResolvedFromContent({
        tags: { blocked: { set_by: '@user:x', set_at: '2024-01-01T00:00:00Z' } },
      })
    ).toBe(false);
  });

  it('returns false for empty/invalid content', () => {
    expect(isThreadResolvedFromContent({})).toBe(false);
    expect(isThreadResolvedFromContent(null)).toBe(false);
  });
});

describe('buildResolvedTagsContent', () => {
  it('creates content with resolved tag', () => {
    const content = buildResolvedTagsContent('@user:x', null, '2024-01-01T00:00:00Z');
    expect(content.tags.resolved).toEqual({
      set_by: '@user:x',
      set_at: '2024-01-01T00:00:00Z',
    });
  });

  it('preserves existing tags', () => {
    const existing = {
      blocked: { set_by: '@admin:x', set_at: '2024-01-01T00:00:00Z' },
    };
    const content = buildResolvedTagsContent('@user:x', existing, '2024-01-02T00:00:00Z');
    expect(Object.keys(content.tags)).toEqual(['blocked', 'resolved']);
  });
});

describe('buildUnresolvedTagsContent', () => {
  it('removes resolved tag', () => {
    const existing = {
      resolved: { set_by: '@user:x', set_at: '2024-01-01T00:00:00Z' },
      blocked: { set_by: '@admin:x', set_at: '2024-01-01T00:00:00Z' },
    };
    const content = buildUnresolvedTagsContent(existing);
    expect(Object.keys(content.tags)).toEqual(['blocked']);
  });

  it('returns empty tags for null', () => {
    expect(buildUnresolvedTagsContent(null)).toEqual({ tags: {} });
  });
});

// ─── Legacy migration fallback ──────────────────────────────────────────────

describe('parseLegacyResolutionContent', () => {
  it('converts legacy { resolved: true } to tags format', () => {
    const result = parseLegacyResolutionContent({ resolved: true });
    expect(result).not.toBeNull();
    expect(result!.isResolved).toBe(true);
    expect(result!.tags).toEqual({
      resolved: { set_by: 'legacy', set_at: '' },
    });
  });

  it('converts legacy { resolved: false } to unresolved state', () => {
    const result = parseLegacyResolutionContent({ resolved: false });
    expect(result).not.toBeNull();
    expect(result!.isResolved).toBe(false);
    expect(result!.tags).toBeNull();
  });

  it('returns null for non-object values', () => {
    expect(parseLegacyResolutionContent(null)).toBeNull();
    expect(parseLegacyResolutionContent(undefined)).toBeNull();
    expect(parseLegacyResolutionContent('string')).toBeNull();
    expect(parseLegacyResolutionContent(42)).toBeNull();
  });

  it('returns null when resolved is not a boolean', () => {
    expect(parseLegacyResolutionContent({ resolved: 'yes' })).toBeNull();
    expect(parseLegacyResolutionContent({})).toBeNull();
  });

  it('returns null for arrays', () => {
    expect(parseLegacyResolutionContent([true])).toBeNull();
  });
});
