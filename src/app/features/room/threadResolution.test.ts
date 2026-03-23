import { describe, expect, it } from 'vitest';
import {
  buildThreadResolvedContent,
  isThreadResolutionTombstone,
  isThreadResolved,
  parseThreadResolutionContent,
} from './threadResolution';

describe('parseThreadResolutionContent', () => {
  it('parses a valid resolved payload', () => {
    const content = parseThreadResolutionContent({
      thread_root_id: '$root',
      status: 'resolved',
      resolved_by: '@alice:example.org',
      resolved_at: '2026-03-21T12:00:00.000Z',
      updated_at: '2026-03-21T12:00:00.000Z',
    });

    expect(content).toEqual({
      thread_root_id: '$root',
      status: 'resolved',
      resolved_by: '@alice:example.org',
      resolved_at: '2026-03-21T12:00:00.000Z',
      updated_at: '2026-03-21T12:00:00.000Z',
    });
  });

  it('rejects payloads whose thread_root_id mismatches the state key', () => {
    expect(
      parseThreadResolutionContent(
        {
          thread_root_id: '$root-a',
          status: 'resolved',
          resolved_by: '@alice:example.org',
          resolved_at: '2026-03-21T12:00:00.000Z',
          updated_at: '2026-03-21T12:00:00.000Z',
        },
        '$root-b'
      )
    ).toBeUndefined();
  });

  it('treats tombstones as unresolved', () => {
    expect(parseThreadResolutionContent({})).toBeUndefined();
    expect(isThreadResolutionTombstone({})).toBe(true);
    expect(isThreadResolved({})).toBe(false);
  });

  it('ignores malformed payloads safely', () => {
    expect(parseThreadResolutionContent(null)).toBeUndefined();
    expect(
      parseThreadResolutionContent({
        thread_root_id: '$root',
        status: 'resolved',
        resolved_by: '@alice:example.org',
        resolved_at: 123,
        updated_at: '2026-03-21T12:00:00.000Z',
      })
    ).toBeUndefined();
    expect(
      parseThreadResolutionContent({
        thread_root_id: '$root',
        status: 'pending',
      })
    ).toBeUndefined();
  });
});

describe('buildThreadResolvedContent', () => {
  it('emits the backend payload shape', () => {
    expect(
      buildThreadResolvedContent('$root', '@alice:example.org', '2026-03-21T12:00:00.000Z')
    ).toEqual({
      thread_root_id: '$root',
      status: 'resolved',
      resolved_by: '@alice:example.org',
      resolved_at: '2026-03-21T12:00:00.000Z',
      updated_at: '2026-03-21T12:00:00.000Z',
    });
  });
});
